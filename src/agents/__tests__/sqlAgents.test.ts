import { SchemaAgent } from '../schemaAgent';
import { SQLGeneratorAgent } from '../sqlGenerator';
import { QueryGovernorAgent } from '../queryGovernor';
import { ResponseFormatterAgent } from '../responseFormatter';
import { AgentMessage, AgentContext } from '../baseAgent';
import { getQueryTemplates } from '../../templates';
import { QueryValidator } from '../../safety/validator';
import { QueryGovernor } from '../../safety/governor';

jest.mock('../../templates');
jest.mock('../../safety/validator');
jest.mock('../../safety/governor');

describe('SchemaAgent', () => {
  let agent: SchemaAgent;
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    agent = new SchemaAgent();
  });

  it('should map query intent to database schema', async () => {
    const message: AgentMessage = {
      type: 'workflow_validated',
      data: {
        query: 'Show journal entries',
        intent: 'query_journal_entries',
        entities: {},
        permissions: ['read'],
        scope: { tables: ['journal_entries'] }
      },
      source: 'workflow-agent',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.schema).toEqual({
      primaryTable: 'transactionHeader',
      joinTables: ['upload', 'transactionLine'],
      columns: expect.arrayContaining(['id', 'transactionDate', 'description']),
      relationships: expect.any(Array)
    });
  });

  it('should handle portfolio queries', async () => {
    const message: AgentMessage = {
      type: 'workflow_validated',
      data: {
        query: 'Show portfolio summary',
        intent: 'query_portfolio',
        entities: {},
        permissions: ['read'],
        scope: { tables: ['portfolio_summary'] }
      },
      source: 'workflow-agent',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.schema.primaryTable).toBe('portfolio_summary');
    expect(result.data.schema.aggregations).toContain('company_count');
  });
});

describe('SQLGeneratorAgent', () => {
  let agent: SQLGeneratorAgent;
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    agent = new SQLGeneratorAgent();
    (getQueryTemplates as jest.Mock).mockReturnValue({
      query_journal_entries: {
        id: 'query_journal_entries',
        name: 'Query Journal Entries',
        sql: `SELECT je.* FROM journal_entries je 
              INNER JOIN upload u ON je.upload_id = u.upload_id 
              WHERE u.client_id = @clientId`,
        parameters: ['clientId']
      }
    });
  });

  it('should generate SQL from template', async () => {
    const message: AgentMessage = {
      type: 'schema_mapped',
      data: {
        intent: 'query_journal_entries',
        entities: { amount: 10000, operator: 'greater_than' },
        schema: {
          primaryTable: 'journal_entries',
          columns: ['entry_id', 'amount', 'description']
        }
      },
      source: 'schema-agent',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.sql).toContain('journal_entries');
    expect(result.data.sql).toContain('upload_id');
    expect(result.data.sql).toContain('@clientId');
    expect(result.data.parameters.clientId).toBe('client-456');
  });

  it('should add entity-based filters', async () => {
    const message: AgentMessage = {
      type: 'schema_mapped',
      data: {
        intent: 'query_journal_entries',
        entities: { 
          amount: 10000, 
          operator: 'greater_than',
          dateRange: { start: '2024-01-01', end: '2024-12-31' }
        },
        schema: {
          primaryTable: 'journal_entries',
          columns: ['entry_id', 'amount', 'date']
        }
      },
      source: 'schema-agent',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.sql).toContain('amount > @amount');
    expect(result.data.sql).toContain('date BETWEEN @startDate AND @endDate');
    expect(result.data.parameters.amount).toBe(10000);
  });

  it('should handle missing templates by generating dynamic SQL', async () => {
    (getQueryTemplates as jest.Mock).mockReturnValue({});

    const message: AgentMessage = {
      type: 'schema_mapped',
      data: {
        intent: 'unknown_query',
        entities: {},
        schema: { primaryTable: 'unknown' }
      },
      source: 'schema-agent',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    // Should succeed by generating dynamic SQL
    expect(result.success).toBe(true);
    expect(result.data.sql).toContain('SELECT unknown.*');
    expect(result.data.sql).toContain('FROM unknown');
  });
});

