import { Router, Request, Response } from 'express';
import { getPool } from '../config/database';
import { getAnthropicClient } from '../config/anthropic';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: {
      connected: boolean;
      error?: string;
    };
    anthropic: {
      configured: boolean;
      error?: string;
    };
  };
}

router.get('/health', async (req: Request, res: Response) => {
  const healthStatus: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: {
        connected: false
      },
      anthropic: {
        configured: false
      }
    }
  };

  // Check database connection
  try {
    const pool = getPool();
    if (pool && pool.connected) {
      await pool.request().query('SELECT 1 as test');
      healthStatus.services.database.connected = true;
    }
  } catch (error) {
    healthStatus.services.database.connected = false;
    healthStatus.services.database.error = error instanceof Error ? error.message : 'Unknown error';
    healthStatus.status = 'degraded';
  }

  // Check Anthropic configuration
  try {
    const client = getAnthropicClient();
    if (client) {
      healthStatus.services.anthropic.configured = true;
    }
  } catch (error) {
    healthStatus.services.anthropic.configured = false;
    healthStatus.services.anthropic.error = error instanceof Error ? error.message : 'Unknown error';
    healthStatus.status = 'degraded';
  }

  // Determine overall health status
  if (!healthStatus.services.database.connected && !healthStatus.services.anthropic.configured) {
    healthStatus.status = 'unhealthy';
  }

  const statusCode = healthStatus.status === 'healthy' ? 200 :
                     healthStatus.status === 'degraded' ? 200 : 503;

  res.status(statusCode).json(healthStatus);
});

router.get('/health/liveness', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

router.get('/health/readiness', async (req: Request, res: Response) => {
  let isReady = true;
  const checks: Record<string, boolean> = {};

  // Check database readiness
  try {
    const pool = getPool();
    if (pool && pool.connected) {
      await pool.request().query('SELECT 1 as test');
      checks.database = true;
    } else {
      checks.database = false;
      isReady = false;
    }
  } catch {
    checks.database = false;
    isReady = false;
  }

  // Check Anthropic readiness
  try {
    const client = getAnthropicClient();
    checks.anthropic = !!client;
  } catch {
    checks.anthropic = false;
    // Anthropic is optional, so don't set isReady to false
  }

  res.status(isReady ? 200 : 503).json({
    ready: isReady,
    timestamp: new Date().toISOString(),
    checks
  });
});

export default router;
