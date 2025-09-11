/**
 * Validation Middleware
 * Provides Zod-based request validation with comprehensive error handling
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { logger } from '../config/logger';

/**
 * Chat request validation schema
 */
export const chatRequestSchema = z.object({
  query: z.string().min(1).max(5000).describe('Natural language query'),
  sessionId: z.string().min(1).max(100).describe('Session identifier'),
  clientId: z.string().min(1).max(100).describe('Client identifier'),
  userId: z.string().min(1).max(100).optional().describe('User identifier'),
  companyName: z.string().min(1).max(200).optional().describe('Company name for audit queries'),
  uploadId: z.string().min(1).max(100).optional().describe('Upload identifier'),
  options: z.object({
    skipOptimization: z.boolean().optional().describe('Skip SQL optimization step'),
    timeout: z.number().min(1000).max(30000).optional().describe('Request timeout in milliseconds'),
    includeExplanation: z.boolean().optional().default(true).describe('Include detailed explanation'),
    maxResults: z.number().min(1).max(10000).optional().default(5000).describe('Maximum number of results'),
    useLatestUpload: z.boolean().optional().describe('Use latest upload if uploadId not specified'),
    debug: z.boolean().optional().describe('Enable debug mode'),
    stream: z.boolean().optional().describe('Enable streaming response')
  }).optional()
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * Query execution request validation schema
 */
export const queryExecuteSchema = z.object({
  sql: z.string().min(1).max(50000).describe('SQL query to execute'),
  clientId: z.string().min(1).max(100).describe('Client identifier'),
  uploadId: z.string().min(1).max(100).optional().describe('Upload identifier'),
  parameters: z.record(z.any()).optional().describe('Query parameters'),
  options: z.object({
    maxRows: z.number().min(1).max(10000).optional().default(5000).describe('Maximum rows to return'),
    timeout: z.number().min(1000).max(60000).optional().default(30000).describe('Query timeout in milliseconds'),
    format: z.enum(['json', 'csv', 'excel']).optional().default('json').describe('Response format'),
    includeMetadata: z.boolean().optional().default(false).describe('Include result metadata')
  }).optional()
});

export type QueryExecuteRequest = z.infer<typeof queryExecuteSchema>;

/**
 * Validation error response
 */
interface ValidationErrorResponse {
  success: false;
  error: 'Validation Error';
  message: string;
  details: Array<{
    field: string;
    message: string;
    code?: string;
  }>;
  requestId?: string;
}

/**
 * Format Zod validation errors for API response
 */
function formatZodErrors(error: ZodError): ValidationErrorResponse['details'] {
  return error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code
  }));
}

/**
 * Generic validation middleware factory
 */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validatedData = schema.parse(req.body);

      // Attach validated data to request
      req.body = validatedData;

      // Log successful validation
      logger.debug('Request validation successful', {
        endpoint: req.path,
        method: req.method,
        sessionId: (req.body as any).sessionId
      });

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError: ValidationErrorResponse = {
          success: false,
          error: 'Validation Error',
          message: 'Request validation failed',
          details: formatZodErrors(error),
          requestId: (req as any).id
        };

        logger.warn('Request validation failed', {
          endpoint: req.path,
          method: req.method,
          errors: validationError.details
        });

        return res.status(400).json(validationError);
      }

      // Handle unexpected errors
      logger.error('Unexpected validation error', {
        endpoint: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during validation',
        requestId: (req as any).id
      });
    }
  };
}

/**
 * Validate chat request
 */
export const validateChatRequest = validate(chatRequestSchema);

/**
 * Validate query execution request
 */
export const validateQueryExecute = validate(queryExecuteSchema);

/**
 * Rate limiting configuration schema
 */
export const rateLimitConfigSchema = z.object({
  windowMs: z.number().min(1000).default(60000), // 1 minute default
  max: z.number().min(1).default(100), // 100 requests per window
  message: z.string().optional().default('Too many requests, please try again later'),
  standardHeaders: z.boolean().optional().default(true),
  legacyHeaders: z.boolean().optional().default(false),
  skipSuccessfulRequests: z.boolean().optional().default(false),
  skipFailedRequests: z.boolean().optional().default(false)
});

export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;

/**
 * Query parameter validation schemas
 */
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20)
});

export const sortingSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc')
});

/**
 * Validate query parameters
 */
export function validateQueryParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedParams = schema.parse(req.query);
      req.query = validatedParams as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError: ValidationErrorResponse = {
          success: false,
          error: 'Validation Error',
          message: 'Query parameter validation failed',
          details: formatZodErrors(error),
          requestId: (req as any).id
        };

        return res.status(400).json(validationError);
      }

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during validation',
        requestId: (req as any).id
      });
    }
  };
}

/**
 * Sanitize SQL query to prevent basic injection attempts
 * Note: This is a basic check - proper parameterized queries should be used
 */
export function sanitizeSql(sql: string): string {
  // Remove comments
  let sanitized = sql.replace(/--.*$/gm, '');
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');

  // Check for dangerous keywords in inappropriate contexts
  const dangerousPatterns = [
    /;\s*(DROP|CREATE|ALTER|TRUNCATE|DELETE\s+FROM\s+(?!tmp_|temp_))/gi,
    /xp_cmdshell/gi,
    /sp_executesql/gi,
    /EXEC\s*\(/gi
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error('Potentially dangerous SQL pattern detected');
    }
  }

  return sanitized.trim();
}

/**
 * Validate and sanitize SQL
 */
export function validateSql(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.body.sql) {
      req.body.sql = sanitizeSql(req.body.sql);
    }
    next();
  } catch (error) {
    logger.warn('SQL validation failed', {
      endpoint: req.path,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return res.status(400).json({
      success: false,
      error: 'SQL Validation Error',
      message: error instanceof Error ? error.message : 'Invalid SQL query',
      requestId: (req as any).id
    });
  }
}

/**
 * Request ID middleware - adds unique ID to each request
 */
export function addRequestId(req: Request, res: Response, next: NextFunction) {
  (req as any).id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-Id', (req as any).id);
  next();
}

/**
 * Log request details
 */
export function logRequest(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Log request
  logger.info('Incoming request', {
    requestId: (req as any).id,
    method: req.method,
    path: req.path,
    query: req.query,
    sessionId: req.body?.sessionId,
    clientId: req.body?.clientId
  });

  // Log response
  const originalSend = res.send;
  res.send = function(data: any) {
    const duration = Date.now() - startTime;

    logger.info('Request completed', {
      requestId: (req as any).id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });

    return originalSend.call(this, data);
  };

  next();
}
