import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { connectDatabase } from './db/connection';
import { connectRedis } from './db/redis';
import { initializeLangChain } from './config/langchain';
import { healthRouter } from './routes/health';
import { queryRouter } from './routes/query';
import { errorHandler } from './middleware/errorHandler';
import { initializeSafetyLayer, shutdownSafetyLayer } from './safety';
import { 
  auditLogger, 
  clientRateLimit,
  systemMetrics,
  emergencyControls,
  queryStatus
} from './middleware/safety';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check route (before safety middleware)
app.use('/health', healthRouter);

// Safety middleware (applied globally)
app.use(auditLogger);
app.use(clientRateLimit);

// Safety monitoring routes
app.get('/api/safety/metrics', systemMetrics);
app.get('/api/safety/query/:queryId', queryStatus);
app.post('/api/safety/emergency', emergencyControls);

// Query API routes
app.use('/api/query', queryRouter);

// Error handling middleware
app.use(errorHandler);

async function startServer(): Promise<void> {
  try {
    // Validate environment configuration
    config.validate();
    
    // Connect to database (optional for testing)
    try {
      await connectDatabase();
    } catch (dbError) {
      console.warn('⚠️  Database connection failed - running in limited mode');
      console.warn('   Some features may not be available');
    }
    
    // Connect to Redis
    await connectRedis();
    
    // Initialize LangChain for natural language processing
    initializeLangChain();
    console.log('🤖 LangChain initialized with Anthropic Claude');
    
    // Initialize safety layer
    await initializeSafetyLayer();
    
    const port = config.port;
    app.listen(port, () => {
      console.log(`🚀 Validis Agent Server running on port ${port}`);
      console.log(`   Environment: ${config.nodeEnv}`);
      console.log(`   Workflow mode: ${config.workflowMode}`);
      console.log(`   Client ID: ${config.clientId}`);
      console.log(`   Safety layer: ✅ Active`);
      console.log(`   Available endpoints:`);
      console.log(`     - GET  /health - Health check`);
      console.log(`     - POST /api/query - Execute query with safety`);
      console.log(`     - POST /api/query/validate - Validate query only`);
      console.log(`     - GET  /api/safety/metrics - Safety metrics`);
      console.log(`     - GET  /api/safety/query/:id - Query status`);
      console.log(`     - POST /api/safety/emergency - Emergency controls`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await shutdownSafetyLayer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await shutdownSafetyLayer();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

export default app;