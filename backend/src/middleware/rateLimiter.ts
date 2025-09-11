/**
 * Rate Limiting Middleware
 * Implements rate limiting to prevent API abuse
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Rate limit store entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  windowMs: number;           // Time window in milliseconds
  max: number;                // Max requests per window
  message?: string;           // Error message
  keyGenerator?: (req: Request) => string; // Custom key generator
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  standardHeaders?: boolean;  // Return rate limit info in headers
  legacyHeaders?: boolean;    // Return X-RateLimit headers
}

/**
 * Simple in-memory rate limit store
 */
class MemoryStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number) {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      this.store.forEach((entry, key) => {
        if (entry.resetTime <= now) {
          keysToDelete.push(key);
        }
      });

      keysToDelete.forEach(key => this.store.delete(key));
    }, 60000);
  }

  increment(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetTime <= now) {
      // Create new entry
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + windowMs
      };
      this.store.set(key, newEntry);
      return newEntry;
    }

    // Increment existing entry
    entry.count++;
    return entry;
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.resetTime > Date.now()) {
      return entry;
    }
    return undefined;
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(config: RateLimiterConfig) {
  const {
    windowMs = 60000,  // 1 minute default
    max = 100,          // 100 requests per window default
    message = 'Too many requests, please try again later',
    keyGenerator = defaultKeyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    standardHeaders = true,
    legacyHeaders = false
  } = config;

  const store = new MemoryStore(windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);

    // Get current count
    const entry = store.increment(key, windowMs);

    // Calculate remaining requests
    const remaining = Math.max(0, max - entry.count);
    const resetTime = new Date(entry.resetTime);

    // Set headers if enabled
    if (standardHeaders) {
      res.setHeader('RateLimit-Limit', max.toString());
      res.setHeader('RateLimit-Remaining', remaining.toString());
      res.setHeader('RateLimit-Reset', resetTime.toISOString());
    }

    if (legacyHeaders) {
      res.setHeader('X-RateLimit-Limit', max.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000).toString());
    }

    // Check if limit exceeded
    if (entry.count > max) {
      logger.warn('Rate limit exceeded', {
        key,
        count: entry.count,
        max,
        resetTime: resetTime.toISOString()
      });

      // Set retry-after header
      const retryAfter = Math.ceil((entry.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());

      return res.status(429).json({
        success: false,
        error: 'Rate Limit Exceeded',
        message,
        retryAfter,
        resetTime: resetTime.toISOString()
      });
    }

    // Track response to handle skip options
    if (skipSuccessfulRequests || skipFailedRequests) {
      const originalSend = res.send;
      res.send = function(data: any) {
        // Check if we should decrement based on response status
        if ((skipSuccessfulRequests && res.statusCode < 400) ||
            (skipFailedRequests && res.statusCode >= 400)) {
          // Decrement the count
          const currentEntry = store.get(key);
          if (currentEntry && currentEntry.count > 0) {
            currentEntry.count--;
          }
        }
        return originalSend.call(this, data);
      };
    }

    next();
  };
}

/**
 * Default key generator - uses IP address
 */
function defaultKeyGenerator(req: Request): string {
  // Get IP address, considering proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0])
    : req.ip || req.connection.remoteAddress || 'unknown';

  return `rate-limit:${ip}`;
}

/**
 * Create key generator for authenticated routes
 */
export function userKeyGenerator(req: Request): string {
  // Use user ID if available, otherwise fall back to IP
  const userId = (req as any).user?.id || (req as any).userId;
  if (userId) {
    return `rate-limit:user:${userId}`;
  }
  return defaultKeyGenerator(req);
}

/**
 * Create key generator for client-specific routes
 */
export function clientKeyGenerator(req: Request): string {
  const clientId = req.body?.clientId || req.params?.clientId || req.query?.clientId;
  if (clientId) {
    return `rate-limit:client:${clientId}`;
  }
  return defaultKeyGenerator(req);
}

/**
 * Predefined rate limiters for different endpoints
 */

// Strict rate limit for chat endpoint (expensive operation)
export const chatRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,      // 1 minute
  max: 10,                   // 10 requests per minute
  message: 'Too many chat requests. Please wait before trying again.',
  keyGenerator: clientKeyGenerator,
  standardHeaders: true
});

// Moderate rate limit for query execution
export const queryRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,      // 1 minute
  max: 30,                   // 30 requests per minute
  message: 'Too many query requests. Please wait before trying again.',
  keyGenerator: clientKeyGenerator,
  standardHeaders: true
});

// Lenient rate limit for validation endpoints
export const validationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,      // 1 minute
  max: 100,                  // 100 requests per minute
  message: 'Too many validation requests. Please wait before trying again.',
  keyGenerator: clientKeyGenerator,
  standardHeaders: true
});

// Very strict rate limit for admin operations
export const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,      // 1 minute
  max: 5,                    // 5 requests per minute
  message: 'Admin operation rate limit exceeded.',
  keyGenerator: userKeyGenerator,
  standardHeaders: true
});

// Global rate limiter for all endpoints
export const globalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,      // 1 minute
  max: 200,                  // 200 requests per minute total
  message: 'Global rate limit exceeded. Please slow down.',
  standardHeaders: true
});

/**
 * Dynamic rate limiter that adjusts based on system load
 */
export class DynamicRateLimiter {
  private baseLimiter: ReturnType<typeof createRateLimiter>;
  private loadFactor: number = 1;

  constructor(baseConfig: RateLimiterConfig) {
    this.baseLimiter = createRateLimiter(baseConfig);

    // Monitor system load and adjust limits
    setInterval(() => {
      this.adjustLoadFactor();
    }, 30000); // Check every 30 seconds
  }

  private adjustLoadFactor(): void {
    // This would check actual system metrics
    // For now, using a placeholder
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();

    // Simple load calculation (would be more sophisticated in production)
    const load = (memUsage.heapUsed / memUsage.heapTotal);

    if (load > 0.8) {
      this.loadFactor = 0.5; // Reduce limits by 50%
    } else if (load > 0.6) {
      this.loadFactor = 0.75; // Reduce limits by 25%
    } else {
      this.loadFactor = 1; // Full capacity
    }

    logger.debug('Dynamic rate limiter load factor adjusted', {
      loadFactor: this.loadFactor,
      load
    });
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Apply load factor to the limit
      // This is simplified - in production, you'd recreate the limiter
      // or adjust the store directly
      this.baseLimiter(req, res, next);
    };
  }
}

export default {
  createRateLimiter,
  chatRateLimiter,
  queryRateLimiter,
  validationRateLimiter,
  adminRateLimiter,
  globalRateLimiter,
  DynamicRateLimiter
};
