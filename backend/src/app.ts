import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { logger, stream } from './config/logger';
import healthRoutes from './routes/health.routes';
import aiRoutes from './routes/ai.routes';

// Create Express application
export const createApp = (): Application => {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: env.NODE_ENV === 'production',
  }));

  // CORS configuration
  app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: env.CORS_CREDENTIALS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging middleware
  app.use(morgan('combined', { stream }));

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.id = Math.random().toString(36).substring(2, 15);
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/ai', aiRoutes);

  // Root endpoint
  app.get('/', (req: Request, res: Response) => {
    res.json({
      name: 'Validis Agent Backend',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.path}`,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      requestId: req.id,
    });

    // Don't leak error details in production
    const message = env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message;

    res.status(500).json({
      error: 'Internal Server Error',
      message,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
};

// Extend Express Request type to include id
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
