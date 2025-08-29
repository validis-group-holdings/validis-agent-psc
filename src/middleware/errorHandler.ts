import { Request, Response, NextFunction } from 'express';

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

export function errorHandler(
  error: ErrorWithStatus,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  const status = error.status || error.statusCode || 500;
  const message = status === 500 ? 'Internal Server Error' : error.message;

  res.status(status).json({
    success: false,
    error: {
      message,
      status,
      timestamp: new Date().toISOString(),
      path: req.path,
    },
  });
}