import { ContextAgent } from '../contextAgent';
import { AgentMessage, AgentContext } from '../baseAgent';
import { RedisService } from '../../services/redis';

jest.mock('../../services/redis');

describe('ContextAgent', () => {
  let agent: ContextAgent;
  let mockRedis: jest.Mocked<RedisService>;
  
  const mockContext: AgentContext = {
    sessionId: 'session-123',
    clientId: 'client-456',
    workflowMode: 'audit',
    uploadId: 'upload-789'
  };

  beforeEach(() => {
    mockRedis = new RedisService() as jest.Mocked<RedisService>;
    (RedisService as jest.Mock).mockImplementation(() => mockRedis);
    
    agent = new ContextAgent(mockRedis);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should load and enrich context for new session', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show me journal entries',
          intent: 'query_journal_entries',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.sessionData).toEqual({
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789',
        conversationHistory: [],
        startTime: expect.any(String)
      });
      expect(result.data.enrichedQuery).toEqual({
        ...message.data,
        context: {
          isNewSession: true,
          previousQueries: [],
          workflowMode: 'audit',
          currentDate: expect.any(String),
          workflowCapabilities: [
            'audit_trail',
            'journal_entries',
            'general_ledger',
            'trial_balance'
          ]
        }
      });
      expect(mockRedis.get).toHaveBeenCalledWith('session:session-123');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should load existing session data', async () => {
      const existingSession = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789',
        conversationHistory: [
          {
            query: 'Previous query',
            intent: 'query_transactions',
            timestamp: '2024-01-01T10:00:00Z'
          }
        ],
        startTime: '2024-01-01T09:00:00Z'
      };

      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show more details',
          intent: 'query_details',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingSession));
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.sessionData.conversationHistory).toHaveLength(1);
      expect(result.data.enrichedQuery.context.isNewSession).toBe(false);
      expect(result.data.enrichedQuery.context.previousQueries).toHaveLength(1);
    });

    it('should handle pronoun resolution', async () => {
      const existingSession = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789',
        conversationHistory: [
          {
            query: 'Show journal entries for account 12345',
            intent: 'query_journal_entries',
            entities: { accountNumber: '12345' },
            timestamp: '2024-01-01T10:00:00Z'
          }
        ],
        startTime: '2024-01-01T09:00:00Z'
      };

      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show me more for that account',
          intent: 'query_details',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingSession));
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.enrichedQuery.entities.accountNumber).toBe('12345');
      expect(result.data.enrichedQuery.context.resolvedReferences).toEqual({
        'that account': '12345'
      });
    });

    it('should maintain conversation continuity', async () => {
      const existingSession = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789',
        conversationHistory: [
          {
            query: 'Show revenue for 2023',
            intent: 'query_revenue',
            entities: { year: 2023 },
            timestamp: '2024-01-01T10:00:00Z'
          }
        ],
        startTime: '2024-01-01T09:00:00Z'
      };

      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Compare with 2024',
          intent: 'compare',
          entities: { year: 2024 }
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingSession));
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.enrichedQuery.intent).toBe('compare_revenue');
      expect(result.data.enrichedQuery.entities).toEqual({
        metric: 'revenue',
        periods: [2023, 2024],
        year: 2024
      });
      expect(result.data.enrichedQuery.context.currentDate).toBeDefined();
      expect(result.data.enrichedQuery.context.workflowCapabilities).toContain('audit_trail');
    });

    it('should handle session expiry', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show me data',
          intent: 'query_data',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');
      mockRedis.expire = jest.fn().mockResolvedValue(1);

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith('session:session-123', 3600);
    });

    it('should update conversation history', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'New query',
          intent: 'query_new',
          entities: { test: true }
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockImplementation((key, value) => {
        const data = JSON.parse(value);
        expect(data.conversationHistory).toHaveLength(1);
        expect(data.conversationHistory[0].query).toBe('New query');
        return Promise.resolve('OK');
      });

      await agent.execute(message, mockContext);

      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should limit conversation history size', async () => {
      const longHistory = Array(50).fill(null).map((_, i) => ({
        query: `Query ${i}`,
        intent: 'query_test',
        entities: {},
        timestamp: new Date(Date.now() - i * 60000).toISOString()
      }));

      const existingSession = {
        sessionId: 'session-123',
        clientId: 'client-456',
        workflowMode: 'audit',
        uploadId: 'upload-789',
        conversationHistory: longHistory,
        startTime: '2024-01-01T09:00:00Z'
      };

      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'New query',
          intent: 'query_new',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingSession));
      mockRedis.set = jest.fn().mockImplementation((key, value) => {
        const data = JSON.parse(value);
        expect(data.conversationHistory.length).toBeLessThanOrEqual(20);
        return Promise.resolve('OK');
      });

      await agent.execute(message, mockContext);

      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('should reject messages without required data', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: null,
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      const result = await agent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Validation failed');
    });

    it('should handle Redis connection errors', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Test query',
          intent: 'test',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockRejectedValue(new Error('Redis connection failed'));

      const result = await agent.execute(message, mockContext);

      // Should continue without session data
      expect(result.success).toBe(true);
      expect(result.data.sessionData.conversationHistory).toEqual([]);
      expect(result.data.enrichedQuery.context.currentDate).toBeDefined();
      expect(result.data.enrichedQuery.context.workflowMode).toBe('audit');
    });
  });

  describe('context enrichment', () => {
    it('should add workflow-specific context', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show audit trail',
          intent: 'query_audit_trail',
          entities: {}
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const auditContext = { ...mockContext, workflowMode: 'audit' as const };
      const result = await agent.execute(message, auditContext);

      expect(result.success).toBe(true);
      expect(result.data.enrichedQuery.context.workflowMode).toBe('audit');
      expect(result.data.enrichedQuery.context.workflowCapabilities).toContain('audit_trail');
    });

    it('should add time-based context', async () => {
      const message: AgentMessage = {
        type: 'query_parsed',
        data: {
          query: 'Show current month data',
          intent: 'query_data',
          entities: { period: 'current_month' }
        },
        source: 'query-parser',
        timestamp: new Date().toISOString()
      };

      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');

      const result = await agent.execute(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.enrichedQuery.context.currentDate).toBeDefined();
      expect(result.data.enrichedQuery.entities.dateRange).toBeDefined();
    });
  });
});