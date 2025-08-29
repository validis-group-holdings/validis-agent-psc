/**
 * Safety Layer Integration Tests
 * 
 * Tests the complete safety system including validators,
 * circuit breakers, query governor, and emergency stops.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { securityTestData, performanceTestData } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Safety Layer Integration Tests', () => {
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
    mockDb.request().query.mockResolvedValue({ recordset: [] });
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('SQL Injection Protection', () => {
    const baseRequest = {
      clientId: "safety-test-client",
      sessionId: "safety-test-session",
      mode: "audit",
      uploadId: "upload_test_202401"
    };

    securityTestData.sqlInjectionPayloads.forEach((payload, index) => {
      it(`should block SQL injection attempt ${index + 1}: ${payload.substring(0, 20)}...`, async () => {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Show account balances ${payload}`
          })
          .expect(400);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('dangerous'),
          blocked: true,
          reason: expect.stringContaining('injection')
        });
      });
    });

    it('should log security violations', async () => {
      await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "Show balances'; DROP TABLE users; --"
        })
        .expect(400);

      // Verify security event was logged
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/security:violation:/),
        expect.stringContaining('SQL_INJECTION'),
        expect.any(Object)
      );
    });

    it('should increment threat detection metrics', async () => {
      await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "' OR '1'='1"
        })
        .expect(400);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/metrics:security:threats/),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Cross-Client Data Isolation', () => {
    const baseRequest = {
      clientId: "isolated-client-123",
      sessionId: "isolation-test-session",
      mode: "audit",
      uploadId: "upload_test_202401"
    };

    securityTestData.crossClientQueries.forEach((query, index) => {
      it(`should prevent cross-client access attempt ${index + 1}`, async () => {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query
          })
          .expect(403);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('access'),
          violation: 'CROSS_CLIENT_ACCESS'
        });
      });
    });

    it('should validate upload ownership', async () => {
      // Mock upload that belongs to different client
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('upload:upload_other_client')) {
          return Promise.resolve(JSON.stringify({
            upload_id: 'upload_other_client_202401',
            client_id: 'different-client-456',
            status: 'active'
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: "isolated-client-123",
          sessionId: "ownership-test",
          mode: "audit",
          uploadId: "upload_other_client_202401",
          query: "SELECT * FROM upload_other_client_202401"
        })
        .expect(403);

      expect(response.body.error).toContain('not authorized');
    });
  });

  describe('Dangerous Operations Prevention', () => {
    const baseRequest = {
      clientId: "danger-test-client",
      sessionId: "danger-test-session",
      mode: "audit",
      uploadId: "upload_test_202401"
    };

    securityTestData.dangerousOperations.forEach((operation, index) => {
      it(`should block dangerous operation ${index + 1}: ${operation.split(' ')[0]}`, async () => {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: operation
          })
          .expect(400);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('prohibited'),
          blocked: true
        });
      });
    });

    it('should allow safe read operations', async () => {
      const safeQueries = [
        "SELECT account_name, balance FROM upload_test_202401",
        "SELECT COUNT(*) FROM upload_test_202401 WHERE client_id = 'danger-test-client'",
        "SELECT * FROM upload_test_202401 ORDER BY transaction_date DESC LIMIT 100"
      ];

      for (const query of safeQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('Circuit Breaker Protection', () => {
    it('should open circuit after consecutive failures', async () => {
      const failingRequest = {
        clientId: "circuit-test-client",
        sessionId: "circuit-test-session",
        mode: "audit",
        uploadId: "upload_test_202401",
        query: "SELECT * FROM upload_test_202401"
      };

      // Mock database failures
      mockDb.request().query.mockRejectedValue(new Error('Database connection failed'));

      // Send multiple failing requests to trip circuit breaker
      const failurePromises = Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/query')
          .send(failingRequest)
          .expect(500)
      );

      await Promise.all(failurePromises);

      // Next request should be rejected by circuit breaker (503)
      const response = await request(app)
        .post('/api/query')
        .send(failingRequest)
        .expect(503);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('circuit breaker'),
        circuitState: 'OPEN'
      });
    });

    it('should allow half-open state after timeout', async () => {
      // First, trip the circuit breaker
      mockDb.request().query.mockRejectedValue(new Error('Database error'));

      await Promise.all(Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/query')
          .send({
            clientId: "circuit-recovery-client",
            sessionId: "circuit-recovery-session",
            mode: "audit",
            uploadId: "upload_test_202401",
            query: "SELECT * FROM upload_test_202401"
          })
          .expect(500)
      ));

      // Wait for circuit breaker timeout (mocked)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Mock recovery
      mockDb.request().query.mockResolvedValue({ recordset: [] });

      // Should allow one test request in half-open state
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: "circuit-recovery-client",
          sessionId: "circuit-recovery-session-2",
          mode: "audit",
          uploadId: "upload_test_202401",
          query: "SELECT COUNT(*) FROM upload_test_202401"
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Query Governor', () => {
    it('should enforce query timeout limits', async () => {
      // Mock slow database query
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ recordset: [] }), 6000)) // 6 seconds
      );

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: "timeout-test-client",
          sessionId: "timeout-test-session",
          mode: "audit",
          uploadId: "upload_test_202401",
          query: "SELECT * FROM upload_test_202401"
        })
        .expect(408);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('timeout'),
        timeoutMs: 5000
      });
    }, 10000);

    it('should enforce row count limits', async () => {
      // Mock large result set
      const largeDataset = Array.from({ length: 15000 }, (_, i) => ({
        id: i,
        account: `Account ${i}`,
        balance: Math.random() * 10000
      }));

      mockDb.request().query.mockResolvedValue({ recordset: largeDataset });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: "limit-test-client",
          sessionId: "limit-test-session",
          mode: "audit",
          uploadId: "upload_test_202401",
          query: "SELECT * FROM upload_test_202401"
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('row limit'),
        limit: expect.any(Number)
      });
    });

    it('should enforce concurrent query limits per client', async () => {
      // Mock slow queries
      mockDb.request().query.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ recordset: [] }), 2000))
      );

      const concurrentRequests = Array.from({ length: 12 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: "concurrent-limit-client",
            sessionId: `concurrent-session-${i}`,
            mode: "audit",
            uploadId: "upload_test_202401",
            query: `SELECT * FROM upload_test_202401 -- Query ${i}`
          })
      );

      const responses = await Promise.all(concurrentRequests.map(p => p.catch(err => err.response)));
      const rateLimited = responses.filter(r => r && r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Query Complexity Analysis', () => {
    performanceTestData.inefficientQueries.forEach((query, index) => {
      it(`should warn about inefficient query pattern ${index + 1}`, async () => {
        const response = await request(app)
          .post('/api/query/analyze')
          .send({
            clientId: "complexity-test-client",
            sessionId: "complexity-test-session",
            mode: "audit",
            uploadId: "upload_test_202401",
            query
          })
          .expect(200);

        expect(response.body.analysis.warnings).toEqual(
          expect.arrayContaining([
            expect.stringContaining('performance')
          ])
        );
      });
    });

    it('should calculate query complexity score', async () => {
      const complexQuery = performanceTestData.largeQuery;

      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          clientId: "complexity-score-client",
          sessionId: "complexity-score-session",
          mode: "audit",
          query: complexQuery
        })
        .expect(200);

      expect(response.body.analysis).toMatchObject({
        complexity: expect.any(String),
        complexityScore: expect.any(Number),
        estimatedExecutionTime: expect.any(Number)
      });

      expect(response.body.analysis.complexityScore).toBeGreaterThan(0);
    });
  });

  describe('Emergency Stop Functionality', () => {
    it('should trigger emergency stop for security threats', async () => {
      const emergencyRequest = {
        reason: 'Multiple SQL injection attempts detected',
        clientId: 'security-threat-client',
        severity: 'CRITICAL'
      };

      const response = await request(app)
        .post('/api/safety/emergency')
        .send(emergencyRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        emergencyStop: true,
        message: expect.stringContaining('activated')
      });

      // Verify emergency stop blocks subsequent queries
      const blockedResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'security-threat-client',
          sessionId: 'blocked-session',
          mode: 'audit',
          query: 'SELECT * FROM upload_test_202401'
        })
        .expect(503);

      expect(blockedResponse.body.error).toContain('emergency stop');
    });

    it('should allow emergency stop reset by admin', async () => {
      // First trigger emergency stop
      await request(app)
        .post('/api/safety/emergency')
        .send({
          reason: 'Test emergency',
          clientId: 'emergency-reset-client'
        })
        .expect(200);

      // Reset emergency stop
      const resetResponse = await request(app)
        .post('/api/safety/emergency/reset')
        .send({
          clientId: 'emergency-reset-client',
          adminReason: 'Issue resolved - resetting'
        })
        .expect(200);

      expect(resetResponse.body).toMatchObject({
        success: true,
        emergencyReset: true
      });

      // Verify queries are allowed again
      mockDb.request().query.mockResolvedValue({ recordset: [] });
      
      const allowedResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'emergency-reset-client',
          sessionId: 'reset-test-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        })
        .expect(200);

      expect(allowedResponse.body.success).toBe(true);
    });
  });

  describe('Safety Metrics Collection', () => {
    it('should collect and report safety metrics', async () => {
      // Setup mock metrics data
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('metrics:safety')) {
          return Promise.resolve(JSON.stringify({
            totalQueries: 1250,
            blockedQueries: 23,
            sqlInjectionAttempts: 8,
            crossClientViolations: 4,
            circuitBreakerTrips: 2,
            averageQueryTime: 845,
            queryTimeouts: 5
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .get('/api/safety/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        metrics: expect.objectContaining({
          totalQueries: expect.any(Number),
          blockedQueries: expect.any(Number),
          sqlInjectionAttempts: expect.any(Number),
          crossClientViolations: expect.any(Number),
          circuitBreakerTrips: expect.any(Number),
          averageQueryTime: expect.any(Number)
        })
      });
    });

    it('should provide safety score and recommendations', async () => {
      const response = await request(app)
        .get('/api/safety/metrics')
        .expect(200);

      expect(response.body.metrics).toHaveProperty('safetyScore');
      expect(response.body.metrics).toHaveProperty('recommendations');
      expect(response.body.metrics.safetyScore).toBeGreaterThanOrEqual(0);
      expect(response.body.metrics.safetyScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Real-time Threat Detection', () => {
    it('should escalate repeated violations from same client', async () => {
      const maliciousClient = 'repeated-threat-client';
      
      // Send multiple SQL injection attempts
      const attackPromises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: maliciousClient,
            sessionId: `attack-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401; DROP TABLE users${i}; --`
          })
          .expect(400)
      );

      await Promise.all(attackPromises);

      // Sixth attempt should trigger escalated response (block all queries)
      const escalatedResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: maliciousClient,
          sessionId: 'escalated-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT account_name FROM upload_test_202401 LIMIT 1' // Even safe query
        })
        .expect(403);

      expect(escalatedResponse.body.error).toContain('client blocked');
      expect(escalatedResponse.body.escalation).toBe(true);
    });

    it('should implement adaptive rate limiting based on behavior', async () => {
      const suspiciousClient = 'adaptive-rate-client';
      
      // Normal queries should work fine initially
      await request(app)
        .post('/api/query')
        .send({
          clientId: suspiciousClient,
          sessionId: 'adaptive-session-1',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: 'SELECT COUNT(*) FROM upload_test_202401'
        })
        .expect(200);

      // Send suspicious query
      await request(app)
        .post('/api/query')
        .send({
          clientId: suspiciousClient,
          sessionId: 'adaptive-session-2',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: "SELECT * FROM upload_test_202401 WHERE '1'='1'"
        })
        .expect(400);

      // Rate limits should now be tighter for this client
      const rapidRequests = Array.from({ length: 8 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: suspiciousClient,
            sessionId: `adaptive-rapid-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: 'SELECT * FROM upload_test_202401 LIMIT 1'
          })
      );

      const responses = await Promise.all(rapidRequests.map(p => p.catch(err => err.response)));
      const rateLimited = responses.filter(r => r && r.status === 429);
      
      // Should have more rate limiting due to previous suspicious behavior
      expect(rateLimited.length).toBeGreaterThan(3);
    });
  });
});