export interface QueryParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  required: boolean;
  description?: string;
  defaultValue?: any;
  validValues?: any[];
}

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: 'audit' | 'lending';
  workflow: 'audit' | 'lending';
  parameters: QueryParameter[];
  sql: string;
  estimatedRuntime: number; // seconds
  estimatedExecutionTime?: number; // milliseconds - for compatibility
  complexity: 'low' | 'medium' | 'high';
  tags?: string[];
  expectedColumns?: string[];
}

export interface TemplateExecutionResult {
  templateId: string;
  success: boolean;
  data?: any[];
  error?: string;
  executionTime: number;
  rowCount?: number;
}

export interface ExecutionContext {
  clientId: string;
  uploadId?: string;
  parameters: Record<string, any>;
}