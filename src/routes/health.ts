import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '@/db/connection';
import { checkRedisHealth } from '@/db/redis';
import { config } from '@/config';

const router = Router();

interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  services: {
    database: {
      status: string;
      message: string;
    };
    redis: {
      status: string;
      message: string;
    };
    langchain: {
      status: string;
      message: string;
    };
  };
  configuration: {
    workflowMode: string;
    clientId: string;
    anthropicModel: string;
    queryLimits: {
      maxResults: number;
      timeoutMs: number;
    };
    cache: {
      ttlSeconds: number;
    };
  };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Check all services
    const [databaseHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    // Check LangChain configuration
    const langchainHealth = checkLangChainHealth();
    
    // Determine overall status
    const allServicesHealthy = 
      databaseHealth.status === 'healthy' &&
      redisHealth.status === 'healthy' &&
      langchainHealth.status === 'healthy';
    
    const anyServiceDegraded = 
      databaseHealth.status === 'error' ||
      redisHealth.status === 'error' ||
      langchainHealth.status === 'error';
    
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
    if (allServicesHealthy) {
      overallStatus = 'healthy';
    } else if (anyServiceDegraded) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }
    
    const healthCheck: HealthCheck = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      uptime: process.uptime(),
      services: {
        database: databaseHealth,
        redis: redisHealth,
        langchain: langchainHealth,
      },
      configuration: {
        workflowMode: config.workflowMode,
        clientId: config.clientId,
        anthropicModel: config.anthropic.model,
        queryLimits: config.queryLimits,
        cache: config.cache,
      },
    };
    
    const responseTime = Date.now() - startTime;
    
    // Set appropriate HTTP status code
    const httpStatus = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 207 : 503;
    
    res.status(httpStatus).json({
      ...healthCheck,
      responseTime: `${responseTime}ms`,
    });
    
  } catch (error) {
    console.error('Health check error:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      uptime: process.uptime(),
      error: error instanceof Error ? error.message : 'Unknown error',
      services: {
        database: { status: 'unknown', message: 'Health check failed' },
        redis: { status: 'unknown', message: 'Health check failed' },
        langchain: { status: 'unknown', message: 'Health check failed' },
      },
    });
  }
});

router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Simple readiness check - just verify critical services
    const [databaseHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    const isReady = 
      databaseHealth.status === 'healthy' && 
      redisHealth.status === 'healthy';
    
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        message: 'Service is ready to accept requests',
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        message: 'Service is not ready',
        issues: [
          ...(databaseHealth.status !== 'healthy' ? [`Database: ${databaseHealth.message}`] : []),
          ...(redisHealth.status !== 'healthy' ? [`Redis: ${redisHealth.message}`] : []),
        ],
      });
    }
    
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      message: 'Readiness check failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.get('/live', (req: Request, res: Response) => {
  // Simple liveness check - just return OK if the process is running
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Service is alive',
  });
});

function checkLangChainHealth(): { status: string; message: string } {
  try {
    // Check if Anthropic API key is configured
    if (!config.anthropic.apiKey) {
      return {
        status: 'error',
        message: 'Anthropic API key not configured',
      };
    }
    
    if (!config.anthropic.model) {
      return {
        status: 'error',
        message: 'Anthropic model not configured',
      };
    }
    
    return {
      status: 'healthy',
      message: 'LangChain configuration is valid',
    };
    
  } catch (error) {
    return {
      status: 'error',
      message: `LangChain health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export { router as healthRouter };