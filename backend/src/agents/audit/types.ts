/**
 * TypeScript interfaces for the Audit Agent
 */

export interface AuditQueryRequest {
  naturalLanguageQuery: string;
  clientId: string;
  companyName: string;
  parameters?: Record<string, any>;
  includeExplanation?: boolean;
  maxResults?: number;
  useLatestUpload?: boolean; // Default true
}

export interface AuditQueryResponse {
  sql: string;
  explanation?: string;
  confidence: number;
  queryType: 'detail' | 'analysis' | 'compliance';
  involvedTables: string[];
  expectedColumns: string[];
  performanceNotes?: string[];
  auditRisks?: AuditRisk[];
  warnings?: string[];
}

export interface AuditRisk {
  level: 'high' | 'medium' | 'low';
  category: string;
  description: string;
  recommendation?: string;
}

export interface CompanyContext {
  companyName: string;
  latestUploadId?: string;
  uploadDate?: Date;
  financialPeriodId?: string;
  hasMultipleUploads: boolean;
}

export interface AuditContext {
  isDetailQuery: boolean;
  requiresLatestData: boolean;
  timeframe: 'current' | 'period' | 'historical' | 'custom';
  focusAreas: AuditFocusArea[];
  riskLevel?: 'high' | 'medium' | 'low';
}

export type AuditFocusArea =
  | 'variance_analysis'
  | 'large_transactions'
  | 'aged_receivables'
  | 'journal_entries'
  | 'round_amounts'
  | 'duplicate_payments'
  | 'revenue_cutoff'
  | 'expense_analysis'
  | 'balance_sheet'
  | 'compliance';

export interface SQLValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  estimatedRows?: number;
  performanceScore?: number;
}

export interface AuditTemplate {
  id: string;
  name: string;
  pattern: RegExp;
  focusArea: AuditFocusArea;
  baseSQL: string;
  requiredTables: string[];
  customizations: AuditCustomization[];
  riskIndicators: RiskIndicator[];
}

export interface AuditCustomization {
  condition: string;
  modification: string;
  priority: number;
}

export interface RiskIndicator {
  pattern: string;
  riskLevel: 'high' | 'medium' | 'low';
  message: string;
}
