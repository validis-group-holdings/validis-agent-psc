/**
 * Agent Coordinator Service
 * Manages the flow between Orchestrator, Domain Agents (Lending/Audit), and Optimizer
 */

import winston from 'winston';
import {
  AgentCoordinationRequest,
  AgentCoordinationResponse,
  AgentCoordinationError,
  CoordinationFlowState,
  AgentHealthStatus,
  AgentCoordinatorConfig,
  CoordinatorCacheEntry,
  CoordinatorMetrics,
  AgentWarning
} from '../types/agent.types';

import {
  OrchestratorAgent,
  createOrchestratorAgent,
  UserQuery,
  OrchestratorResponse,
  AgentType,
  IntentType
} from '../agents/orchestrator';

import { LendingAgent, LendingQueryRequest, LendingQueryResponse } from '../agents/lending';

import { AuditAgent, AuditQueryRequest, AuditQueryResponse } from '../agents/audit';

import { QueryOptimizer, OptimizationRequest, OptimizationResponse } from '../agents/optimizer';

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple())
    })
  ]
});

/**
 * Main Agent Coordinator class
 */
export class AgentCoordinator {
  private orchestrator: OrchestratorAgent;
  private lendingAgent: LendingAgent;
  private auditAgent: AuditAgent;
  private optimizer: QueryOptimizer;
  private config: AgentCoordinatorConfig;
  private cache: Map<string, CoordinatorCacheEntry>;
  private metrics: CoordinatorMetrics;
  private healthStatus: Map<string, AgentHealthStatus>;
  private activeFlows: Map<string, CoordinationFlowState>;

