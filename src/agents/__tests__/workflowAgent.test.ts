import { WorkflowAgent } from '../workflowAgent';
import { AgentMessage, AgentContext } from '../baseAgent';

describe('WorkflowAgent', () => {
  let agent: WorkflowAgent;

  beforeEach(() => {
    agent = new WorkflowAgent();
  });

  describe('audit workflow', () => {
    const auditContext: AgentContext = {
      sessionId: 'session-123',
      clientId: 'client-456',
      workflowMode: 'audit',
      uploadId: 'upload-789'
    };

    it('should allow read operations in audit mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show journal entries',
          intent: 'query_journal_entries',
          entities: {},
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.permissions).toContain('read');
      expect(result.data.scope).toEqual({
        tables: ['journal_entries', 'audit_trail', 'general_ledger'],
        operations: ['SELECT'],
        restrictions: []
      });
    });

    it('should allow audit trail queries', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show audit trail for account 12345',
          intent: 'query_audit_trail',
          entities: { accountNumber: '12345' },
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.auditSpecific).toBe(true);
    });

    it('should block write operations in audit mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Delete journal entry 123',
          intent: 'delete_entry',
          entities: { entryId: '123' },
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WORKFLOW_RESTRICTION');
      expect(result.error?.message).toContain('Write operations not allowed in audit mode');
    });

    it('should allow export operations in audit mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Export trial balance to CSV',
          intent: 'export_data',
          entities: { dataType: 'trial_balance', format: 'CSV' },
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.permissions).toContain('export');
    });

    it('should allow aggregation queries in audit mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Calculate total revenue for Q1',
          intent: 'aggregate_revenue',
          entities: { period: 'Q1' },
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.permissions).toContain('aggregate');
    });
  });

  describe('lending workflow', () => {
    const lendingContext: AgentContext = {
      sessionId: 'session-456',
      clientId: 'client-789',
      workflowMode: 'lending',
      uploadId: 'upload-012'
    };

    it('should allow financial ratio calculations in lending mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Calculate debt service coverage ratio',
          intent: 'calculate_dscr',
          entities: {},
          context: { workflowMode: 'lending' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.lendingSpecific).toBe(true);
      expect(result.data.calculations).toContain('dscr');
    });

    it('should allow portfolio queries in lending mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show portfolio summary',
          intent: 'query_portfolio',
          entities: {},
          context: { workflowMode: 'lending' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.scope).toEqual({
        tables: ['portfolio_summary', 'company_metrics', 'financial_statements'],
        operations: ['SELECT'],
        restrictions: ['portfolio_level_only']
      });
    });

    it('should block audit-specific queries in lending mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show audit trail',
          intent: 'query_audit_trail',
          entities: {},
          context: { workflowMode: 'lending' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WORKFLOW_RESTRICTION');
      expect(result.error?.message).toContain('Audit trail not available in lending mode');
    });

    it('should allow covenant monitoring in lending mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Check covenant compliance',
          intent: 'check_covenants',
          entities: {},
          context: { workflowMode: 'lending' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.lendingSpecific).toBe(true);
      expect(result.data.permissions).toContain('covenant_check');
    });

    it('should restrict granular transaction queries in lending mode', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show all individual transactions',
          intent: 'query_transactions',
          entities: { scope: 'all' },
          context: { workflowMode: 'lending' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.restrictions).toContain('aggregated_only');
      expect(result.data.scope.restrictions).toContain('no_transaction_details');
    });
  });

  describe('validation', () => {
    it('should reject messages without workflow context', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show data',
          intent: 'query_data',
          entities: {}
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const context: AgentContext = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789'
      };

      const result = await agent.process(message, context);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Missing workflow context');
    });

    it('should handle unknown workflow modes', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show data',
          intent: 'query_data',
          entities: {},
          context: { workflowMode: 'unknown' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const context: AgentContext = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'unknown' as any,
        uploadId: 'upload-789'
      };

      const result = await agent.execute(message, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_WORKFLOW');
    });
  });

  describe('permission inheritance', () => {
    it('should inherit base permissions plus workflow-specific', async () => {
      const message: AgentMessage = {
        type: 'context_enriched',
        data: {
          query: 'Show balance sheet',
          intent: 'query_balance_sheet',
          entities: {},
          context: { workflowMode: 'audit' }
        },
        source: 'context-agent',
        timestamp: new Date().toISOString()
      };

      const context: AgentContext = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789'
      };

      const result = await agent.execute(message, context);

      expect(result.success).toBe(true);
      expect(result.data.permissions).toContain('read');
      expect(result.data.permissions).toContain('aggregate');
      expect(result.data.permissions).toContain('export');
      expect(result.data.permissions).not.toContain('write');
    });
  });
});