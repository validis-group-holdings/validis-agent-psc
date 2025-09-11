import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { performance } from 'perf_hooks';
import crypto from 'crypto';

interface RequestMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  statusCode?: number;
  method: string;
  path: string;
  requestId: string;
}

// Store for tracking request metrics
const activeRequests = new Map<string, RequestMetrics>();

// Generate unique request ID
export const generateRequestId = (): string => {
  return crypto.randomBytes(16).toString('hex');
};

// Request ID middleware
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Use existing ID or generate new one
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

// Request logger middleware with performance tracking
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = performance.now();
  const requestId = req.id || generateRequestId();

  // Store request metrics
  const metrics: RequestMetrics = {
    startTime,
    method: req.method,
    path: req.path,
    requestId
  };
  activeRequests.set(requestId, metrics);

  // Log incoming request
  logger.info('Incoming request', {
    requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    headers: {
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length']
    },
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Capture response
  const originalSend = res.send;
  res.send = function (data: any) {
    res.send = originalSend;
    const result = originalSend.call(this, data);

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Update metrics
    if (activeRequests.has(requestId)) {
      const metrics = activeRequests.get(requestId)!;
      metrics.endTime = endTime;
      metrics.duration = duration;
      metrics.statusCode = res.statusCode;
    }

    // Log response with timing
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration.toFixed(2)}ms`,
      durationMs: duration,
      timestamp: new Date().toISOString()
    };

    // Check for slow requests
    if (duration > 10000) {
      logger.error('CRITICAL: Request exceeded 10 second threshold', logData);
    } else if (duration > 5000) {
      logger.warn('WARNING: Slow request detected (>5 seconds)', logData);
    } else {
      logger.info('Request completed', logData);
    }

    // Clean up stored metrics after logging
    activeRequests.delete(requestId);

    return result;
  };

  next();
};

// Performance monitoring middleware
export const performanceMonitor = (req: Request, res: Response, next: NextFunction) => {
  const startTime = performance.now();
  const startMemory = process.memoryUsage();

  res.on('finish', () => {
    const endTime = performance.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    // Log performance metrics for slow requests
    if (duration > 1000) {
      logger.warn('Performance metrics', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        duration: `${duration.toFixed(2)}ms`,
        memory: {
          rss: `${((endMemory.rss - startMemory.rss) / 1024 / 1024).toFixed(2)}MB`,
          heapUsed: `${((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2)}MB`
        },
        timestamp: new Date().toISOString()
      });
    }
  });

  next();
};

// Request body logger (for debugging, be careful with sensitive data)
export const bodyLogger = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = { ...req.body };

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'authorization'];
    sensitiveFields.forEach((field) => {
      if (sanitizedBody[field]) {
        sanitizedBody[field] = '***REDACTED***';
      }
    });

    logger.debug('Request body', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      body: sanitizedBody,
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// Response interceptor for logging response data
export const responseInterceptor = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;

  res.json = function (data: any) {
    // Log successful responses
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.debug('Response data', {
        requestId: req.id,
        statusCode: res.statusCode,
        hasData: !!data,
        dataType: typeof data,
        timestamp: new Date().toISOString()
      });
    }

    return originalJson.call(this, data);
  };

  next();
};

// Cleanup middleware for removing stale requests
export const cleanupStaleRequests = () => {
  setInterval(() => {
    const now = performance.now();
    const staleThreshold = 60000; // 60 seconds

    for (const [requestId, metrics] of activeRequests.entries()) {
      if (now - metrics.startTime > staleThreshold) {
        logger.warn('Removing stale request from tracking', {
          requestId,
          method: metrics.method,
          path: metrics.path,
          age: `${((now - metrics.startTime) / 1000).toFixed(2)}s`
        });
        activeRequests.delete(requestId);
      }
    }
  }, 30000); // Run every 30 seconds
};

// Get current active requests (for monitoring)
export const getActiveRequests = (): RequestMetrics[] => {
  return Array.from(activeRequests.values());
};

// Get request metrics summary
export const getRequestMetricsSummary = () => {
  const requests = Array.from(activeRequests.values());
  const now = performance.now();

  return {
    activeCount: requests.length,
    requests: requests.map((r) => ({
      ...r,
      age: `${((now - r.startTime) / 1000).toFixed(2)}s`
    })),
    timestamp: new Date().toISOString()
  };
};
