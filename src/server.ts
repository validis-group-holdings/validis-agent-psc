import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '@/config';
import { connectDatabase } from '@/db/connection';
import { connectRedis } from '@/db/redis';
import { healthRouter } from '@/routes/health';
import { errorHandler } from '@/middleware/errorHandler';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check route
app.use('/health', healthRouter);

// API routes will be added here
// app.use('/api', apiRouter);

// Error handling middleware
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    // Validate environment configuration
    config.validate();
    
    // Connect to database
    await connectDatabase();
    
    // Connect to Redis
    await connectRedis();
    
    const port = config.port;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Workflow mode: ${config.workflowMode}`);
      console.log(`Client ID: ${config.clientId}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

export default app;