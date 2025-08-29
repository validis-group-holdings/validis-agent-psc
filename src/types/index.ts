export interface UploadTableInfo {
  tableName: string;
  clientId: string;
  uploadDate: Date;
  recordCount: number;
  fileType: string;
  status: 'active' | 'archived' | 'processing';
}

export interface QueryResult {
  data: any[];
  rowCount: number;
  executionTime: number;
  query: string;
  timestamp: Date;
}

export interface FinancialQueryRequest {
  query: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
  maxResults?: number;
  useCache?: boolean;
}

export interface FinancialQueryResponse {
  success: boolean;
  data?: QueryResult;
  error?: string;
  cached?: boolean;
  suggestedTables?: string[];
<<<<<<< HEAD
}

// Safety layer types
export interface QueryAnalysis {
  tables: string[];
  operations: string[];
  hasUploadTable: boolean;
  hasClientIdFilter: boolean;
  isSelectOnly: boolean;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface QueryCostEstimate {
  estimatedRows: number;
  estimatedTime: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

export interface SafetyValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  modifiedQuery?: string;
}

export interface QueryQueueItem {
  id: string;
  query: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
  priority: number;
  requestedAt: Date;
  executedAt?: Date;
  completedAt?: Date;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'timeout';
  result?: QueryResult;
  error?: string;
}

export interface SafetyMetrics {
  totalQueries: number;
  blockedQueries: number;
  timeouts: number;
  averageExecutionTime: number;
  queueLength: number;
  concurrentExecutions: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
=======
>>>>>>> main
}