/**
 * API Integration Tests
 * 
 * Tests all API endpoints with proper mocking of external services
 * and comprehensive scenario coverage.
 */

import request from 'supertest';
import express from 'express';
import { Server } from 'http';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { mockFinancialData, workflowTestData } from '../utils/test-data';

// Mock external dependencies
jest.mock('../../src/db/connection', () => ({
  getConnection: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/db/redis', () => ({
  getRedisClient: jest.fn()
}));

jest.mock('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'Mock AI response for query analysis'
    })
  }))
}));

describe('API Integration Tests', () => {
  let app: express.Application;
  let server: Server;
  let mockDb: any;
  let mockRedis: any;

  beforeAll(async () => {
    setupTestEnvironment();
    
    // Setup mocks
    mockDb = createMockDbConnection();
    mockRedis = createMockRedisClient();
    
    const { getConnection } = require('../../src/db/connection');
    const { getRedisClient } = require('../../src/db/redis');
    
    getConnection.mockResolvedValue(mockDb);
    getRedisClient.mockReturnValue(mockRedis);
    
    // Import app after mocks are set up
    const serverModule = require('../../src/server');
    app = serverModule.default;
    
    server = app.listen(0); // Use random available port
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default database responses
    mockDb.request().query.mockResolvedValue({
      recordset: mockFinancialData.accountBalances
    });
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String)
      });
    });

    it('should include database and redis status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.services).toMatchObject({
        database: expect.any(String),
        redis: expect.any(String),
        anthropic: expect.any(String)
      });
    });

    it('should handle service failures gracefully', async () => {
      // Mock database failure
      mockDb.request().query.mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/health')
        .expect(200); // Still returns 200 but with degraded status

      expect(response.body.services.database).toBe('unhealthy');
    });
  });

  describe('POST /api/query', () => {
    const validQueryRequest = {
      query: "Show me account balances for last month",
      clientId: "test-client-123",
      sessionId: "test-session-001",
      mode: "audit",
      uploadId: "upload_test_202401"
    };

    it('should process valid query requests', async () => {
      const response = await request(app)
        .post('/api/query')
        .send(validQueryRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
        metadata: expect.objectContaining({
          query: expect.any(String),
          executionTime: expect.any(Number),
          rowCount: expect.any(Number)
        })
      });
    });

    it('should require authentication headers', async () => {
      const response = await request(app)
        .post('/api/query')
        .send(validQueryRequest)
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Authentication')
      });
    });

    it('should validate request parameters', async () => {
      const invalidRequest = {
        query: "", // Empty query
        clientId: "test-client-123"
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/query')
        .send(invalidRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('validation')
      });
    });

    it('should handle SQL injection attempts', async () => {
      const maliciousRequest = {
        ...validQueryRequest,
        query: "Show balances'; DROP TABLE users; --"
      };

      const response = await request(app)
        .post('/api/query')
        .send(maliciousRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('dangerous')
      });
    });

    it('should enforce client isolation', async () => {
      const crossClientRequest = {
        ...validQueryRequest,
        query: "SELECT * FROM upload_other_client_202401"
      };

      const response = await request(app)
        .post('/api/query')
        .send(crossClientRequest)
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('access')
      });
    });

    it('should handle query timeouts', async () => {
      // Mock slow database response
      mockDb.request().query.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 6000)) // 6 seconds
      );

      const response = await request(app)
        .post('/api/query')
        .send(validQueryRequest)
        .expect(408);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('timeout')
      });
    }, 10000); // Increase test timeout

    it('should return cached results when available', async () => {
      const queryKey = `query:${validQueryRequest.clientId}:${Buffer.from(validQueryRequest.query).toString('base64')}`;
      mockRedis.get.mockResolvedValue(JSON.stringify({
        data: mockFinancialData.accountBalances,
        metadata: { fromCache: true }
      }));

      const response = await request(app)
        .post('/api/query')
        .send(validQueryRequest)
        .expect(200);

      expect(response.body.metadata.fromCache).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(queryKey);
    });
  });

  describe('POST /api/query/analyze', () => {
    const analysisRequest = {
      query: "Find unusual patterns in journal entries",
      clientId: "test-client-123",
      sessionId: "test-session-001",
      mode: "audit",
      uploadId: "upload_test_202401"
    };

    it('should provide query analysis and suggestions', async () => {
      const response = await request(app)
        .post('/api/query/analyze')
        .send(analysisRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        analysis: expect.objectContaining({
          intent: expect.any(String),
          suggestedTemplate: expect.any(String),
          parameters: expect.any(Object)
        })
      });
    });

    it('should handle complex analytical queries', async () => {
      const complexRequest = {
        ...analysisRequest,
        query: "Compare revenue trends across multiple periods and identify seasonality patterns"
      };

      const response = await request(app)
        .post('/api/query/analyze')
        .send(complexRequest)
        .expect(200);

      expect(response.body.analysis.complexity).toBe('high');
      expect(response.body.analysis.estimatedExecutionTime).toBeGreaterThan(1000);
    });
  });

  describe('GET /api/query/templates/:workflow', () => {
    it('should return audit templates', async () => {
      const response = await request(app)
        .get('/api/query/templates/audit')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        templates: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            description: expect.any(String),
            category: expect.any(String)
          })
        ])
      });
    });

    it('should return lending templates', async () => {
      const response = await request(app)
        .get('/api/query/templates/lending')
        .expect(200);

      expect(response.body.templates.length).toBeGreaterThan(0);
      expect(response.body.templates[0]).toHaveProperty('workflow', 'lending');
    });

    it('should handle invalid workflow types', async () => {
      const response = await request(app)
        .get('/api/query/templates/invalid')
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('workflow')
      });
    });
  });

  describe('GET /api/safety/metrics', () => {
    it('should return safety metrics', async () => {
      // Setup mock metrics in Redis
      mockRedis.get.mockResolvedValue(JSON.stringify({
        totalQueries: 150,
        blockedQueries: 5,
        averageExecutionTime: 850,
        errorRate: 0.02
      }));

      const response = await request(app)
        .get('/api/safety/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        metrics: expect.objectContaining({
          totalQueries: expect.any(Number),
          blockedQueries: expect.any(Number),
          averageExecutionTime: expect.any(Number),
          errorRate: expect.any(Number)
        })
      });
    });

    it('should include circuit breaker status', async () => {
      const response = await request(app)
        .get('/api/safety/metrics')
        .expect(200);

      expect(response.body.metrics).toHaveProperty('circuitBreakerStatus');
      expect(response.body.metrics).toHaveProperty('activeConnections');
    });
  });

  describe('POST /api/safety/emergency', () => {
    it('should trigger emergency stop', async () => {
      const emergencyRequest = {
        reason: 'Security incident detected',
        clientId: 'test-client-123'
      };

      const response = await request(app)
        .post('/api/safety/emergency')
        .send(emergencyRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: expect.stringContaining('Emergency stop')
      });
    });

    it('should require admin privileges', async () => {
      const response = await request(app)
        .post('/api/safety/emergency')
        .send({ reason: 'Test' })
        .expect(403);

      expect(response.body.error).toContain('admin');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection failures', async () => {
      mockDb.request().query.mockRejectedValue(new Error('Database unavailable'));

      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "test-client-123",
          sessionId: "test-session-001",
          mode: "audit"
        })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('database')
      });
    });

    it('should handle AI service failures', async () => {
      const { ChatAnthropic } = require('@langchain/anthropic');
      ChatAnthropic.mockImplementation(() => ({
        invoke: jest.fn().mockRejectedValue(new Error('API rate limit exceeded'))
      }));

      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          query: "Analyze revenue patterns",
          clientId: "test-client-123",
          sessionId: "test-session-001",
          mode: "audit"
        })
        .expect(503);

      expect(response.body.error).toContain('service unavailable');
    });

    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/query')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      expect(response.body.error).toContain('Invalid JSON');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits per client', async () => {
      const requests = Array.from({ length: 20 }, () => 
        request(app)
          .post('/api/query')
          .send({
            query: "SELECT * FROM upload_test_202401 LIMIT 1",
            clientId: "rate-limit-test",
            sessionId: "test-session",
            mode: "audit"
          })
      );

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('CORS and Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/query')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });
});