/**
 * Timeout Validation Tests
 * 
 * Tests timeout enforcement, graceful degradation,
 * and recovery mechanisms across all system components.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Timeout Validation Tests', () => {
  let app: express.Application;
  let mockDb: any;
  let mockRedis: any;

  beforeAll(async () => {
    setupTestEnvironment();
    
    mockDb = createMockDbConnection();
    mockRedis = createMockRedisClient();
    
    const { getConnection } = require('../../src/db/connection');
    const { getRedisClient } = require('../../src/db/redis');
    
    getConnection.mockResolvedValue(mockDb);
    getRedisClient.mockReturnValue(mockRedis);
    
    const serverModule = require('../../src/server');
    app = serverModule.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('Database Query Timeouts', () => {
    const baseRequest = {
      clientId: 'timeout-test-client',
      sessionId: 'timeout-test-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should timeout database queries after 5 seconds', async () => {
      // Mock database query that never resolves
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => {
          // Will timeout before this resolves
          setTimeout(resolve, 10000);
        })
      );

      const startTime = Date.now();
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT * FROM upload_test_202401 WHERE complex_calculation(amount) > 1000'
        })
        .expect(408);

      const executionTime = Date.now() - startTime;

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('timeout'),
        timeoutMs: 5000,
        executionTime: expect.any(Number)
      });

      // Should timeout close to the 5-second limit
      expect(executionTime).toBeGreaterThan(4800);
      expect(executionTime).toBeLessThan(6000);
    }, 8000);

    it('should handle partial results on timeout', async () => {
      let queryStarted = false;
      mockDb.request().query.mockImplementation(async () => {
        queryStarted = true;
        // Simulate partial data received before timeout
        await new Promise(resolve => setTimeout(resolve, 3000));
        return {
          recordset: [
            { id: 1, account: 'Partial Data', balance: 1000 }
          ]
        };
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT * FROM upload_test_202401 ORDER BY complex_calculation(amount)'
        });

      if (response.status === 200) {
        // Query completed within timeout
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      } else if (response.status === 408) {
        // Query timed out
        expect(response.body.error).toContain('timeout');
        expect(queryStarted).toBe(true);
      }
    }, 8000);

    it('should cleanup resources on database timeout', async () => {
      mockDb.request().query.mockImplementation(() =>
        new Promise(() => {}) // Never resolves
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(408);

      expect(response.body.error).toContain('timeout');
      
      // Verify cleanup was called
      expect(mockDb.close).toHaveBeenCalled();
    }, 8000);
  });

  describe('AI Service Timeouts', () => {
    it('should timeout AI analysis requests after 10 seconds', async () => {
      const { ChatAnthropic } = require('@langchain/anthropic');
      
      // Mock AI service that times out
      ChatAnthropic.mockImplementation(() => ({
        invoke: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(resolve, 15000)) // 15 seconds
        )
      }));

      const startTime = Date.now();
      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          clientId: 'ai-timeout-client',
          sessionId: 'ai-timeout-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'Analyze complex revenue patterns and provide detailed insights'
        })
        .expect(408);

      const executionTime = Date.now() - startTime;

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('AI service timeout'),
        timeoutMs: 10000
      });

      expect(executionTime).toBeGreaterThan(9800);
      expect(executionTime).toBeLessThan(12000);
    }, 15000);

    it('should provide fallback analysis on AI timeout', async () => {
      const { ChatAnthropic } = require('@langchain/anthropic');
      
      ChatAnthropic.mockImplementation(() => ({
        invoke: jest.fn().mockRejectedValue(new Error('Timeout'))
      }));

      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          clientId: 'ai-fallback-client',
          sessionId: 'ai-fallback-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'Show me account balances'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        analysis: expect.objectContaining({
          fallback: true,
          intent: expect.any(String),
          suggestedTemplate: expect.any(String)
        })
      });
    });
  });

  describe('Redis Connection Timeouts', () => {
    it('should handle Redis connection timeouts gracefully', async () => {
      // Mock Redis operations that timeout
      mockRedis.get.mockImplementation(() =>
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Redis timeout')), 2000);
        })
      );

      mockDb.request().query.mockResolvedValue({
        recordset: [{ id: 1, account: 'Test', balance: 1000 }]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'redis-timeout-client',
          sessionId: 'redis-timeout-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 LIMIT 10'
        })
        .expect(200);

      // Should succeed despite Redis timeout by falling back to database
      expect(response.body.success).toBe(true);
      expect(response.body.metadata.cacheUnavailable).toBe(true);
      expect(response.body.metadata.fromCache).toBe(false);
    }, 5000);

    it('should handle Redis write timeouts', async () => {
      mockRedis.set.mockImplementation(() =>
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Redis write timeout')), 1500);
        })
      );

      mockDb.request().query.mockResolvedValue({
        recordset: [{ id: 1, account: 'Test', balance: 1000 }]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'redis-write-timeout-client',
          sessionId: 'redis-write-timeout-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 LIMIT 5'
        })
        .expect(200);

      // Query should succeed even if caching fails
      expect(response.body.success).toBe(true);
      expect(response.body.metadata.cacheWriteError).toBe(true);
    }, 4000);
  });

  describe('Request Processing Timeouts', () => {
    it('should timeout entire request processing after 30 seconds', async () => {
      // Mock multiple slow operations
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 15000))
      );

      const { ChatAnthropic } = require('@langchain/anthropic');
      ChatAnthropic.mockImplementation(() => ({
        invoke: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(resolve, 20000))
        )
      }));

      const startTime = Date.now();
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'request-timeout-client',
          sessionId: 'request-timeout-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'Complex analysis query requiring multiple operations'
        })
        .expect(408);

      const totalTime = Date.now() - startTime;

      expect(response.body.error).toContain('Request timeout');
      expect(totalTime).toBeLessThan(32000); // Should timeout before 32s
    }, 35000);

    it('should handle concurrent request timeouts', async () => {
      // Mock operations that will timeout
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 8000)) // 8 seconds
      );

      const timeoutRequests = Array.from({ length: 3 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: 'concurrent-timeout-client',
            sessionId: `concurrent-timeout-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401 WHERE id > ${i * 1000}`
          })
      );

      const responses = await Promise.all(
        timeoutRequests.map(promise => promise.catch(err => err.response))
      );

      // All should timeout with 408
      responses.forEach(response => {
        expect(response.status).toBe(408);
        expect(response.body.error).toContain('timeout');
      });
    }, 12000);
  });

  describe('Circuit Breaker Timeout Integration', () => {
    it('should open circuit breaker on repeated timeouts', async () => {
      // Mock queries that always timeout
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 8000))
      );

      const client = 'circuit-timeout-client';
      
      // Send multiple requests that will timeout
      const timeoutPromises = Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: client,
            sessionId: `circuit-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401 -- Query ${i}`
          })
          .expect(408)
      );

      await Promise.all(timeoutPromises);

      // Next request should be rejected by circuit breaker before timeout
      const startTime = Date.now();
      const circuitResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: client,
          sessionId: 'circuit-test-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        })
        .expect(503);

      const circuitTime = Date.now() - startTime;

      expect(circuitResponse.body).toMatchObject({
        success: false,
        error: expect.stringContaining('circuit breaker'),
        circuitState: 'OPEN'
      });

      // Should be rejected quickly (not wait for timeout)
      expect(circuitTime).toBeLessThan(1000);
    }, 20000);
  });

  describe('Timeout Configuration', () => {
    it('should respect different timeout values for different operations', async () => {
      // Test that simple queries have shorter timeout than complex ones
      const simpleQuery = request(app)
        .post('/api/query')
        .send({
          clientId: 'timeout-config-client',
          sessionId: 'simple-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        });

      const complexQuery = request(app)
        .post('/api/query/analyze')
        .send({
          clientId: 'timeout-config-client',
          sessionId: 'complex-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'Perform comprehensive financial analysis with multiple perspectives'
        });

      // Both should complete or timeout based on their respective limits
      const [simpleResponse, complexResponse] = await Promise.all([
        simpleQuery,
        complexQuery
      ]);

      // Simple query should have completed faster or timed out at 5s
      if (simpleResponse.status === 408) {
        expect(simpleResponse.body.timeoutMs).toBe(5000);
      }

      // Complex analysis should have longer timeout (10s)
      if (complexResponse.status === 408) {
        expect(complexResponse.body.timeoutMs).toBe(10000);
      }
    }, 12000);

    it('should allow admin override of timeout values', async () => {
      // Mock admin request with extended timeout
      const response = await request(app)
        .post('/api/query')
        .set('Authorization', 'Bearer admin-token')
        .send({
          clientId: 'admin-timeout-client',
          sessionId: 'admin-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401',
          options: {
            timeoutMs: 15000 // Override default timeout
          }
        });

      // Should either complete or timeout at the extended limit
      if (response.status === 408) {
        expect(response.body.timeoutMs).toBe(15000);
      } else {
        expect(response.status).toBe(200);
      }
    }, 18000);
  });

  describe('Timeout Metrics and Monitoring', () => {
    it('should collect timeout metrics', async () => {
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 8000))
      );

      await request(app)
        .post('/api/query')
        .send({
          clientId: 'metrics-timeout-client',
          sessionId: 'metrics-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(408);

      // Verify timeout metrics were recorded
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/metrics:timeouts:/),
        expect.any(String),
        expect.any(Object)
      );
    }, 10000);

    it('should provide timeout statistics via metrics endpoint', async () => {
      // Mock timeout metrics in Redis
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('metrics:timeouts')) {
          return Promise.resolve(JSON.stringify({
            totalTimeouts: 25,
            dbTimeouts: 15,
            aiTimeouts: 8,
            requestTimeouts: 2,
            averageTimeoutTime: 5200,
            clientsAffected: 12
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .get('/api/metrics/timeouts')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        metrics: expect.objectContaining({
          totalTimeouts: expect.any(Number),
          dbTimeouts: expect.any(Number),
          aiTimeouts: expect.any(Number),
          requestTimeouts: expect.any(Number),
          averageTimeoutTime: expect.any(Number)
        })
      });
    });
  });

  describe('Graceful Timeout Handling', () => {
    it('should provide meaningful error messages on timeout', async () => {
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 8000))
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'graceful-client',
          sessionId: 'graceful-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 ORDER BY complex_calculation(amount)'
        })
        .expect(408);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Query execution timed out'),
        suggestion: expect.stringContaining('try simplifying'),
        timeoutMs: 5000,
        executionTime: expect.any(Number)
      });
    }, 10000);

    it('should suggest query optimizations on timeout', async () => {
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 8000))
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'optimization-client',
          sessionId: 'optimization-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 WHERE description LIKE "%expensive%" ORDER BY amount'
        })
        .expect(408);

      expect(response.body.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('LIMIT'),
          expect.stringContaining('index'),
          expect.stringContaining('filter')
        ])
      );
    }, 10000);
  });
});