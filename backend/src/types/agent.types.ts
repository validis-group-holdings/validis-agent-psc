/**
 * Core types for Agent Coordination System
 */

import {
  AgentType,
  IntentType,
  OrchestratorResponse,
  UserQuery
} from '../agents/orchestrator/types';
import {
  LendingQueryRequest,
  LendingQueryResponse
} from '../agents/lending/types';
import {
  AuditQueryRequest,
  AuditQueryResponse
} from '../agents/audit/types';
import {
  OptimizationRequest,
  OptimizationResponse
} from '../agents/optimizer/types';

/**
 * Agent coordination request
 */
export interface AgentCoordinationRequest {
  query: string;
  sessionId: string;
  clientId: string;
  userId?: string;
  companyName?: string;
  uploadId?: string;
  options?: AgentCoordinationOptions;
}

/**
 * Options for agent coordination
 */
export interface AgentCoordinationOptions {
  skipOptimization?: boolean;
  timeout?: number; // in milliseconds, default 10000
  includeExplanation?: boolean;
  maxResults?: number;
  useLatestUpload?: boolean;
  debug?: boolean;
}

/**
 * Final response from agent coordination
 */
export interface AgentCoordinationResponse {
  success: boolean;
  sessionId: string;

  // Orchestration results
  routing: {
    targetAgent: AgentType;
    intent: IntentType;
    confidence: number;
    requiresClarification: boolean;
  };

  // Domain agent results (either lending or audit)
  domainResponse?: LendingQueryResponse | AuditQueryResponse;

  // Optimizer results
  optimizationResponse?: OptimizationResponse;

  // Final SQL and metadata
  finalSql?: string;
  explanation?: string;
  warnings?: AgentWarning[];
  errors?: string[];

  // Performance metrics
  metrics: {
    totalTime: number;
    orchestrationTime: number;
    domainAgentTime: number;
    optimizationTime: number;
  };

  // Templates if suggested
  templates?: Array<{
    id: string;
    name: string;
    description: string;
    relevanceScore: number;
  }>;
}

/**
 * Warning structure for coordination
 */
export interface AgentWarning {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  source: 'orchestrator' | 'lending' | 'audit' | 'optimizer' | 'coordinator';
  suggestion?: string;
}

/**
 * Agent execution state
 */
export interface AgentExecutionState {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  agent: AgentType | 'optimizer';
  startTime: number;
  endTime?: number;
  error?: string;
  result?: any;
}

/**
 * Coordination flow state
 */
export interface CoordinationFlowState {
  sessionId: string;
  currentStep: 'orchestration' | 'domain' | 'optimization' | 'completed';
  orchestrationState?: AgentExecutionState;
  domainAgentState?: AgentExecutionState;
  optimizationState?: AgentExecutionState;
  startTime: number;
  endTime?: number;
}

/**
 * Error types for agent coordination
 */
export enum AgentCoordinationError {
  TIMEOUT = 'TIMEOUT',
  ORCHESTRATION_FAILED = 'ORCHESTRATION_FAILED',
  DOMAIN_AGENT_FAILED = 'DOMAIN_AGENT_FAILED',
  OPTIMIZATION_FAILED = 'OPTIMIZATION_FAILED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  CLARIFICATION_NEEDED = 'CLARIFICATION_NEEDED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Agent health status
 */
export interface AgentHealthStatus {
  agent: AgentType | 'optimizer';
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  responseTime?: number;
  errorRate?: number;
  successRate?: number;
}

/**
 * Coordinator configuration
 */
export interface AgentCoordinatorConfig {
  defaultTimeout: number;
  maxRetries: number;
  enableOptimization: boolean;
  enableCaching: boolean;
  cacheTimeout: number;
  debug: boolean;
}

/**
 * Agent communication interface
 */
export interface AgentCommunication {
  sendToOrchestrator(query: UserQuery): Promise<OrchestratorResponse>;
  sendToLending(request: LendingQueryRequest): Promise<LendingQueryResponse>;
  sendToAudit(request: AuditQueryRequest): Promise<AuditQueryResponse>;
  sendToOptimizer(request: OptimizationRequest): Promise<OptimizationResponse>;
}

/**
 * Cache entry for coordinator
 */
export interface CoordinatorCacheEntry {
  key: string;
  response: AgentCoordinationResponse;
  timestamp: number;
  expiresAt: number;
  hits: number;
}

/**
 * Metrics for monitoring
 */
export interface CoordinatorMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeouts: number;
  averageResponseTime: number;
  cacheHitRate: number;
  agentMetrics: Map<string, {
    calls: number;
    failures: number;
    avgResponseTime: number;
  }>;
}