  constructor(config?: Partial<AgentCoordinatorConfig>) {
    this.config = {
      defaultTimeout: config?.defaultTimeout || 10000, // 10 seconds
      maxRetries: config?.maxRetries || 2,
      enableOptimization: config?.enableOptimization !== false,
      enableCaching: config?.enableCaching !== false,
      cacheTimeout: config?.cacheTimeout || 300000, // 5 minutes
      debug: config?.debug || false
    };

    // Initialize agents
    this.orchestrator = createOrchestratorAgent({
      confidenceThreshold: 0.7,
      clarificationEnabled: true
    });
    this.lendingAgent = new LendingAgent();
    this.auditAgent = new AuditAgent();
    this.optimizer = new QueryOptimizer(this.config.debug);

    // Initialize internal state
    this.cache = new Map();
    this.activeFlows = new Map();
    this.healthStatus = new Map();
    this.metrics = this.initializeMetrics();

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Main coordination method - orchestrates the entire flow
   */
  async coordinate(request: AgentCoordinationRequest): Promise<AgentCoordinationResponse> {
    const startTime = Date.now();
    const flowId = `${request.sessionId}-${Date.now()}`;

    // Initialize flow state
    const flowState: CoordinationFlowState = {
      sessionId: request.sessionId,
      currentStep: 'orchestration',
      startTime
    };
    this.activeFlows.set(flowId, flowState);

    // Check cache if enabled
    if (this.config.enableCaching) {
      const cached = this.getCachedResponse(request);
      if (cached) {
        this.metrics.cacheHitRate++;
        logger.info('Cache hit for query', { sessionId: request.sessionId });
        return cached;
      }
    }

    try {
      // Validate request
      this.validateRequest(request);

      // Apply timeout wrapper
      const timeout = request.options?.timeout || this.config.defaultTimeout;
      const response = await this.executeWithTimeout(
        () => this.executeCoordinationFlow(request, flowState),
        timeout,
        request.sessionId
      );

      // Update metrics
      this.updateMetrics(true, Date.now() - startTime);

      // Cache successful response
      if (this.config.enableCaching && response.success) {
        this.cacheResponse(request, response);
      }

      // Clean up flow state
      this.activeFlows.delete(flowId);

      return response;
    } catch (error) {
      // Handle errors
      const errorResponse = this.handleCoordinationError(error, request, flowState, startTime);

      // Update metrics
      this.updateMetrics(false, Date.now() - startTime);

      // Clean up flow state
      this.activeFlows.delete(flowId);

      return errorResponse;
    }
  }

  /**
   * Execute the main coordination flow
   */
  private async executeCoordinationFlow(
    request: AgentCoordinationRequest,
    flowState: CoordinationFlowState
  ): Promise<AgentCoordinationResponse> {
    const metrics = {
      totalTime: 0,
      orchestrationTime: 0,
      domainAgentTime: 0,
      optimizationTime: 0
    };
    const warnings: AgentWarning[] = [];
    const errors: string[] = [];

    // Step 1: Orchestration
    logger.info('Starting orchestration', { sessionId: request.sessionId });
    const orchestrationStart = Date.now();
    flowState.currentStep = 'orchestration';

    const userQuery: UserQuery = {
      text: request.query,
      timestamp: new Date(),
      sessionId: request.sessionId,
      userId: request.userId
    };

    const orchestratorResponse = await this.executeWithRetry(
      () => this.orchestrator.orchestrate(userQuery),
      'orchestrator'
    );

    metrics.orchestrationTime = Date.now() - orchestrationStart;
    flowState.orchestrationState = {
      status: 'completed',
      agent: AgentType.ORCHESTRATOR,
      startTime: orchestrationStart,
      endTime: Date.now(),
      result: orchestratorResponse
    };

    // Check if clarification is needed
    if (orchestratorResponse.routing.requiresClarification) {
      logger.info('Clarification needed', { sessionId: request.sessionId });
      return this.createClarificationResponse(request, orchestratorResponse, metrics, warnings);
    }

    // Step 2: Route to appropriate domain agent
    logger.info('Routing to domain agent', {
      sessionId: request.sessionId,
      targetAgent: orchestratorResponse.routing.targetAgent
    });

    const domainStart = Date.now();
    flowState.currentStep = 'domain';

    let domainResponse: LendingQueryResponse | AuditQueryResponse | undefined;
    let sql: string | undefined;

    if (orchestratorResponse.routing.targetAgent === AgentType.LENDING) {
      // Route to Lending Agent
      const lendingRequest: LendingQueryRequest = {
        naturalLanguageQuery: request.query,
        clientId: request.clientId,

        includeExplanation: request.options?.includeExplanation,
        maxResults: request.options?.maxResults
      };

      domainResponse = await this.executeWithRetry(
        () => this.lendingAgent.processQuery(lendingRequest),
        'lending'
      );
      sql = (domainResponse as LendingQueryResponse).sql;

      // Add lending warnings
      if ((domainResponse as LendingQueryResponse).warnings) {
        warnings.push(
          ...(domainResponse as LendingQueryResponse).warnings!.map((w) => ({
            level: 'warning' as const,
            code: 'LENDING_WARNING',
            message: w,
            source: 'lending' as const
          }))
        );
      }
    } else if (orchestratorResponse.routing.targetAgent === AgentType.AUDIT) {
      // Route to Audit Agent
      if (!request.companyName) {
        throw new Error('Company name is required for audit queries');
      }

      const auditRequest: AuditQueryRequest = {
        naturalLanguageQuery: request.query,
        clientId: request.clientId,
        companyName: request.companyName,

        includeExplanation: request.options?.includeExplanation,
        maxResults: request.options?.maxResults,
        useLatestUpload: request.options?.useLatestUpload
      };

      domainResponse = await this.executeWithRetry(
        () => this.auditAgent.processQuery(auditRequest),
        'audit'
      );
      sql = (domainResponse as AuditQueryResponse).sql;

      // Add audit warnings
      if ((domainResponse as AuditQueryResponse).warnings) {
        warnings.push(
          ...(domainResponse as AuditQueryResponse).warnings!.map((w) => ({
            level: 'warning' as const,
            code: 'AUDIT_WARNING',
            message: w,
            source: 'audit' as const
          }))
        );
      }

      // Add audit risks as warnings
      if ((domainResponse as AuditQueryResponse).auditRisks) {
        const risks = (domainResponse as AuditQueryResponse).auditRisks!;
        warnings.push(
          ...risks.map((r) => ({
            level:
              r.level === 'high'
                ? ('error' as const)
                : r.level === 'medium'
                  ? ('warning' as const)
                  : ('info' as const),
            code: `AUDIT_RISK_${r.category.toUpperCase()}`,
            message: r.description,
            source: 'audit' as const,
            suggestion: r.recommendation
          }))
        );
      }
    }

    metrics.domainAgentTime = Date.now() - domainStart;
    flowState.domainAgentState = {
      status: 'completed',
      agent: orchestratorResponse.routing.targetAgent,
      startTime: domainStart,
      endTime: Date.now(),
      result: domainResponse
    };

    // Step 3: Optimize SQL if enabled
    let optimizationResponse: OptimizationResponse | undefined;
    let finalSql = sql;

    if (this.config.enableOptimization && sql && !request.options?.skipOptimization) {
      logger.info('Starting SQL optimization', { sessionId: request.sessionId });

      const optimizationStart = Date.now();
      flowState.currentStep = 'optimization';

      const optimizationRequest: OptimizationRequest = {
        sql,
        clientId: request.clientId,

        options: {
          maxRowLimit: request.options?.maxResults || 5000
        }
      };

      try {
        optimizationResponse = await this.executeWithRetry(
          () => this.optimizer.optimize(optimizationRequest),
          'optimizer'
        );

        if (optimizationResponse.isValid && optimizationResponse.optimizedSql) {
          finalSql = optimizationResponse.optimizedSql;

          // Add optimization warnings
          if (optimizationResponse.warnings) {
            warnings.push(
              ...optimizationResponse.warnings.map((w) => ({
                level: w.level,
                code: w.code,
                message: w.message,
                source: 'optimizer' as const,
                suggestion: w.suggestion
              }))
            );
          }
        } else if (optimizationResponse.errors) {
          errors.push(...optimizationResponse.errors);
        }

        metrics.optimizationTime = Date.now() - optimizationStart;
        flowState.optimizationState = {
          status: 'completed',
          agent: 'optimizer',
          startTime: optimizationStart,
          endTime: Date.now(),
          result: optimizationResponse
        };
      } catch (error) {
        logger.warn('Optimization failed, using original SQL', {
          sessionId: request.sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        warnings.push({
          level: 'warning',
          code: 'OPTIMIZATION_FAILED',
          message: 'SQL optimization failed, using original query',
          source: 'coordinator'
        });
        metrics.optimizationTime = Date.now() - optimizationStart;
      }
    }

    // Complete flow
    flowState.currentStep = 'completed';
    metrics.totalTime = Date.now() - flowState.startTime;

    // Build final response
    return {
      success: true,
      sessionId: request.sessionId,
      routing: {
        targetAgent: orchestratorResponse.routing.targetAgent,
        intent: orchestratorResponse.routing.intent.intent,
        confidence: orchestratorResponse.routing.intent.confidence,
        requiresClarification: false
      },
      domainResponse,
      optimizationResponse,
      finalSql,
      explanation: this.buildExplanation(
        orchestratorResponse,
        domainResponse,
        optimizationResponse
      ),
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
      metrics,
      templates: orchestratorResponse.templates?.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        relevanceScore: t.relevanceScore
      }))
    };
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    sessionId: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        logger.error('Operation timeout', { sessionId, timeout });
        throw new Error(AgentCoordinationError.TIMEOUT);
      }
      throw error;
    }
  }

  /**
   * Execute function with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    agentName: string,
    maxRetries: number = this.config.maxRetries
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();

        // Update health status on success
        this.updateHealthStatus(agentName, true);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        logger.warn(`Agent execution failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
          agent: agentName,
          error: lastError.message
        });

        // Update health status on failure
        this.updateHealthStatus(agentName, false);

        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
        }
      }
    }

    throw lastError || new Error(`Failed to execute ${agentName} after ${maxRetries} retries`);
  }

  /**
   * Validate coordination request
   */
  private validateRequest(request: AgentCoordinationRequest): void {
    if (!request.query || request.query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (!request.sessionId || request.sessionId.trim().length === 0) {
      throw new Error('Session ID is required');
    }

    if (!request.clientId || request.clientId.trim().length === 0) {
      throw new Error('Client ID is required');
    }

    // Validate timeout if specified
    if (request.options?.timeout) {
      if (request.options.timeout < 1000 || request.options.timeout > 30000) {
        throw new Error('Timeout must be between 1000ms and 30000ms');
      }
    }
  }

  /**
   * Build explanation from all agent responses
   */
  private buildExplanation(
    orchestratorResponse: OrchestratorResponse,
    domainResponse?: LendingQueryResponse | AuditQueryResponse,
    optimizationResponse?: OptimizationResponse
  ): string {
    const parts: string[] = [];

    // Add orchestrator explanation
    if (orchestratorResponse.response) {
      parts.push(orchestratorResponse.response);
    } else {
      parts.push(orchestratorResponse.routing.explanation);
    }

    // Add domain agent explanation
    if (domainResponse?.explanation) {
      parts.push('\n' + domainResponse.explanation);
    }

    // Add optimization explanation
    if (optimizationResponse?.explanation) {
      parts.push('\nOptimization Details:\n' + optimizationResponse.explanation);
    }

    return parts.join('\n');
  }

  /**
   * Create clarification response
   */
  private createClarificationResponse(
    request: AgentCoordinationRequest,
    orchestratorResponse: OrchestratorResponse,
    metrics: any,
    warnings: AgentWarning[]
  ): AgentCoordinationResponse {
    return {
      success: true,
      sessionId: request.sessionId,
      routing: {
        targetAgent: orchestratorResponse.routing.targetAgent,
        intent: orchestratorResponse.routing.intent.intent,
        confidence: orchestratorResponse.routing.intent.confidence,
        requiresClarification: true
      },
      explanation:
        orchestratorResponse.routing.clarificationPrompt ||
        'Please provide more information to help me understand your request better.',
      warnings,
      metrics: {
        ...metrics,
        totalTime: Date.now() - metrics.totalTime
      },
      templates: orchestratorResponse.templates?.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        relevanceScore: t.relevanceScore
      }))
    };
  }

  /**
   * Handle coordination errors
   */
  private handleCoordinationError(
    error: any,
    request: AgentCoordinationRequest,
    flowState: CoordinationFlowState,
    startTime: number
  ): AgentCoordinationResponse {
    logger.error('Coordination error', {
      sessionId: request.sessionId,
      step: flowState.currentStep,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // let errorType = AgentCoordinationError.UNKNOWN_ERROR;
    let errorMessage = 'An unexpected error occurred';

    if (error instanceof Error) {
      if (error.message === AgentCoordinationError.TIMEOUT) {
        // errorType = AgentCoordinationError.TIMEOUT;
        errorMessage = 'Request timed out. Please try again.';
      } else if (flowState.currentStep === 'orchestration') {
        // errorType = AgentCoordinationError.ORCHESTRATION_FAILED;
        errorMessage = 'Failed to understand your query. Please rephrase and try again.';
      } else if (flowState.currentStep === 'domain') {
        // errorType = AgentCoordinationError.DOMAIN_AGENT_FAILED;
        errorMessage = 'Failed to process your query. Please check your input and try again.';
      } else if (flowState.currentStep === 'optimization') {
        // errorType = AgentCoordinationError.OPTIMIZATION_FAILED;
        errorMessage = 'Failed to optimize query, but original query may still work.';
      }
    }

    return {
      success: false,
      sessionId: request.sessionId,
      routing: {
        targetAgent: AgentType.ORCHESTRATOR,
        intent: IntentType.AMBIGUOUS,
        confidence: 0,
        requiresClarification: false
      },
      errors: [errorMessage],
      metrics: {
        totalTime: Date.now() - startTime,
        orchestrationTime: flowState.orchestrationState?.endTime
          ? flowState.orchestrationState.endTime - flowState.orchestrationState.startTime
          : 0,
        domainAgentTime: flowState.domainAgentState?.endTime
          ? flowState.domainAgentState.endTime - flowState.domainAgentState.startTime
          : 0,
        optimizationTime: flowState.optimizationState?.endTime
          ? flowState.optimizationState.endTime - flowState.optimizationState.startTime
          : 0
      }
    };
  }

  /**
   * Cache management
   */
  private getCachedResponse(request: AgentCoordinationRequest): AgentCoordinationResponse | null {
    const cacheKey = this.generateCacheKey(request);
    const entry = this.cache.get(cacheKey);

    if (entry && entry.expiresAt > Date.now()) {
      entry.hits++;
      logger.debug('Cache hit', { key: cacheKey, hits: entry.hits });
      return entry.response;
    }

    if (entry) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  private cacheResponse(
    request: AgentCoordinationRequest,
    response: AgentCoordinationResponse
  ): void {
    const cacheKey = this.generateCacheKey(request);
    const entry: CoordinatorCacheEntry = {
      key: cacheKey,
      response,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.cacheTimeout,
      hits: 0
    };

    this.cache.set(cacheKey, entry);

    // Clean up old cache entries
    this.cleanupCache();
  }

  private generateCacheKey(request: AgentCoordinationRequest): string {
    return `${request.clientId}:${request.companyName || 'portfolio'}:${request.query}`;
  }

  private cleanupCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (entry.expiresAt <= now) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Health monitoring
   */
  private startHealthMonitoring(): void {
    // Initial health check
    this.updateHealthStatus('orchestrator', true);
    this.updateHealthStatus('lending', true);
    this.updateHealthStatus('audit', true);
    this.updateHealthStatus('optimizer', true);

    // Periodic health checks
    setInterval(() => {
      this.performHealthChecks();
    }, 60000); // Check every minute
  }

  private async performHealthChecks(): Promise<void> {
    // Test each agent with a simple query
    const testQueries = {
      orchestrator: async () => {
        const query: UserQuery = {
          text: 'health check',
          timestamp: new Date(),
          sessionId: 'health-check'
        };
        await this.orchestrator.orchestrate(query);
      },
      lending: async () => {
        await this.lendingAgent.initialize();
      },
      audit: async () => {
        await this.auditAgent.initialize();
      },
      optimizer: async () => {
        await this.optimizer.validate('SELECT 1', 'health-check');
      }
    };

    for (const [agent, check] of Object.entries(testQueries)) {
      try {
        const start = Date.now();
        await check();
        const responseTime = Date.now() - start;

        this.updateHealthStatus(agent, true, responseTime);
      } catch (error) {
        this.updateHealthStatus(agent, false);
        logger.warn(`Health check failed for ${agent}`, { error });
      }
    }
  }

  private updateHealthStatus(agent: string, success: boolean, responseTime?: number): void {
    const current = this.healthStatus.get(agent) || {
      agent: agent as any,
      status: 'healthy' as const,
      lastCheck: new Date(),
      successRate: 100,
      errorRate: 0
    };

    // Update success/error rates
    const alpha = 0.1; // Exponential moving average factor
    current.successRate = success
      ? (current.successRate || 0) * (1 - alpha) + 100 * alpha
      : (current.successRate || 0) * (1 - alpha);
    current.errorRate = 100 - current.successRate;

    // Update response time
    if (responseTime !== undefined) {
      if ('responseTime' in current) {
        current.responseTime = current.responseTime
          ? current.responseTime * (1 - alpha) + responseTime * alpha
          : responseTime;
      }
    }

    // Determine health status
    if (current.successRate >= 90) {
      current.status = 'healthy';
    } else if (current.successRate >= 70) {
      current.status = 'degraded';
    } else {
      current.status = 'unhealthy';
    }

    current.lastCheck = new Date();
    this.healthStatus.set(agent, current);
  }

  /**
   * Metrics management
   */
  private initializeMetrics(): CoordinatorMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      agentMetrics: new Map()
    };
  }

  private updateMetrics(success: boolean, responseTime: number): void {
    this.metrics.totalRequests++;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update average response time (exponential moving average)
    const alpha = 0.1;
    this.metrics.averageResponseTime =
      this.metrics.averageResponseTime * (1 - alpha) + responseTime * alpha;

    // Update cache hit rate
    if (this.metrics.totalRequests > 0) {
      this.metrics.cacheHitRate = (this.metrics.cacheHitRate / this.metrics.totalRequests) * 100;
    }
  }

  /**
   * Public API methods
   */

  /**
   * Get current health status of all agents
   */
  getHealthStatus(): Map<string, AgentHealthStatus> {
    return new Map(this.healthStatus);
  }

  /**
   * Get current metrics
   */
  getMetrics(): CoordinatorMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get active flows
   */
  getActiveFlows(): CoordinationFlowState[] {
    return Array.from(this.activeFlows.values());
  }

  /**
   * Initialize all agents
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Agent Coordinator...');

    try {
      // Initialize agents in parallel
      await Promise.all([this.lendingAgent.initialize(), this.auditAgent.initialize()]);

      logger.info('Agent Coordinator initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Agent Coordinator', { error });
      throw error;
    }
  }

  /**
   * Shutdown coordinator
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Agent Coordinator...');

    // Clear cache
    this.clearCache();

    // Clear active flows
    this.activeFlows.clear();

    // Clear sessions
    const sessions = Array.from(this.activeFlows.keys());
    sessions.forEach((sessionId) => {
      this.orchestrator.clearSession(sessionId);
    });

    logger.info('Agent Coordinator shutdown complete');
  }
}

// Export singleton instance
export const agentCoordinator = new AgentCoordinator();

// Export default
export default agentCoordinator;
