import { QueryParserAgent } from '../queryParser';
import { AgentMessage, AgentContext } from '../baseAgent';

describe('QueryParserAgent', () => {
  let agent: QueryParserAgent;
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    agent = new QueryParserAgent();
  });

  describe('execute', () => {
    it('should parse simple query for journal entries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Show me journal entries over $10,000' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_journal_entries');
      expect(result.data.entities).toEqual({
        amount: 10000,
        operator: 'greater_than'
      });
    });

    it('should parse query with date range', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Get transactions from January to March 2024' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_transactions');
      expect(result.data.entities.dateRange).toEqual({
        start: '2024-01-01',
        end: '2024-03-31'
      });
    });

    it('should parse aggregation queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'What is the total revenue for Q1 2024?' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('aggregate_revenue');
      expect(result.data.entities).toEqual({
        metric: 'total',
        period: 'Q1',
        year: 2024
      });
    });

    it('should parse comparison queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Compare expenses between 2023 and 2024' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('compare_expenses');
      expect(result.data.entities).toEqual({
        periods: ['2023', '2024'],
        metric: 'expenses'
      });
    });

    it('should handle account-specific queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Show balance for account 12345' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_account_balance');
      expect(result.data.entities).toEqual({
        accountNumber: '12345'
      });
    });

    it('should parse portfolio queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'List all companies in the portfolio' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('list_portfolio_companies');
      expect(result.data.entities).toEqual({
        scope: 'all'
      });
    });

    it('should handle clarification for ambiguous queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Show me the data' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('clarification_needed');
      expect(result.data.suggestions).toContain('journal entries');
      expect(result.data.suggestions).toContain('balance sheet');
      expect(result.data.suggestions).toContain('transactions');
    });

    it('should extract multiple entities from complex queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { 
          query: 'Find all credit transactions over $5000 for account 98765 in March 2024' 
        },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_transactions');
      expect(result.data.entities).toEqual({
        transactionType: 'credit',
        amount: 5000,
        operator: 'greater_than',
        accountNumber: '98765',
        dateRange: {
          start: '2024-03-01',
          end: '2024-03-31'
        }
      });
    });

    it('should handle negation in queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Show transactions not posted to general ledger' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_transactions');
      expect(result.data.entities).toEqual({
        posted: false,
        target: 'general_ledger'
      });
    });

    it('should identify export intents', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Export trial balance to CSV' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('export_data');
      expect(result.data.entities).toEqual({
        dataType: 'trial_balance',
        format: 'CSV'
      });
    });
  });

  describe('validation', () => {
    it('should reject empty queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: '' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Empty query');
    });

    it('should reject queries that are too long', async () => {
      const longQuery = 'a'.repeat(1001);
      const message: AgentMessage = {
        type: 'query',
        data: { query: longQuery },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Query too long');
    });

    it('should handle missing query field', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: {},
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await agent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('No query provided');
    });
  });

  describe('workflow mode handling', () => {
    it('should parse audit-specific queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Show audit trail for account 12345' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const auditContext = { ...mockContext, workflowMode: 'audit' as const };
      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('query_audit_trail');
      expect(result.data.workflowSpecific).toBe(true);
    });

    it('should parse lending-specific queries', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'Calculate debt service coverage ratio' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const lendingContext = { ...mockContext, workflowMode: 'lending' as const };
      const result = await agent.execute(message, lendingContext);

      expect(result.success).toBe(true);
      expect(result.data.intent).toBe('calculate_dscr');
      expect(result.data.workflowSpecific).toBe(true);
    });
  });
});