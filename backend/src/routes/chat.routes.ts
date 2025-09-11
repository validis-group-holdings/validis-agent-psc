/**
 * Chat API Routes
 * Handles natural language query processing through the agent system
 */

import { Router, Request, Response } from 'express';
import { AgentCoordinator } from '../services/agent-coordinator';
import {
  validateChatRequest,
  ChatRequest,
  addRequestId,
  logRequest
} from '../middleware/validation';
import { chatRateLimiter, adminRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../config/logger';
import { AgentCoordinationRequest, AgentCoordinationResponse } from '../types/agent.types';

const router = Router();

// Initialize agent coordinator
const agentCoordinator = new AgentCoordinator({
  defaultTimeout: 10000,
  maxRetries: 2,
  enableOptimization: true,
  enableCaching: true,
  cacheTimeout: 300000, // 5 minutes
  debug: process.env.NODE_ENV === 'development'
});

// Ensure agent coordinator is initialized
agentCoordinator.initialize().catch((error) => {
  logger.error('Failed to initialize agent coordinator', { error });
});

/**
 * SSE event formatter
 */
function formatSSEEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Send SSE progress update
 */
function sendProgress(res: Response, step: string, message: string, progress?: number) {
  const event = formatSSEEvent('progress', {
    step,
    message,
    progress,
    timestamp: new Date().toISOString()
  });
  res.write(event);
}

/**
 * POST /api/chat
 * Process natural language queries through the agent system
 */
router.post(
  '/chat',
  addRequestId,
  logRequest,
  chatRateLimiter, // Add rate limiting
  validateChatRequest,
  async (req: Request<{}, {}, ChatRequest>, res: Response): Promise<Response | void> => {
    const startTime = Date.now();
    const { query, sessionId, clientId, userId, companyName, uploadId, options } = req.body;
    const requestId = (req as any).id;

    try {
      // Check if streaming is requested
      if (options?.stream) {
        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Request-Id', requestId);

        // Send initial connection event
        res.write(
          formatSSEEvent('connected', {
            message: 'Connected to agent system',
            sessionId,
            requestId
          })
        );

        // Process with streaming updates
        await processWithStreaming(
          res,
          {
            query,
            sessionId,
            clientId,
            userId,
            companyName,
            uploadId,
            options: {
              ...options,
              debug: options?.debug || false
            }
          },
          requestId
        );

        return;
      }

      // Non-streaming response
      const coordinationRequest: AgentCoordinationRequest = {
        query,
        sessionId,
        clientId,
        userId,
        companyName,
        uploadId,
        options: {
          skipOptimization: options?.skipOptimization,
          timeout: options?.timeout || 10000,
          includeExplanation: options?.includeExplanation !== false,
          maxResults: options?.maxResults || 5000,
          useLatestUpload: options?.useLatestUpload,
          debug: options?.debug
        }
      };

      logger.info('Processing chat request', {
        requestId,
        sessionId,
        clientId,
        queryLength: query.length
      });

      // Process through agent coordinator
      const response = await agentCoordinator.coordinate(coordinationRequest);

      // Calculate total processing time
      const processingTime = Date.now() - startTime;

      // Log completion
      logger.info('Chat request completed', {
        requestId,
        sessionId,
        success: response.success,
        processingTime: `${processingTime}ms`,
        targetAgent: response.routing.targetAgent,
        intent: response.routing.intent
      });

      // Format response
      const apiResponse = {
        success: response.success,
        requestId,
        sessionId: response.sessionId,
        data: {
          sql: response.finalSql,
          explanation: response.explanation,
          routing: {
            agent: response.routing.targetAgent,
            intent: response.routing.intent,
            confidence: response.routing.confidence,
            requiresClarification: response.routing.requiresClarification
          },
          warnings: response.warnings,
          templates: response.templates
        },
        metrics: {
          ...response.metrics,
          totalTime: processingTime
        }
      };

      // Handle clarification needed
      if (response.routing.requiresClarification) {
        return res.status(200).json({
          ...apiResponse,
          requiresClarification: true,
          clarificationMessage: response.explanation
        });
      }

      // Handle errors
      if (!response.success || response.errors) {
        return res.status(400).json({
          ...apiResponse,
          success: false,
          errors: response.errors || ['Query processing failed']
        });
      }

      // Success response
      res.json(apiResponse);
    } catch (error) {
      logger.error('Chat endpoint error', {
        requestId,
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      res.status(500).json({
        success: false,
        requestId,
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Failed to process chat request'
      });
    }
  }
);

/**
 * Process request with streaming updates
 */
async function processWithStreaming(
  res: Response,
  request: AgentCoordinationRequest,
  requestId: string
): Promise<void> {
  let isConnectionClosed = false;

  // Handle client disconnect
  res.on('close', () => {
    isConnectionClosed = true;
    logger.info('SSE connection closed by client', {
      requestId,
      sessionId: request.sessionId
    });
  });

  try {
    // Send orchestration started
    if (!isConnectionClosed) {
      sendProgress(res, 'orchestration', 'Analyzing your query...', 10);
    }

    // Create a custom coordinator that provides progress updates
    const response = await processWithProgressUpdates(
      request,
      (step: string, message: string, progress?: number) => {
        if (!isConnectionClosed) {
          sendProgress(res, step, message, progress);
        }
      }
    );

    // Send final response
    if (!isConnectionClosed) {
      res.write(
        formatSSEEvent('complete', {
          success: response.success,
          sql: response.finalSql,
          explanation: response.explanation,
          routing: {
            agent: response.routing.targetAgent,
            intent: response.routing.intent,
            confidence: response.routing.confidence
          },
          warnings: response.warnings,
          templates: response.templates,
          metrics: response.metrics
        })
      );

      // Send done event
      res.write(
        formatSSEEvent('done', {
          message: 'Processing complete',
          requestId
        })
      );
    }
  } catch (error) {
    logger.error('Streaming error', {
      requestId,
      sessionId: request.sessionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (!isConnectionClosed) {
      res.write(
        formatSSEEvent('error', {
          message: error instanceof Error ? error.message : 'Processing failed',
          requestId
        })
      );
    }
  } finally {
    res.end();
  }
}

/**
 * Process with progress updates
 */
async function processWithProgressUpdates(
  request: AgentCoordinationRequest,
  onProgress: (step: string, message: string, progress?: number) => void
): Promise<AgentCoordinationResponse> {
  // Orchestration phase
  onProgress('orchestration', 'Understanding your query...', 20);

  // Use the agent coordinator
  const response = await agentCoordinator.coordinate(request);

  // Update progress based on routing
  if (response.routing.targetAgent) {
    onProgress('routing', `Routing to ${response.routing.targetAgent} agent...`, 40);
  }

  // Domain processing
  if (response.domainResponse) {
    onProgress('domain', 'Processing domain-specific logic...', 60);
  }

  // Optimization
  if (response.optimizationResponse) {
    onProgress('optimization', 'Optimizing SQL query...', 80);
  }

  // Final validation
  onProgress('validation', 'Validating results...', 95);

  return response;
}

/**
 * GET /api/chat/health
 * Check health status of agent system
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const healthStatus = agentCoordinator.getHealthStatus();
    const metrics = agentCoordinator.getMetrics();

    // Check if all agents are healthy
    let overallHealth = 'healthy';
    const agentStatuses: any[] = [];

    healthStatus.forEach((status, agent) => {
      agentStatuses.push({
        agent,
        status: status.status,
        lastCheck: status.lastCheck,
        responseTime: status.responseTime,
        successRate: status.successRate
      });

      if (status.status === 'unhealthy') {
        overallHealth = 'unhealthy';
      } else if (status.status === 'degraded' && overallHealth !== 'unhealthy') {
        overallHealth = 'degraded';
      }
    });

    res.json({
      success: true,
      status: overallHealth,
      agents: agentStatuses,
      metrics: {
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        averageResponseTime: Math.round(metrics.averageResponseTime),
        cacheHitRate: metrics.cacheHitRate.toFixed(2) + '%'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      success: false,
      status: 'error',
      error: 'Failed to check agent system health'
    });
  }
});

/**
 * POST /api/chat/clear-cache
 * Clear the agent coordinator cache
 */
router.post('/clear-cache', adminRateLimiter, async (_req: Request, res: Response) => {
  try {
    agentCoordinator.clearCache();

    logger.info('Cache cleared successfully');

    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    logger.error('Failed to clear cache', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

/**
 * GET /api/chat/active-flows
 * Get currently active coordination flows
 */
router.get('/active-flows', async (_req: Request, res: Response) => {
  try {
    const activeFlows = agentCoordinator.getActiveFlows();

    res.json({
      success: true,
      count: activeFlows.length,
      flows: activeFlows.map((flow) => ({
        sessionId: flow.sessionId,
        currentStep: flow.currentStep,
        startTime: new Date(flow.startTime).toISOString(),
        duration: Date.now() - flow.startTime
      }))
    });
  } catch (error) {
    logger.error('Failed to get active flows', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get active flows'
    });
  }
});

export default router;
