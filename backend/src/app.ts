import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { stream } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import {
  requestIdMiddleware,
  requestLogger,
  performanceMonitor
} from './middleware/request-logger';
import { responseUtils } from './utils/response.utils';
import healthRoutes from './routes/health.routes';
import aiRoutes from './routes/ai.routes';
import chatRoutes from './routes/chat.routes';
import queryRoutes from './routes/query.routes';
import templateRoutes from './routes/template.routes';
import schemaRoutes from './routes/schema.routes';

// Create Express application
export const createApp = (): Application => {
  const app = express();

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: env.NODE_ENV === 'production'
    })
  );

  // CORS configuration
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: env.CORS_CREDENTIALS,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging middleware
  app.use(morgan('combined', { stream }));

  // Request ID and logging middleware
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(performanceMonitor);

  // API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/query', queryRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/schemas', schemaRoutes);

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    responseUtils.ok(res, {
      name: 'Validis Agent Backend',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(errorHandler);

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
