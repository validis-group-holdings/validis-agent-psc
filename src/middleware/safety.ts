import { Request, Response, NextFunction } from 'express';
import { QueryValidator } from '@/safety/validator';
import { QueryGovernor } from '@/safety/governor';
import { QueryCostEstimator } from '@/safety/estimator';
import { QueryQueueManager } from '@/safety/queue';
import { OverloadProtection } from '@/safety/circuitBreaker';
import { config } from '@/config';
import { FinancialQueryRequest, FinancialQueryResponse } from '@/types';
import { sessionManager } from '@/session/manager';
import { modeManager } from '@/modes';

/**
 * Safety middleware for query interception and protection
 */

interface SafetyRequest extends Request {
  queryAnalysis?: any;
  estimatedCost?: any;
  safetyValidation?: any;
  sessionId?: string;
  sessionContext?: any;
}

/**
 * Session validation middleware - checks and initializes session context
 */
export const sessionValidation = async (
  req: SafetyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { clientId, workflowMode } = req.body as FinancialQueryRequest;
    const sessionId = req.headers['x-session-id'] as string;
    
    if (!clientId || !workflowMode) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: clientId, workflowMode'
      });
      return;
    }

    let sessionContext;
    
    if (sessionId) {
      // Try to get existing session
      sessionContext = await sessionManager.getSession(sessionId);
      
      if (!sessionContext) {
        res.status(401).json({
          success: false,
          error: 'Session not found or expired',
          requiresNewSession: true
        });
        return;
      }
      
      // Validate session matches request
      if (sessionContext.clientId !== clientId || sessionContext.mode !== workflowMode) {
        res.status(400).json({
          success: false,
          error: 'Session context mismatch with request parameters'
        });
        return;
      }
      
      // Update session activity
      sessionContext = await sessionManager.updateSession(sessionContext);
      
    } else {
      // Create new session
      const uploadId = req.body.uploadId;
      sessionContext = await sessionManager.createSession(clientId, workflowMode, uploadId);
      
      // Set session ID in response header for client to use
      res.setHeader('x-session-id', sessionContext.sessionId);
    }

    // Store session context in request
    req.sessionId = sessionContext.sessionId;
    req.sessionContext = sessionContext;

    next();
    
  } catch (error) {
    console.error('Error in session validation:', error);
    res.status(500).json({
      success: false,
      error: 'Session validation failed'
    });
  }
};

/**
 * Pre-execution safety check middleware
 */
export const querySafetyCheck = async (
  req: SafetyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { query } = req.body as FinancialQueryRequest;
    const sessionContext = req.sessionContext;
    
    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Query is required'
      });
      return;
    }

    if (!sessionContext) {
      res.status(401).json({
        success: false,
        error: 'Session context required - ensure session validation middleware runs first'
      });
      return;
    }

    // Check system overload first
    const loadCheck = OverloadProtection.canAcceptQuery();
    if (!loadCheck.canAccept) {
      res.status(429).json({
        success: false,
        error: `System overloaded: ${loadCheck.reason}`,
        retryAfter: Math.ceil((loadCheck.waitTime || 1000) / 1000)
      });
      return;
    }

    // Session-based query validation using mode constraints
    const sessionValidation = await sessionManager.validateSessionQuery(req.sessionId!, query);
    if (!sessionValidation.isValid) {
      res.status(400).json({
        success: false,
        error: 'Query validation failed',
        details: sessionValidation.errors,
        warnings: sessionValidation.warnings,
        sessionValid: sessionValidation.session !== null
      });
      return;
    }

    // Quick cost check
    const costCheck = QueryCostEstimator.quickCostCheck(query);
    if (!costCheck.isAcceptable) {
      res.status(400).json({
        success: false,
        error: `Query rejected: ${costCheck.reason}`
      });
      return;
    }

    // Store analysis for later use
    req.queryAnalysis = {
      validated: true,
      complexity: costCheck.estimatedComplexity,
      sessionValidation: sessionValidation.validation,
      modeConstraints: modeManager.getModeConstraints(sessionContext.mode)
    };

    next();
    
  } catch (error) {
    console.error('Error in query safety check:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during safety check'
    });
  }
};

