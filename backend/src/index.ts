import express, { Express, Request, Response, NextFunction } from "express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import winston from 'winston";
import { appConfig, initializeDatabase, initializeAnthropic } from "./config';
import healthRoutes from './routes/health";

// Configure logger
const logger = winston.createLogger({
  level: appConfig.logLevel,
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        })
      )
    })
  ]
});

const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: appConfig.corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request processed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });

  next();
});

// Routes
app.use('/api', healthRoutes);

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Validis Agent API',
    version: '1.0.0',
    environment: appConfig.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: appConfig.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    // Close database connections
    const { closeDatabase } = await import('./config/database');
    await closeDatabase();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Initialize and start server
async function startServer() {
  try {
    // Initialize database connection (optional in development)
    if (env.NODE_ENV !== "development" || env.MSSQL_SERVER !== "localhost") {
      logger.info("Initializing database connection...");
      try {
        await initializeDatabase();
      } catch (error) {
        logger.warn(
          "Database connection failed, continuing without database:",
          error,
        );
        if (env.NODE_ENV === "production") {
          throw error; // In production, database is required
        }
      }
    } else {
      logger.info(
        "Skipping database connection in development mode (localhost)",
      );
    }
if (process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_SERVER) {


    } else {
      logger.warn('Database credentials not configured. Skipping database initialization.');
    }
    // Initialize Anthropic client
    if (process.env.ANTHROPIC_API_KEY) {
      logger.info('Initializing Anthropic client...');
      initializeAnthropic();
    } else {
      logger.warn('Anthropic API key not configured. Skipping Anthropic initialization.');
    }

    // Start server
    const server = app.listen(appConfig.port, () => {
      logger.info(`Server is running on port ${appConfig.port} in ${appConfig.nodeEnv} mode`);
      logger.info(`Health check available at http://localhost:${appConfig.port}/api/health`);
    });

    // Handle graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    return server;
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

export default app;
export { startServer };
