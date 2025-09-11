import 'express-async-errors';
import { createApp } from './app';
import { logger } from './config/logger';
import { env } from './config/env';
import { initializeDatabase, initializeAnthropic } from './config';
import { handleUncaughtException, handleUnhandledRejection } from './middleware/error-handler';
import { cleanupStaleRequests } from './middleware/request-logger';

const app = createApp();

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
    if (process.env.NODE_ENV !== 'development' || process.env.DB_SERVER !== 'localhost') {
      logger.info('Initializing database connection...');
      try {
        await initializeDatabase();
      } catch (error) {
        logger.warn('Database connection failed, continuing without database:', error);
        if (process.env.NODE_ENV === 'production') {
          throw error; // In production, database is required
        }
      }
    } else {
      logger.info('Skipping database connection in development mode (localhost)');
    }

    // Initialize Anthropic client
    if (process.env.ANTHROPIC_API_KEY) {
      logger.info('Initializing Anthropic client...');
      initializeAnthropic();
    } else {
      logger.warn('Anthropic API key not configured. Skipping Anthropic initialization.');
    }

    // Initialize cleanup for stale requests
    cleanupStaleRequests();

    // Setup global error handlers
    handleUncaughtException();
    handleUnhandledRejection();

    // Start server
    const server = app.listen(env.PORT, () => {
      logger.info(`Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
      logger.info(`Health check available at http://localhost:${env.PORT}/api/health`);
      logger.info(`API documentation available at http://localhost:${env.PORT}/`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

// Extend Express Request type to include id
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export default app;
export { startServer };
