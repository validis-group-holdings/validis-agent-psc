/**
 * TypeScript interfaces for the Lending Agent
 */

export interface LendingQueryRequest {
  naturalLanguageQuery: string;
  clientId: string;
  parameters?: Record<string, any>;
  includeExplanation?: boolean;
  maxResults?: number;
}

export interface LendingQueryResponse {
  sql: string;
  explanation?: string;
  confidence: number;
  queryType: 'portfolio' | 'aggregation' | 'analysis';
  involvedTables: string[];
  expectedColumns: string[];
  performanceNotes?: string[];
  suggestedParameters?: Record<string, any>;
  warnings?: string[];
}

export interface PortfolioMetrics {
  totalCompanies: number;
  timeWindow: string;
  aggregationType: 'sum' | 'avg' | 'max' | 'min' | 'count';
  filterCriteria?: string[];
}

export interface LendingContext {
  isPortfolioQuery: boolean;
  requiresAggregation: boolean;
  timeframe: 'current' | '3months' | '12months' | 'custom';
  focusAreas: LendingFocusArea[];
}

export type LendingFocusArea =
  | 'asset_finance'
  | 'working_capital'
  | 'cash_flow'
  | 'revenue_growth'
  | 'credit_quality'
  | 'portfolio_health'
  | 'risk_assessment';

export interface SQLValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  estimatedRows?: number;
  performanceScore?: number;
}

export interface QueryTemplate {
  id: string;
  name: string;
  pattern: RegExp;
  focusArea: LendingFocusArea;
  baseSQL: string;
  requiredTables: string[];
  customizations: QueryCustomization[];
}

export interface QueryCustomization {
  condition: string;
  modification: string;
  priority: number;
}