/**
 * Full validation and governance middleware
 */
export const queryValidationAndGovernance = async (
  req: SafetyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { query, maxResults } = req.body as FinancialQueryRequest;
    const sessionContext = req.sessionContext;

    if (!sessionContext) {
      res.status(401).json({
        success: false,
        error: 'Session context required'
      });
      return;
    }

    // Apply session-based mode constraints
    const constraintApplication = await sessionManager.applySessionConstraints(req.sessionId!, query);
    if (constraintApplication.errors.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Failed to apply mode constraints',
        details: constraintApplication.errors
      });
      return;
    }

    const modifiedQuery = constraintApplication.modification.modifiedQuery;
    const appliedConstraints = constraintApplication.modification.appliedConstraints;

    // Legacy validation for additional safety
    const validation = await QueryValidator.validate(modifiedQuery, sessionContext.clientId, sessionContext.mode);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        error: 'Query validation failed after mode constraints',
        details: validation.errors,
        warnings: validation.warnings
      });
      return;
    }

    // Get system load for adaptive governance
    const loadStats = OverloadProtection.getLoadStats();
    
    // Apply governance with adaptive limits
    const governance = QueryGovernor.adaptiveGovernance(
      modifiedQuery, 
      loadStats.loadLevel, 
      sessionContext.clientId, 
      sessionContext.mode
    );
    
    if (!governance.isValid) {
      res.status(429).json({
        success: false,
        error: 'Query blocked by governance policies',
        details: governance.errors,
        systemLoad: loadStats.loadLevel
      });
      return;
    }

    // Cost estimation for monitoring
    const costEstimate = await QueryCostEstimator.estimate(
      governance.modifiedQuery || modifiedQuery
    );

    // Store results for execution
    req.safetyValidation = {
      originalQuery: query,
      governedQuery: governance.modifiedQuery || modifiedQuery,
      validation,
      governance,
      costEstimate,
      modeConstraints: constraintApplication.modification,
      appliedConstraints,
      warnings: [
        ...validation.warnings, 
        ...governance.warnings,
        ...constraintApplication.modification.warnings
      ],
      maxResults: maxResults || modeManager.getModeConstraints(sessionContext.mode).maxRowsPerQuery
    };

    next();
    
  } catch (error) {
    console.error('Error in query validation and governance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during validation'
    });
  }
};

/**
 * Queue-based execution middleware
 */
export const queuedExecution = async (
  req: SafetyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionContext = req.sessionContext;
    const { governedQuery, costEstimate, appliedConstraints } = req.safetyValidation;

    if (!sessionContext) {
      res.status(401).json({
        success: false,
        error: 'Session context required'
      });
      return;
    }

    // Determine priority based on cost estimate and mode
    let priority = 5; // Normal priority
    if (costEstimate.riskLevel === 'low') priority = 3;
    else if (costEstimate.riskLevel === 'high') priority = 7;
    else if (costEstimate.riskLevel === 'critical') priority = 9;
    
    // Adjust priority based on mode
    if (sessionContext.mode === 'audit') priority += 1; // Audit gets slightly higher priority

    // Enqueue the query
    const queueManager = QueryQueueManager.getInstance();
    const { queryId, estimatedWait } = await queueManager.enqueueQuery(
      governedQuery,
      sessionContext.clientId,
      sessionContext.mode,
      priority
    );

    // Return immediate response with query tracking info
    res.json({
      success: true,
      queryId,
      sessionId: sessionContext.sessionId,
      status: 'queued',
      estimatedWait,
      mode: sessionContext.mode,
      appliedConstraints,
      warnings: req.safetyValidation.warnings,
      costEstimate: {
        riskLevel: costEstimate.riskLevel,
        estimatedTime: costEstimate.estimatedTime,
        recommendations: costEstimate.recommendations
      },
      modeRecommendations: sessionManager.getSessionRecommendations(sessionContext.sessionId)
    } as FinancialQueryResponse);
    
  } catch (error) {
    console.error('Error in queued execution:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Queue execution failed'
    });
  }
};

