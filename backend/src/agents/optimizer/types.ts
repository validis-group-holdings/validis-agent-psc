/**
 * TypeScript interfaces for the Query Optimizer Agent
 */

import { AST } from 'node-sql-parser';

export interface OptimizationRequest {
  sql: string;
  clientId: string;
  uploadId?: string;
  context?: QueryContext;
  options?: OptimizationOptions;
}

export interface OptimizationResponse {
  originalSql: string;
  optimizedSql: string;
  isValid: boolean;
  isSafe: boolean;
  optimizations: OptimizationResult[];
  performanceAnalysis: PerformanceAnalysis;
  warnings: Warning[];
  errors?: string[];
  explanation: string;
}

export interface QueryContext {
  domain: 'audit' | 'lending' | 'general';
  maxResults?: number;
  timeWindow?: TimeWindow;
  requiredFilters?: string[];
  environment?: 'production' | 'staging' | 'development';
}

export interface TimeWindow {
  start?: Date;
  end?: Date;
  months?: number;
}

export interface OptimizationOptions {
  enforceUploadId?: boolean; // Default true
  enforceClientId?: boolean; // Default true
  maxRowLimit?: number; // Default 5000
  blockDangerousOps?: boolean; // Default true
  optimizeJoins?: boolean; // Default true
  addCTEs?: boolean; // Default true
  analyzePerformance?: boolean; // Default true
}

export interface OptimizationResult {
  type: OptimizationType;
  description: string;
  impact: 'high' | 'medium' | 'low';
  applied: boolean;
  details?: string;
}

export type OptimizationType =
  | 'index_usage'
  | 'row_limit'
  | 'multi_tenant_filter'
  | 'time_window'
  | 'join_optimization'
  | 'cte_addition'
  | 'predicate_pushdown'
  | 'column_pruning'
  | 'subquery_optimization'
  | 'dangerous_operation_blocked';

export interface PerformanceAnalysis {
  estimatedRows?: number;
  estimatedCost?: number;
  usesIndexes: boolean;
  indexesUsed: string[];
  scanType: 'index_seek' | 'index_scan' | 'table_scan' | 'clustered_index_scan';
  warnings: string[];
  recommendations: string[];
  score: number; // 0-100
}

export interface Warning {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestion?: string;
}

export interface ParsedQuery {
  ast: AST | AST[];
  type: QueryType;
  tables: TableReference[];
  columns: string[];
  whereConditions: WhereCondition[];
  joins: JoinInfo[];
  limit?: number;
  orderBy?: OrderByClause[];
  groupBy?: string[];
  having?: any;
  ctes?: CTEInfo[];
}

export type QueryType =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'drop'
  | 'alter'
  | 'create'
  | 'truncate'
  | 'other';

export interface TableReference {
  name: string;
  alias?: string;
  database?: string;
  schema?: string;
}

export interface WhereCondition {
  column: string;
  operator: string;
  value: any;
  type: 'simple' | 'complex' | 'subquery';
}

export interface JoinInfo {
  type: 'inner' | 'left' | 'right' | 'full' | 'cross';
  table: TableReference;
  condition: string;
  columns: string[];
}

export interface OrderByClause {
  column: string;
  direction: 'asc' | 'desc';
}

export interface CTEInfo {
  name: string;
  columns?: string[];
  query: string;
  recursive?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  isSafe: boolean;
  violations: Violation[];
}

export interface Violation {
  type: ViolationType;
  severity: 'error' | 'warning';
  message: string;
  location?: string;
}

export type ViolationType =
  | 'missing_upload_id'
  | 'missing_client_id'
  | 'missing_row_limit'
  | 'excessive_row_limit'
  | 'dangerous_operation'
  | 'missing_index'
  | 'inefficient_join'
  | 'missing_time_window'
  | 'broad_time_range'
  | 'wildcard_select'
  | 'cartesian_product'
  | 'missing_where_clause';

export interface OptimizationRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  condition: (query: ParsedQuery, context?: QueryContext) => boolean;
  apply: (query: ParsedQuery, context?: QueryContext) => OptimizationAction;
}

export interface OptimizationAction {
  type: 'modify' | 'reject' | 'warning';
  modifications?: QueryModification[];
  message?: string;
  impact: 'high' | 'medium' | 'low';
}

export interface QueryModification {
  type: 'add_filter' | 'add_limit' | 'add_cte' | 'modify_join' | 'add_index_hint' | 'rewrite_subquery';
  target: string;
  value: any;
  description: string;
}

export interface IndexInfo {
  tableName: string;
  indexName: string;
  columns: string[];
  isUnique: boolean;
  isClustered: boolean;
  isPrimary: boolean;
}

export interface TableStatistics {
  tableName: string;
  rowCount: number;
  sizeInMB: number;
  lastUpdated: Date;
  indexes: IndexInfo[];
}