describe('QueryGovernorAgent', () => {
  let agent: QueryGovernorAgent;
  
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new QueryGovernorAgent();
    
    // Mock the static methods
    jest.spyOn(QueryValidator, 'validate').mockImplementation(jest.fn());
    jest.spyOn(QueryGovernor, 'govern').mockImplementation(jest.fn());
  });

  it('should inject safety clauses', async () => {
    const message: AgentMessage = {
      type: 'sql_generated',
      data: {
        sql: 'SELECT * FROM journal_entries WHERE amount > @amount',
        parameters: { amount: 10000, clientId: 'client-456' }
      },
      source: 'sql-generator',
      timestamp: new Date().toISOString()
    };

    (QueryValidator.validate as jest.Mock).mockResolvedValue({ isValid: true });
    (QueryGovernor.govern as jest.Mock).mockReturnValue({
      isValid: true,
      modifiedQuery: 'SELECT TOP 100 * FROM journal_entries WHERE amount > @amount',
      warnings: ['Added TOP 100 clause'],
      errors: []
    });

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.sql).toContain('TOP 100');
    expect(result.data.safetyModifications).toContain('Added TOP 100 clause');
  });

  it('should reject dangerous queries', async () => {
    const message: AgentMessage = {
      type: 'sql_generated',
      data: {
        sql: 'DELETE FROM journal_entries',
        parameters: {}
      },
      source: 'sql-generator',
      timestamp: new Date().toISOString()
    };

    (QueryValidator.validate as jest.Mock).mockResolvedValue({ 
      isValid: false,
      errors: ['DELETE operations not allowed']
    });

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('QUERY_REJECTED');
    expect(result.error?.details).toContain('DELETE operations not allowed');
  });

  it('should add timeout parameters', async () => {
    const message: AgentMessage = {
      type: 'sql_generated',
      data: {
        sql: 'SELECT * FROM large_table',
        parameters: { clientId: 'client-456' }
      },
      source: 'sql-generator',
      timestamp: new Date().toISOString()
    };

    (QueryValidator.validate as jest.Mock).mockResolvedValue({ isValid: true });
    (QueryGovernor.govern as jest.Mock).mockReturnValue({
      isValid: true,
      modifiedQuery: 'SELECT TOP 100 * FROM large_table',
      warnings: ['Added TOP 100 clause', 'Set query timeout to 5000ms'],
      errors: []
    });

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.executionParams.timeout).toBe(5000);
  });
});

describe('ResponseFormatterAgent', () => {
  let agent: ResponseFormatterAgent;
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    agent = new ResponseFormatterAgent();
  });

  it('should format query results into natural language', async () => {
    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'Show journal entries over $10,000',
        intent: 'query_journal_entries',
        results: [
          { entry_id: 1, amount: 15000, description: 'Revenue' },
          { entry_id: 2, amount: 12000, description: 'Sales' }
        ],
        rowCount: 2
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('Found 2 journal entries');
    expect(result.data.response).toContain('over $10,000');
    expect(result.data.formattedResults).toHaveLength(2);
  });

  it('should handle empty results', async () => {
    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'Show journal entries over $1,000,000',
        intent: 'query_journal_entries',
        results: [],
        rowCount: 0
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('No journal entries found');
    expect(result.data.response).toContain('$1,000,000');
  });

  it('should format aggregation results', async () => {
    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'What is the total revenue for Q1 2024?',
        intent: 'aggregate_revenue',
        results: [{ total_revenue: 1500000, period: 'Q1 2024' }],
        rowCount: 1
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('total revenue for Q1 2024');
    expect(result.data.response).toContain('$1,500,000');
  });

  it('should handle error results', async () => {
    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'Show invalid data',
        intent: 'query_data',
        error: 'Query execution failed: Invalid object name',
        results: null
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('unable to complete');
    expect(result.data.response).toContain('Please try rephrasing');
    expect(result.data.errorHandled).toBe(true);
  });

  it('should provide export options for large result sets', async () => {
    const largeResults = Array(100).fill(null).map((_, i) => ({
      entry_id: i,
      amount: 1000 + i,
      description: `Entry ${i}`
    }));

    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'Show all journal entries',
        intent: 'query_journal_entries',
        results: largeResults,
        rowCount: 100
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, mockContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('100 journal entries');
    expect(result.data.exportOptions).toBeDefined();
    expect(result.data.exportOptions).toContain('CSV');
    expect(result.data.exportOptions).toContain('PDF');
  });

  it('should handle workflow-specific formatting', async () => {
    const lendingContext = { ...mockContext, workflowMode: 'lending' as const };

    const message: AgentMessage = {
      type: 'query_executed',
      data: {
        query: 'Calculate debt service coverage ratio',
        intent: 'calculate_dscr',
        results: [{ dscr: 1.45, period: '2024' }],
        rowCount: 1
      },
      source: 'executor',
      timestamp: new Date().toISOString()
    };

    const result = await agent.execute(message, lendingContext);

    expect(result.success).toBe(true);
    expect(result.data.response).toContain('Debt Service Coverage Ratio');
    expect(result.data.response).toContain('1.45x');
    expect(result.data.workflowFormatting).toBe('lending');
  });
});