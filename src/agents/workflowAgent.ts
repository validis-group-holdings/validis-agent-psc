import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';

interface WorkflowScope {
  tables: string[];
  operations: string[];
  restrictions: string[];
}

export class WorkflowAgent extends BaseAgent {
  private readonly auditPermissions = ['read', 'aggregate', 'export'];
  private readonly lendingPermissions = ['read', 'aggregate', 'export', 'covenant_check'];
  
  private readonly auditTables = [
    'transactionHeader',
    'transactionLine',
    'account',
    'financialPeriod',
    'financialYear'
  ];
  
  private readonly lendingTables = [
    'company',
    'saleHeader',
    'purchaseHeader',
    'customer',
    'supplier'
  ];

  constructor() {
    super('workflow-agent');
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    // Let execute handle specific validation for better error messages
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Validate workflow context
      if (!message.data.context) {
        return this.createErrorResult(
          'Missing workflow context',
          'MISSING_CONTEXT',
          startTime
        );
      }

      const workflowMode = context.workflowMode;
      const intent = message.data.intent;

      // Check if workflow mode is valid
      if (!['audit', 'lending'].includes(workflowMode)) {
        return this.createErrorResult(
          `Invalid workflow mode: ${workflowMode}`,
          'INVALID_WORKFLOW',
          startTime
        );
      }

      // Check workflow-specific restrictions
      const validationResult = this.validateWorkflowOperation(
        intent,
        workflowMode,
        message.data
      );

      if (!validationResult.allowed) {
        return this.createErrorResult(
          validationResult.reason!,
          'WORKFLOW_RESTRICTION',
          startTime
        );
      }

      // Build workflow scope
      const scope = this.buildWorkflowScope(intent, workflowMode);
      const permissions = this.getWorkflowPermissions(workflowMode, intent);

      return {
        success: true,
        data: {
          allowed: true,
          permissions,
          scope,
          ...validationResult.additionalData
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
        'WORKFLOW_ERROR',
        startTime
      );
    }
  }

  private validateWorkflowOperation(
    intent: string,
    workflowMode: 'audit' | 'lending',
    data: any
  ): { allowed: boolean; reason?: string; additionalData?: any } {
    // Check audit-specific operations
    if (workflowMode === 'audit') {
      // Block write operations
      if (['delete_entry', 'update_entry', 'insert_entry'].includes(intent)) {
        return {
          allowed: false,
          reason: 'Write operations not allowed in audit mode'
        };
      }

      // Allow audit-specific operations
      if (intent === 'query_audit_trail') {
        return {
          allowed: true,
          additionalData: { auditSpecific: true }
        };
      }

      // Allow all read operations
      return { allowed: true };
    }

    // Check lending-specific operations
    if (workflowMode === 'lending') {
      // Block audit trail access
      if (intent === 'query_audit_trail') {
        return {
          allowed: false,
          reason: 'Audit trail not available in lending mode'
        };
      }

      // Allow lending-specific operations
      if (['calculate_dscr', 'check_covenants'].includes(intent)) {
        return {
          allowed: true,
          additionalData: { 
            lendingSpecific: true,
            calculations: intent === 'calculate_dscr' ? ['dscr'] : []
          }
        };
      }

      // Restrict granular transaction queries
      if (intent === 'query_transactions' && data.entities?.scope === 'all') {
        return {
          allowed: true,
          additionalData: {
            restrictions: ['aggregated_only']
          }
        };
      }

      // Allow portfolio queries
      if (intent === 'query_portfolio') {
        return {
          allowed: true,
          additionalData: { lendingSpecific: true }
        };
      }

      return { allowed: true };
    }

    return { allowed: false, reason: 'Unknown workflow mode' };
  }

  private buildWorkflowScope(intent: string, workflowMode: string): WorkflowScope {
    const scope: WorkflowScope = {
      tables: [],
      operations: ['SELECT'],
      restrictions: []
    };

    if (workflowMode === 'audit') {
      if (intent === 'query_journal_entries') {
        scope.tables = ['journal_entries', 'audit_trail', 'general_ledger'];
      } else if (intent === 'query_audit_trail') {
        scope.tables = ['audit_trail'];
      } else {
        scope.tables = this.auditTables;
      }
    } else if (workflowMode === 'lending') {
      if (intent === 'query_portfolio') {
        scope.tables = ['portfolio_summary', 'company_metrics', 'financial_statements'];
        scope.restrictions = ['portfolio_level_only'];
      } else if (intent === 'query_transactions') {
        scope.tables = ['transaction_summary'];
        scope.restrictions = ['no_transaction_details', 'aggregated_only'];
      } else {
        scope.tables = this.lendingTables;
      }
    }

    return scope;
  }

  private getWorkflowPermissions(workflowMode: string, intent: string): string[] {
    let permissions: string[] = [];

    if (workflowMode === 'audit') {
      permissions = [...this.auditPermissions];
    } else if (workflowMode === 'lending') {
      permissions = [...this.lendingPermissions];
      
      // Add covenant-specific permissions
      if (intent === 'check_covenants') {
        permissions.push('covenant_check');
      }
    }

    // Never include write permissions
    return permissions.filter(p => !['write', 'delete', 'update'].includes(p));
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