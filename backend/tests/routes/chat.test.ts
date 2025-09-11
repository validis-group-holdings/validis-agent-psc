/**
 * Chat Routes Integration Tests
 */

import request from 'supertest';
import express from 'express';
import chatRoutes from '../../src/routes/chat.routes';
import { AgentCoordinator } from '../../src/services/agent-coordinator';

// Mock dependencies
jest.mock('../../src/services/agent-coordinator');
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Chat Routes', () => {
  let app: express.Application;
  let mockCoordinator: jest.Mocked<AgentCoordinator>;

  beforeEach(() => {
    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/chat', chatRoutes);

    // Setup mock coordinator
    mockCoordinator = {
      coordinate: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
      getHealthStatus: jest.fn().mockReturnValue(new Map()),
      getMetrics: jest.fn().mockReturnValue({
        totalRequests: 100,
        successfulRequests: 95,
        failedRequests: 5,
        timeouts: 0,
        averageResponseTime: 150,
        cacheHitRate: 0.2,
        agentMetrics: new Map()
      }),
      clearCache: jest.fn(),
      getActiveFlows: jest.fn().mockReturnValue([]),
      shutdown: jest.fn()
    } as any;

    // Replace the real coordinator with mock
    (AgentCoordinator as jest.MockedClass<typeof AgentCoordinator>).mockImplementation(
      () => mockCoordinator
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/chat', () => {
    const validRequest = {
      query: 'What are the top 10 loans by amount?',
      sessionId: 'test-session-123',
      clientId: 'client-456',
      userId: 'user-789',
      options: {
        includeExplanation: true,
        maxResults: 100
      }
    };

    it('should process a valid chat request successfully', async () => {
      const mockResponse = {
        success: true,
        sessionId: 'test-session-123',
        routing: {
          targetAgent: 'lending',
          intent: 'query',
          confidence: 0.95,
          requiresClarification: false
        },
        finalSql: 'SELECT TOP 10 * FROM loans ORDER BY amount DESC',
        explanation: 'Retrieved top 10 loans by amount',
        metrics: {
          totalTime: 150,
          orchestrationTime: 50,
          domainAgentTime: 75,
          optimizationTime: 25
        }
      };

      mockCoordinator.coordinate.mockResolvedValueOnce(mockResponse as any);

      const response = await request(app).post('/api/chat').send(validRequest).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        sessionId: 'test-session-123',
        data: {
          sql: 'SELECT TOP 10 * FROM loans ORDER BY amount DESC',
          explanation: 'Retrieved top 10 loans by amount'
        }
      });

      expect(mockCoordinator.coordinate).toHaveBeenCalledWith(
        expect.objectContaining({
          query: validRequest.query,
          sessionId: validRequest.sessionId,
          clientId: validRequest.clientId
        })
      );
    });

    it('should handle clarification requests', async () => {
      const mockResponse = {
        success: true,
        sessionId: 'test-session-123',
        routing: {
          targetAgent: 'orchestrator',
          intent: 'ambiguous',
          confidence: 0.3,
          requiresClarification: true
        },
        explanation: 'Please specify which company you want to query',
        metrics: {
          totalTime: 50,
          orchestrationTime: 50,
          domainAgentTime: 0,
          optimizationTime: 0
        }
      };

      mockCoordinator.coordinate.mockResolvedValueOnce(mockResponse as any);

      const response = await request(app).post('/api/chat').send(validRequest).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        requiresClarification: true,
        clarificationMessage: 'Please specify which company you want to query'
      });
    });

    it('should validate required fields', async () => {
      const invalidRequest = {
        query: '', // Empty query
        sessionId: 'test-session'
        // Missing clientId
      };

      const response = await request(app).post('/api/chat').send(invalidRequest).expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation Error',
        message: 'Request validation failed'
      });
    });

    it('should enforce rate limiting', async () => {
      // Make multiple requests quickly to trigger rate limit
      const promises = [];

      // First 10 should succeed (rate limit is 10 per minute)
      for (let i = 0; i < 10; i++) {
        promises.push(request(app).post('/api/chat').send(validRequest));
      }

      await Promise.all(promises);

      // 11th request should be rate limited
      const response = await request(app).post('/api/chat').send(validRequest).expect(429);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Rate Limit Exceeded'
      });
    });

    it('should handle streaming requests', async () => {
      const streamRequest = {
        ...validRequest,
        options: {
          ...validRequest.options,
          stream: true
        }
      };

      const mockResponse = {
        success: true,
        sessionId: 'test-session-123',
        routing: {
          targetAgent: 'lending',
          intent: 'query',
          confidence: 0.95,
          requiresClarification: false
        },
        finalSql: 'SELECT * FROM loans',
        explanation: 'Query executed',
        domainResponse: { sql: 'SELECT * FROM loans' },
        optimizationResponse: { isValid: true },
        metrics: {
          totalTime: 150,
          orchestrationTime: 50,
          domainAgentTime: 75,
          optimizationTime: 25
        }
      };

      mockCoordinator.coordinate.mockResolvedValueOnce(mockResponse as any);

      const response = await request(app).post('/api/chat').send(streamRequest).expect(200);

      expect(response.headers['content-type']).toBe('text/event-stream');
    });

    it('should handle coordinator errors', async () => {
      mockCoordinator.coordinate.mockRejectedValueOnce(new Error('Coordinator failed'));

      const response = await request(app).post('/api/chat').send(validRequest).expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Internal Server Error',
        message: 'Coordinator failed'
      });
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Operation timed out after 10000ms');
      mockCoordinator.coordinate.mockRejectedValueOnce(timeoutError);

      const response = await request(app).post('/api/chat').send(validRequest).expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Internal Server Error'
      });
    });
  });

  describe('GET /api/chat/health', () => {
    it('should return health status', async () => {
      const mockHealthStatus = new Map([
        [
          'orchestrator',
          {
            agent: 'orchestrator',
            status: 'healthy',
            lastCheck: new Date(),
            responseTime: 50,
            successRate: 100
          }
        ],
        [
          'lending',
          {
            agent: 'lending',
            status: 'healthy',
            lastCheck: new Date(),
            responseTime: 75,
            successRate: 98
          }
        ]
      ]);

      mockCoordinator.getHealthStatus.mockReturnValueOnce(mockHealthStatus as any);

      const response = await request(app).get('/api/chat/health').expect(200);

      expect(response.body).toMatchObject({
        success: true,
        status: 'healthy',
        agents: expect.arrayContaining([
          expect.objectContaining({
            agent: 'orchestrator',
            status: 'healthy'
          }),
          expect.objectContaining({
            agent: 'lending',
            status: 'healthy'
          })
        ])
      });
    });

    it('should report degraded status when agents are unhealthy', async () => {
      const mockHealthStatus = new Map([
        [
          'orchestrator',
          {
            agent: 'orchestrator',
            status: 'degraded',
            lastCheck: new Date(),
            responseTime: 150,
            successRate: 75
          }
        ]
      ]);

      mockCoordinator.getHealthStatus.mockReturnValueOnce(mockHealthStatus as any);

      const response = await request(app).get('/api/chat/health').expect(200);

      expect(response.body).toMatchObject({
        success: true,
        status: 'degraded'
      });
    });
  });

  describe('POST /api/chat/clear-cache', () => {
    it('should clear the cache successfully', async () => {
      const response = await request(app).post('/api/chat/clear-cache').expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Cache cleared successfully'
      });

      expect(mockCoordinator.clearCache).toHaveBeenCalled();
    });

    it('should handle cache clear errors', async () => {
      mockCoordinator.clearCache.mockImplementationOnce(() => {
        throw new Error('Cache clear failed');
      });

      const response = await request(app).post('/api/chat/clear-cache').expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Failed to clear cache'
      });
    });
  });

  describe('GET /api/chat/active-flows', () => {
    it('should return active coordination flows', async () => {
      const mockFlows = [
        {
          sessionId: 'session-1',
          currentStep: 'orchestration',
          startTime: Date.now() - 1000
        },
        {
          sessionId: 'session-2',
          currentStep: 'domain',
          startTime: Date.now() - 2000
        }
      ];

      mockCoordinator.getActiveFlows.mockReturnValueOnce(mockFlows as any);

      const response = await request(app).get('/api/chat/active-flows').expect(200);

      expect(response.body).toMatchObject({
        success: true,
        count: 2,
        flows: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'session-1',
            currentStep: 'orchestration'
          }),
          expect.objectContaining({
            sessionId: 'session-2',
            currentStep: 'domain'
          })
        ])
      });
    });
  });
});