/**
 * Query status endpoint middleware
 */
export const queryStatus = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const { queryId } = req.params;
    
    if (!queryId) {
      res.status(400).json({
        success: false,
        error: 'Query ID is required'
      });
      return;
    }

    const queueManager = QueryQueueManager.getInstance();
    const status = queueManager.getQueryStatus(queryId);

    if (!status) {
      res.status(404).json({
        success: false,
        error: 'Query not found'
      });
      return;
    }

    res.json({
      success: true,
      queryId,
      status: status.status,
      requestedAt: status.requestedAt,
      executedAt: status.executedAt,
      completedAt: status.completedAt,
      result: status.result,
      error: status.error
    });
    
  } catch (error) {
    console.error('Error getting query status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get query status'
    });
  }
};

/**
 * System metrics middleware
 */
export const systemMetrics = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const queueManager = QueryQueueManager.getInstance();
    const queueStats = queueManager.getQueueStats();
    const loadStats = OverloadProtection.getLoadStats();

    res.json({
      success: true,
      metrics: {
        queue: queueStats,
        system: loadStats,
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    console.error('Error getting system metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system metrics'
    });
  }
};

/**
 * Emergency controls middleware
 */
export const emergencyControls = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const { action } = req.body;

    if (!action || !['stop', 'clear', 'reset'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Must be: stop, clear, or reset'
      });
      return;
    }

    const queueManager = QueryQueueManager.getInstance();

    let result;
    switch (action) {
      case 'stop':
        result = queueManager.emergencyStop();
        break;
      case 'clear':
        result = { clearedCompleted: queueManager.clearCompleted() };
        break;
      case 'reset':
        OverloadProtection.reset();
        result = { message: 'System metrics reset' };
        break;
    }

    res.json({
      success: true,
      action,
      result
    });
    
  } catch (error) {
    console.error('Error in emergency controls:', error);
    res.status(500).json({
      success: false,
      error: 'Emergency control action failed'
    });
  }
};

/**
 * Request logging middleware for audit trail
 */
export const auditLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  const originalSend = res.json;

  // Override res.json to capture response
  res.json = function(data: any): Response {
    const duration = Date.now() - startTime;
    
    // Log audit trail
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      clientId: req.body?.clientId,
      queryId: data?.queryId,
      status: data?.success ? 'success' : 'error',
      duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      warnings: req.body?.warnings || [],
      error: data?.error
    }));

    return originalSend.call(this, data);
  };

  next();
};

/**
 * Rate limiting middleware per client
 */
export const clientRateLimit = (() => {
  const clientRequests = new Map<string, number[]>();
  const WINDOW_SIZE = 60000; // 1 minute
  const MAX_REQUESTS = 20; // 20 requests per minute per client

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const clientId = req.body?.clientId || req.headers['x-client-id'] as string;
      
      if (!clientId) {
        res.status(400).json({
          success: false,
          error: 'Client ID is required'
        });
        return;
      }

      const now = Date.now();
      const windowStart = now - WINDOW_SIZE;
      
      // Get or create client request history
      let requests = clientRequests.get(clientId) || [];
      
      // Remove old requests outside the window
      requests = requests.filter(time => time > windowStart);
      
      // Check rate limit
      if (requests.length >= MAX_REQUESTS) {
        res.status(429).json({
          success: false,
          error: 'Rate limit exceeded for client',
          retryAfter: Math.ceil(WINDOW_SIZE / 1000)
        });
        return;
      }

      // Add current request
      requests.push(now);
      clientRequests.set(clientId, requests);

      next();
      
    } catch (error) {
      console.error('Error in client rate limiting:', error);
      res.status(500).json({
        success: false,
        error: 'Rate limiting error'
      });
    }
  };
})();