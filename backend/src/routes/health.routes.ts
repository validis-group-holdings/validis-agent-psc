import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database';
import { testAnthropicConnection } from '../services/anthropic.service';
import { logger } from '../config/logger';
import os from 'os';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: {
      status: 'up' | 'down';
      responseTime?: number;
      error?: string;
    };
    anthropic: {
      status: 'up' | 'down';
      responseTime?: number;
      error?: string;
    };
  };
  system: {
    memory: {
      total: number;
      free: number;
      used: number;
      usagePercent: number;
    };
    cpu: {
      cores: number;
      loadAverage: number[];
    };
  };
}

/**
 * GET /api/health
 * Basic health check endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * GET /api/health/live
 * Kubernetes liveness probe endpoint
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).send('OK');
});

/**
 * GET /api/health/ready
 * Kubernetes readiness probe endpoint
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Quick database check
    const dbHealthy = await checkDatabaseHealth();

    if (dbHealthy) {
      res.status(200).send('OK');
    } else {
      res.status(503).send('Not Ready');
    }
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).send('Not Ready');
  }
});

/**
 * GET /api/health/detailed
 * Detailed health check with all services
 */
router.get('/detailed', async (_req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: { status: 'down' },
      anthropic: { status: 'down' }
    },
    system: {
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      },
      cpu: {
        cores: os.cpus().length,
        loadAverage: os.loadavg()
      }
    }
  };

  // Check database health
  try {
    const startTime = Date.now();
    const dbHealthy = await checkDatabaseHealth();
    const responseTime = Date.now() - startTime;

    health.services.database = {
      status: dbHealthy ? 'up' : 'down',
      responseTime
    };
  } catch (error: any) {
    health.services.database = {
      status: 'down',
      error: error.message
    };
    health.status = 'degraded';
  }

  // Check Anthropic API health
  try {
    const startTime = Date.now();
    const anthropicHealthy = await testAnthropicConnection();
    const responseTime = Date.now() - startTime;

    health.services.anthropic = {
      status: anthropicHealthy ? 'up' : 'down',
      responseTime
    };
  } catch (error: any) {
    health.services.anthropic = {
      status: 'down',
      error: error.message
    };
    health.status = 'degraded';
  }

  // Determine overall health status
  const allServicesDown =
    health.services.database.status === 'down' && health.services.anthropic.status === 'down';

  if (allServicesDown) {
    health.status = 'unhealthy';
  }

  // Set appropriate HTTP status code
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 206 : 503;

  res.status(statusCode).json(health);
});

export default router;
