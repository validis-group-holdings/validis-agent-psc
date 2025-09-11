import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { env } from '../config/env';

// Custom error class for API errors
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: any;

  constructor(statusCode: number, message: string, details?: any, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Error type guards
const isApiError = (error: any): error is ApiError => {
  return error instanceof ApiError;
};

const isTrustedError = (error: any): boolean => {
  if (isApiError(error)) {
    return error.isOperational;
  }
  return false;
};

// Format error response based on environment
const formatErrorResponse = (error: any, requestId?: string) => {
  const isDevelopment = env.NODE_ENV === 'development';
  const isProduction = env.NODE_ENV === 'production';

  // Base error structure
  const errorResponse: any = {
    success: false,
    error: {
      message:
        isProduction && !isTrustedError(error)
          ? 'Internal Server Error'
          : error.message || 'Unknown error occurred',
      code: error.code || 'ERROR',
      timestamp: new Date().toISOString(),
      requestId
    }
  };

  // Add details in non-production or for operational errors
  if (!isProduction || isTrustedError(error)) {
    if (error.details) {
      errorResponse.error.details = error.details;
    }
  }

  // Add stack trace in development
  if (isDevelopment && error.stack) {
    errorResponse.error.stack = error.stack.split('\n');
  }

  return errorResponse;
};

// Log error with context
const logError = (error: any, req: Request) => {
  const errorContext = {
    message: error.message,
    statusCode: error.statusCode || 500,
    method: req.method,
    url: req.url,
    path: req.path,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: {
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
      authorization: req.headers.authorization ? 'Bearer ***' : undefined
    },
    ip: req.ip,
    requestId: req.id,
    timestamp: new Date().toISOString()
  };

  // Remove sensitive data from logs
  if (errorContext.body?.password) {
    errorContext.body.password = '***';
  }
  if (errorContext.body?.token) {
    errorContext.body.token = '***';
  }
  if (errorContext.body?.apiKey) {
    errorContext.body.apiKey = '***';
  }

  // Log based on error type
  if (isTrustedError(error)) {
    logger.warn('Operational error occurred', errorContext);
  } else {
    logger.error('Unexpected error occurred', {
      ...errorContext,
      stack: error.stack
    });
  }
};

// Main error handler middleware
export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log the error
  logError(err, req);

  // Determine status code
  let statusCode = 500;
  if (isApiError(err)) {
    statusCode = err.statusCode;
  } else if ((err as any).status) {
    statusCode = (err as any).status;
  } else if ((err as any).statusCode) {
    statusCode = (err as any).statusCode;
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
  } else if (err.name === 'CastError') {
    statusCode = 400;
  } else if (err.message?.includes('ECONNREFUSED')) {
    statusCode = 503;
  }

  // Send error response
  res.status(statusCode).json(formatErrorResponse(err, req.id));
};

// Async error wrapper for route handlers
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 Not Found handler
export const notFoundHandler = (req: Request, res: Response) => {
  const error = new ApiError(404, `Cannot ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path
  });
  res.status(404).json(formatErrorResponse(error, req.id));
};

// Uncaught exception handler
export const handleUncaughtException = () => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Give time to log before shutting down
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
};

// Unhandled rejection handler
export const handleUnhandledRejection = () => {
  process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
    logger.error('Unhandled Rejection:', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      timestamp: new Date().toISOString()
    });

    // Convert to exception
    throw reason;
  });
};
