/**
 * Query Performance Tests
 * 
 * Tests query execution times, resource usage, and performance
 * constraints across different query types and data volumes.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { performanceTestData, generateLargeDataset } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Query Performance Tests', () => {
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
    
    const { default: createApp } = require('../../src/server');
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('Query Response Time', () => {
    const baseRequest = {
      clientId: 'performance-client-123',
      sessionId: 'performance-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should execute simple queries within 500ms', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(100)
      });

      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT account_name, balance FROM upload_test_202401 LIMIT 100'
        })
        .expect(200);

      const executionTime = Date.now() - startTime;
      
      expect(response.body.success).toBe(true);
      expect(executionTime).toBeLessThan(500);
      expect(response.body.metadata.executionTime).toBeLessThan(500);
    });

    it('should execute complex queries within 3 seconds', async () => {
      // Mock slightly slower response for complex query
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => 
          setTimeout(() => resolve({
            recordset: generateLargeDataset(1000)
          }), 800) // 800ms simulated DB time
        )
      );

      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: performanceTestData.largeQuery
        })
        .expect(200);

      const totalTime = Date.now() - startTime;
      
      expect(response.body.success).toBe(true);
      expect(totalTime).toBeLessThan(3000);
      expect(response.body.metadata.executionTime).toBeDefined();
    });

    it('should timeout queries exceeding 5 seconds', async () => {
      // Mock very slow database response
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => 
          setTimeout(() => resolve({ recordset: [] }), 6000) // 6 seconds
        )
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(408);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('timeout'),
        executionTime: expect.any(Number)
      });
    }, 8000); // Extend Jest timeout for this test

    it('should track query execution times in metrics', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(50)
      });

      await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        })
        .expect(200);

      // Verify metrics were recorded
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/metrics:performance:/),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should handle large result sets efficiently', async () => {
      const largeDataset = generateLargeDataset(5000);
      mockDb.request().query.mockResolvedValue({
        recordset: largeDataset
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'large-data-client',
          sessionId: 'large-data-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 WHERE amount > 1000'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(10000); // Enforce row limits
      expect(response.body.metadata.memoryUsage).toBeDefined();
    });

    it('should enforce row count limits', async () => {
      const excessiveDataset = generateLargeDataset(15000); // Exceeds limit
      mockDb.request().query.mockResolvedValue({
        recordset: excessiveDataset
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'row-limit-client',
          sessionId: 'row-limit-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('row limit'),
        limit: expect.any(Number)
      });
    });

    it('should stream large results when possible', async () => {
      const streamingDataset = generateLargeDataset(8000);
      mockDb.request().query.mockResolvedValue({
        recordset: streamingDataset
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'streaming-client',
          sessionId: 'streaming-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 ORDER BY transaction_date'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.streaming).toBe(true);
      expect(response.body.metadata.totalRows).toBeGreaterThan(response.body.data.length);
    });
  });

  describe('Concurrent Query Performance', () => {
    it('should handle multiple concurrent queries efficiently', async () => {
      // Mock fast database responses
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(100)
      });

      const concurrentQueries = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: 'concurrent-client',
            sessionId: `concurrent-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401 WHERE id > ${i * 100} LIMIT 100`
          })
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentQueries);
      const totalTime = Date.now() - startTime;

      // All queries should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);
      
      // Should execute concurrently (not sequentially)
      expect(totalTime).toBeLessThan(2000); // Much faster than 5 * individual time
      
      // Each response should have reasonable execution time
      responses.forEach(response => {
        expect(response.body.metadata.executionTime).toBeLessThan(1000);
      });
    });

    it('should enforce concurrent query limits per client', async () => {
      // Mock slow queries to test queuing
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => 
          setTimeout(() => resolve({ recordset: [] }), 1000)
        )
      );

      const manyQueries = Array.from({ length: 12 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: 'queue-limit-client',
            sessionId: `queue-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT COUNT(*) FROM upload_test_202401 -- Query ${i}`
          })
      );

      const responses = await Promise.all(manyQueries.map(p => p.catch(err => err.response)));
      const rateLimited = responses.filter(r => r && r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].body.error).toContain('concurrent limit');
    }, 15000);

    it('should prioritize queries based on complexity', async () => {
      // Mock database with different response times
      mockDb.request().query.mockImplementation(async (sql: string) => {
        const delay = sql.includes('complex') ? 2000 : 500;
        await new Promise(resolve => setTimeout(resolve, delay));
        return { recordset: [] };
      });

      const simpleQuery = request(app)
        .post('/api/query')
        .send({
          clientId: 'priority-client',
          sessionId: 'priority-simple',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        });

      const complexQuery = request(app)
        .post('/api/query')
        .send({
          clientId: 'priority-client',
          sessionId: 'priority-complex',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT complex_calculation() FROM upload_test_202401 GROUP BY account'
        });

      const [simpleResponse, complexResponse] = await Promise.all([
        simpleQuery,
        complexQuery
      ]);

      expect(simpleResponse.status).toBe(200);
      expect(complexResponse.status).toBe(200);
      
      // Simple query should complete faster due to prioritization
      expect(simpleResponse.body.metadata.executionTime)
        .toBeLessThan(complexResponse.body.metadata.executionTime);
    }, 10000);
  });

  describe('Cache Performance', () => {
    it('should return cached results faster than database queries', async () => {
      const query = 'SELECT account_name, balance FROM upload_test_202401 LIMIT 100';
      const cachedData = generateLargeDataset(100);
      
      // First, populate cache with slow database call
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => 
          setTimeout(() => resolve({ recordset: cachedData }), 1000)
        )
      );

      const firstResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'cache-client',
          sessionId: 'cache-session-1',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query
        })
        .expect(200);

      expect(firstResponse.body.metadata.fromCache).toBe(false);
      expect(firstResponse.body.metadata.executionTime).toBeGreaterThan(800);

      // Setup cache mock to return the data
      const queryKey = `query:cache-client:${Buffer.from(query).toString('base64')}`;
      mockRedis.get.mockResolvedValue(JSON.stringify({
        data: cachedData,
        metadata: { fromCache: true, cachedAt: new Date().toISOString() }
      }));

      // Second identical query should be served from cache
      const startTime = Date.now();
      const cachedResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'cache-client',
          sessionId: 'cache-session-2',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query
        })
        .expect(200);

      const cacheTime = Date.now() - startTime;

      expect(cachedResponse.body.metadata.fromCache).toBe(true);
      expect(cacheTime).toBeLessThan(100); // Much faster than database
      expect(cachedResponse.body.data).toEqual(firstResponse.body.data);
    });

    it('should invalidate cache after TTL expires', async () => {
      const query = 'SELECT * FROM upload_test_202401 LIMIT 10';
      
      // Mock expired cache (returns null)
      mockRedis.get.mockResolvedValue(null);
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(10)
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'ttl-client',
          sessionId: 'ttl-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query
        })
        .expect(200);

      expect(response.body.metadata.fromCache).toBe(false);
      expect(mockDb.request().query).toHaveBeenCalled();
    });
  });

  describe('Performance Monitoring', () => {
    it('should collect detailed performance metrics', async () => {
      mockDb.request().query.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
        return { recordset: generateLargeDataset(200) };
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'metrics-client',
          sessionId: 'metrics-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 WHERE amount > 1000'
        })
        .expect(200);

      expect(response.body.metadata).toMatchObject({
        executionTime: expect.any(Number),
        dbExecutionTime: expect.any(Number),
        processingTime: expect.any(Number),
        rowCount: expect.any(Number),
        memoryUsage: expect.any(Number)
      });

      // Verify metrics were stored
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/metrics:query:/),
        expect.stringContaining('executionTime'),
        expect.any(Object)
      );
    });

    it('should identify performance bottlenecks', async () => {
      // Mock slow database with timing breakdown
      mockDb.request().query.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2500)); // 2.5s DB time
        return { recordset: generateLargeDataset(1000) };
      });

      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          clientId: 'bottleneck-client',
          sessionId: 'bottleneck-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: performanceTestData.largeQuery
        })
        .expect(200);

      expect(response.body.analysis.performance).toMatchObject({
        bottlenecks: expect.arrayContaining(['database_execution']),
        recommendations: expect.arrayContaining([
          expect.stringContaining('index')
        ])
      });
    });

    it('should generate performance reports', async () => {
      // Setup mock historical performance data
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('metrics:performance:summary')) {
          return Promise.resolve(JSON.stringify({
            averageExecutionTime: 750,
            p95ExecutionTime: 1200,
            totalQueries: 500,
            slowQueries: 25,
            cacheHitRate: 0.65,
            concurrencyLevel: 3.2
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .get('/api/performance/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        metrics: expect.objectContaining({
          averageExecutionTime: expect.any(Number),
          p95ExecutionTime: expect.any(Number),
          totalQueries: expect.any(Number),
          cacheHitRate: expect.any(Number)
        })
      });
    });
  });

  describe('Performance Under Load', () => {
    it('should maintain performance under sustained load', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(100)
      });

      const loadTestRequests = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: `load-client-${i % 3}`, // 3 different clients
            sessionId: `load-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401 WHERE id > ${i * 50} LIMIT 100`
          })
      );

      const startTime = Date.now();
      const responses = await Promise.all(loadTestRequests.map(p => p.catch(err => err.response)));
      const totalTime = Date.now() - startTime;

      const successful = responses.filter(r => r && r.status === 200);
      const failed = responses.filter(r => r && r.status >= 400);

      // At least 80% should succeed
      expect(successful.length / responses.length).toBeGreaterThanOrEqual(0.8);
      
      // Average response time should be reasonable
      const avgTime = totalTime / responses.length;
      expect(avgTime).toBeLessThan(500);
      
      // Failed requests should be due to rate limiting, not errors
      failed.forEach(response => {
        expect([429, 503]).toContain(response.status); // Rate limited or circuit breaker
      });
    }, 15000);
  });

  describe('Resource Cleanup', () => {
    it('should clean up resources after query completion', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: generateLargeDataset(100)
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'cleanup-client',
          sessionId: 'cleanup-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401 LIMIT 100'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Verify connection was closed
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should clean up resources on query timeout', async () => {
      mockDb.request().query.mockImplementation(() =>
        new Promise((resolve, reject) => {
          // Never resolve - will timeout
        })
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'timeout-cleanup-client',
          sessionId: 'timeout-cleanup-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(408);

      expect(response.body.error).toContain('timeout');
      
      // Verify cleanup occurred even on timeout
      expect(mockDb.close).toHaveBeenCalled();
    }, 8000);
  });
});