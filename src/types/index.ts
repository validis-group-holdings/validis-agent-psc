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
}