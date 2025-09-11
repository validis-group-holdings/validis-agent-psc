import { Response } from 'express';
import { logger } from '../config/logger';

// Response status codes
export const StatusCodes = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
} as const;

// Standard response format interfaces
interface BaseResponse {
  success: boolean;
  timestamp: string;
  requestId?: string;
}

interface SuccessResponse<T = any> extends BaseResponse {
  success: true;
  data: T;
  message?: string;
  metadata?: ResponseMetadata;
}

interface ErrorResponse extends BaseResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    stack?: string[];
  };
}

interface ResponseMetadata {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  processingTime?: string;
  version?: string;
}

// Pagination helper
export interface PaginationParams {
  page: number;
  limit: number;
  total: number;
}

export const calculatePagination = (params: PaginationParams): ResponseMetadata => {
  const { page, limit, total } = params;
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};

// Success response builder
export const successResponse = <T = any>(
  res: Response,
  data: T,
  statusCode: number = StatusCodes.OK,
  message?: string,
  metadata?: ResponseMetadata
): Response => {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId: (res as any).req?.id
  };

  if (message) {
    response.message = message;
  }

  if (metadata) {
    response.metadata = metadata;
  }

  return res.status(statusCode).json(response);
};

// Error response builder
export const errorResponse = (
  res: Response,
  statusCode: number,
  message: string,
  code: string = 'ERROR',
  details?: any
): Response => {
  const response: ErrorResponse = {
    success: false,
    timestamp: new Date().toISOString(),
    requestId: (res as any).req?.id,
    error: {
      code,
      message,
      details
    }
  };

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development' && details?.stack) {
    response.error.stack = details.stack.split('\n');
  }

  return res.status(statusCode).json(response);
};

// Specific response helpers
export const ok = <T = any>(res: Response, data: T, message?: string, metadata?: ResponseMetadata) => {
  return successResponse(res, data, StatusCodes.OK, message, metadata);
};

export const created = <T = any>(res: Response, data: T, message: string = 'Resource created successfully') => {
  return successResponse(res, data, StatusCodes.CREATED, message);
};

export const accepted = <T = any>(res: Response, data: T, message: string = 'Request accepted for processing') => {
  return successResponse(res, data, StatusCodes.ACCEPTED, message);
};

export const noContent = (res: Response) => {
  return res.status(StatusCodes.NO_CONTENT).send();
};

export const badRequest = (res: Response, message: string = 'Bad request', details?: any) => {
  return errorResponse(res, StatusCodes.BAD_REQUEST, message, 'BAD_REQUEST', details);
};

export const unauthorized = (res: Response, message: string = 'Unauthorized') => {
  return errorResponse(res, StatusCodes.UNAUTHORIZED, message, 'UNAUTHORIZED');
};

export const forbidden = (res: Response, message: string = 'Forbidden') => {
  return errorResponse(res, StatusCodes.FORBIDDEN, message, 'FORBIDDEN');
};

export const notFound = (res: Response, message: string = 'Resource not found') => {
  return errorResponse(res, StatusCodes.NOT_FOUND, message, 'NOT_FOUND');
};

export const conflict = (res: Response, message: string = 'Resource conflict', details?: any) => {
  return errorResponse(res, StatusCodes.CONFLICT, message, 'CONFLICT', details);
};

export const validationError = (res: Response, message: string = 'Validation failed', details?: any) => {
  return errorResponse(res, StatusCodes.UNPROCESSABLE_ENTITY, message, 'VALIDATION_ERROR', details);
};

export const tooManyRequests = (res: Response, message: string = 'Too many requests', retryAfter?: number) => {
  if (retryAfter) {
    res.setHeader('Retry-After', retryAfter);
  }
  return errorResponse(res, StatusCodes.TOO_MANY_REQUESTS, message, 'RATE_LIMIT_EXCEEDED');
};

export const internalError = (res: Response, message: string = 'Internal server error', details?: any) => {
  // Log internal errors
  logger.error('Internal server error', {
    message,
    details,
    requestId: (res as any).req?.id,
    timestamp: new Date().toISOString()
  });

  // Don't expose internal details in production
  const safeMessage = process.env.NODE_ENV === 'production' ? 'Internal server error' : message;
  const safeDetails = process.env.NODE_ENV === 'production' ? undefined : details;

  return errorResponse(res, StatusCodes.INTERNAL_SERVER_ERROR, safeMessage, 'INTERNAL_ERROR', safeDetails);
};

export const serviceUnavailable = (res: Response, message: string = 'Service unavailable') => {
  return errorResponse(res, StatusCodes.SERVICE_UNAVAILABLE, message, 'SERVICE_UNAVAILABLE');
};

export const gatewayTimeout = (res: Response, message: string = 'Gateway timeout') => {
  return errorResponse(res, StatusCodes.GATEWAY_TIMEOUT, message, 'GATEWAY_TIMEOUT');
};

// Paginated response helper
export const paginatedResponse = <T = any>(
  res: Response,
  data: T[],
  pagination: PaginationParams,
  message?: string
) => {
  const metadata = calculatePagination(pagination);
  return successResponse(res, data, StatusCodes.OK, message, metadata);
};

// Streaming response helper
export const streamResponse = (res: Response, contentType: string = 'application/octet-stream') => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Request-Id', (res as any).req?.id || '');
  return res;
};

// SSE (Server-Sent Events) response helper
export const sseResponse = (res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Request-Id', (res as any).req?.id || '');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connection', message: 'Connected' })}\n\n`);

  return {
    send: (data: any, event?: string) => {
      if (event) {
        res.write(`event: ${event}\n`);
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close: () => {
      res.end();
    }
  };
};

// Retry logic utility
export interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  backoff?: number;
  onRetry?: (attempt: number, error: any) => void;
}

export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = 2,
    onRetry
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        const waitTime = delay * Math.pow(backoff, attempt - 1);

        if (onRetry) {
          onRetry(attempt, error);
        }

        logger.debug(`Retry attempt ${attempt}/${maxAttempts} after ${waitTime}ms`, {
          error: (error as Error).message,
          attempt,
          maxAttempts,
          waitTime
        });

        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError;
};

// Response time tracking
export const trackResponseTime = (startTime: number): string => {
  const duration = Date.now() - startTime;
  return `${duration}ms`;
};

// Export all response utilities
export const responseUtils = {
  success: successResponse,
  error: errorResponse,
  ok,
  created,
  accepted,
  noContent,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  tooManyRequests,
  internalError,
  serviceUnavailable,
  gatewayTimeout,
  paginated: paginatedResponse,
  stream: streamResponse,
  sse: sseResponse,
  withRetry,
  trackResponseTime,
  StatusCodes
};
