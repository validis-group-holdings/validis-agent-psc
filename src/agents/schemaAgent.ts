import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';

interface DatabaseSchema {
  primaryTable: string;
  joinTables?: string[];
  columns: string[];
  relationships?: Array<{
    from: string;
    to: string;
    type: string;
  }>;
  aggregations?: string[];
}

export class SchemaAgent extends BaseAgent {
  private readonly schemaMap = new Map<string, DatabaseSchema>([
    ['query_journal_entries', {
      primaryTable: 'transactionHeader',
      joinTables: ['upload', 'transactionLine'],
      columns: ['id', 'transactionDate', 'description', 'journalId', 'transactionTypeId'],
      relationships: [
        { from: 'transactionHeader.uploadId', to: 'upload.upload_id', type: 'inner' },
        { from: 'transactionLine.headerId', to: 'transactionHeader.id', type: 'inner' }
      ]
    }],
    ['query_transactions', {
      primaryTable: 'transactionLine',
      joinTables: ['upload', 'transactionHeader', 'account'],
      columns: ['id', 'baseValue', 'transactionValue', 'description', 'accountId'],
      relationships: [
        { from: 'transactionLine.uploadId', to: 'upload.upload_id', type: 'inner' },
        { from: 'transactionLine.headerId', to: 'transactionHeader.id', type: 'inner' },
        { from: 'transactionLine.accountId', to: 'account.id', type: 'left' }
      ]
    }],
    ['query_portfolio', {
      primaryTable: 'portfolio_summary',
      joinTables: ['company_metrics'],
      columns: ['company_id', 'company_name', 'industry', 'revenue', 'ebitda', 'debt'],
      aggregations: ['company_count', 'total_revenue', 'average_ebitda'],
      relationships: [
        { from: 'portfolio_summary.company_id', to: 'company_metrics.company_id', type: 'left' }
      ]
    }],
    ['query_balance_sheet', {
      primaryTable: 'account',
      joinTables: ['upload', 'primaryCategory'],
      columns: ['id', 'code', 'name', 'opening', 'closing', 'primaryCategoryId'],
      relationships: [
        { from: 'account.uploadId', to: 'upload.upload_id', type: 'inner' },
        { from: 'account.primaryCategoryId', to: 'primaryCategory.id', type: 'left' }
      ]
    }],
    ['query_audit_trail', {
      primaryTable: 'transactionHeader',
      joinTables: ['upload'],
      columns: ['id', 'entryTimestamp', 'entryUser', 'modifiedTimestamp', 'modifiedUser', 'description'],
      relationships: [
        { from: 'transactionHeader.uploadId', to: 'upload.upload_id', type: 'inner' }
      ]
    }],
    ['query_account_balance', {
      primaryTable: 'account',
      joinTables: ['upload', 'currency'],
      columns: ['id', 'code', 'name', 'opening', 'closing', 'currencyId'],
      relationships: [
        { from: 'account.uploadId', to: 'upload.upload_id', type: 'inner' },
        { from: 'account.currencyId', to: 'currency.id', type: 'left' }
      ]
    }]
  ]);

  constructor() {
    super('schema-agent');
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    if (!message.data.intent) return false;
    if (!message.data.scope) return false;
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const intent = message.data.intent;
      const scope = message.data.scope;

      // Get schema mapping for the intent
      let schema = this.schemaMap.get(intent);

      // If no direct mapping, derive schema from scope
      if (!schema) {
        schema = this.deriveSchemaFromScope(scope, intent);
      }

      // Enhance schema based on entities
      if (message.data.entities) {
        schema = this.enhanceSchemaWithEntities(schema, message.data.entities);
      }

      // Apply workflow-specific modifications
      schema = this.applyWorkflowModifications(schema, context.workflowMode);

      return {
        success: true,
        data: {
          ...message.data,
          schema
        },
        metadata: {
          agentName: this.name,
          agentId: this.id,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return this.createErrorResult(
        (error as Error).message,
        'SCHEMA_ERROR',
        startTime
      );
    }
  }

  private deriveSchemaFromScope(scope: any, intent: string): DatabaseSchema {
    // Default schema based on scope tables
    const primaryTable = scope.tables?.[0] || 'unknown';
    
    const defaultSchema: DatabaseSchema = {
      primaryTable,
      joinTables: ['upload'],
      columns: this.getDefaultColumns(primaryTable)
    };

    // Add specific enhancements based on intent patterns
    if (intent.includes('aggregate')) {
      defaultSchema.aggregations = ['sum', 'count', 'avg', 'min', 'max'];
    }

    if (intent.includes('compare')) {
      defaultSchema.aggregations = ['period_comparison'];
    }

    return defaultSchema;
  }

  private getDefaultColumns(table: string): string[] {
    const commonColumns = ['uploadId'];
    
    const tableSpecificColumns: Record<string, string[]> = {
      'transactionHeader': ['id', 'transactionDate', 'description', 'journalId', 'transactionTypeId'],
      'transactionLine': ['id', 'headerId', 'accountId', 'baseValue', 'transactionValue'],
      'portfolio_summary': ['company_id', 'company_name', 'industry', 'revenue'],
      'account': ['id', 'code', 'name', 'opening', 'closing', 'primaryCategoryId'],
      'saleHeader': ['id', 'invoiceDate', 'customerId', 'totalAmount'],
      'purchaseHeader': ['id', 'invoiceDate', 'supplierId', 'totalAmount'],
      'customer': ['id', 'name', 'creditLimit'],
      'supplier': ['id', 'name', 'paymentTerms']
    };

    return [
      ...(tableSpecificColumns[table] || []),
      ...commonColumns
    ];
  }

  private enhanceSchemaWithEntities(
    schema: DatabaseSchema,
    entities: Record<string, any>
  ): DatabaseSchema {
    const enhanced = { ...schema };

    // Add date columns if date range is specified
    if (entities.dateRange) {
      if (!enhanced.columns.includes('date')) {
        enhanced.columns.push('date');
      }
    }

    // Add amount column if amount is specified
    if (entities.amount) {
      if (!enhanced.columns.includes('amount')) {
        enhanced.columns.push('amount');
      }
    }

    // Add account columns if account is specified
    if (entities.accountNumber) {
      if (!enhanced.columns.includes('account_number')) {
        enhanced.columns.push('account_number');
      }
      if (!enhanced.joinTables?.includes('accounts')) {
        enhanced.joinTables = [...(enhanced.joinTables || []), 'accounts'];
      }
    }

    return enhanced;
  }

  private applyWorkflowModifications(
    schema: DatabaseSchema,
    workflowMode: string
  ): DatabaseSchema {
    const modified = { ...schema };

    if (workflowMode === 'lending') {
      // In lending mode, always aggregate transaction details
      if (schema.primaryTable === 'transactions') {
        modified.aggregations = ['count', 'sum', 'avg'];
        modified.columns = modified.columns.filter(col => 
          !['description', 'memo', 'reference'].includes(col)
        );
      }
    }

    // Always ensure upload table is included for client isolation
    if (!modified.joinTables?.includes('upload')) {
      modified.joinTables = ['upload', ...(modified.joinTables || [])];
    }

    return modified;
  }

  private createErrorResult(message: string, code: string, startTime: number): AgentResult {
    return {
      success: false,
      error: {
        message,
        code
      },
      metadata: {
        agentName: this.name,
        agentId: this.id,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      }
    };
  }
}