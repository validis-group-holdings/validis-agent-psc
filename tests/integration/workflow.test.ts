/**
 * Workflow Integration Tests
 * 
 * Tests complete workflow scenarios including session management,
 * mode switching, and multi-step query sequences.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { workflowTestData, mockFinancialData, mockLendingPortfolio } from '../utils/test-data';

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
    invoke: jest.fn().mockImplementation(async (messages) => {
      const content = messages.content || messages[0]?.content || '';
      
      if (content.includes('account balance')) {
        return { content: 'accountBalance template with client filtering' };
      } else if (content.includes('unusual') || content.includes('pattern')) {
        return { content: 'unusualPatterns template for anomaly detection' };
      } else if (content.includes('weekend')) {
        return { content: 'weekendTransactions template' };
      } else if (content.includes('ratio')) {
        return { content: 'financialRatios template for portfolio analysis' };
      } else if (content.includes('debt')) {
        return { content: 'debtCapacity template for lending analysis' };
      } else if (content.includes('risk')) {
        return { content: 'riskScoring template for credit assessment' };
      }
      
      return { content: 'Generic analysis response' };
    })
  }))
}));

describe('Workflow Integration Tests', () => {
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

  describe('Audit Workflow', () => {
    const auditSession = workflowTestData.auditWorkflow.sessionContext;

    beforeEach(() => {
      // Mock session data in Redis
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('session:audit-session-001')) {
          return Promise.resolve(JSON.stringify(auditSession));
        }
        if (key.includes('upload:upload_test_202401')) {
          return Promise.resolve(JSON.stringify({
            upload_id: 'upload_test_202401',
            client_id: 'audit-client-123',
            company_name: 'Test Company Ltd',
            period: '2024-01',
            status: 'active'
          }));
        }
        return Promise.resolve(null);
      });

      // Mock database responses for audit queries
      mockDb.request().query.mockImplementation(async (sql: string) => {
        if (sql.includes('account') || sql.includes('balance')) {
          return { recordset: mockFinancialData.accountBalances };
        } else if (sql.includes('journal') || sql.includes('unusual')) {
          return { recordset: mockFinancialData.journalEntries };
        } else if (sql.includes('weekend')) {
          return { recordset: [
            {
              id: 1,
              transaction_date: '2024-01-06', // Saturday
              amount: 5000,
              description: 'Weekend payment',
              client_id: 'audit-client-123'
            }
          ]};
        }
        return { recordset: [] };
      });
    });

    it('should execute complete audit workflow sequence', async () => {
      const sequence = workflowTestData.auditWorkflow.querySequence;
      
      // Execute each step in the workflow
      for (const step of sequence) {
        const response = await request(app)
          .post('/api/query')
          .send({
            query: step.query,
            clientId: auditSession.clientId,
            sessionId: auditSession.sessionId,
            mode: auditSession.mode,
            uploadId: auditSession.currentUploadId
          })
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: expect.any(Array),
          metadata: expect.objectContaining({
            template: expect.stringContaining(step.expectedTemplate),
            rowCount: expect.any(Number)
          })
        });

        // Verify correct template was selected
        expect(response.body.metadata.template).toContain(step.expectedTemplate);
      }
    });

    it('should maintain session state across queries', async () => {
      // First query establishes session
      await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: auditSession.clientId,
          sessionId: auditSession.sessionId,
          mode: 'audit',
          uploadId: 'upload_test_202401'
        })
        .expect(200);

      // Subsequent query should use existing session
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Find journal entry patterns",
          clientId: auditSession.clientId,
          sessionId: auditSession.sessionId,
          mode: 'audit'
          // uploadId not required after session established
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Verify session was retrieved and used
      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringContaining('session:audit-session-001')
      );
    });

    it('should enforce single-company context in audit mode', async () => {
      // Attempt to access data from different company
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "SELECT * FROM upload_different_company_202401",
          clientId: auditSession.clientId,
          sessionId: auditSession.sessionId,
          mode: 'audit',
          uploadId: 'upload_test_202401'
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('access')
      });
    });

    it('should provide audit-specific recommendations', async () => {
      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          query: "I need to review financial controls",
          clientId: auditSession.clientId,
          sessionId: auditSession.sessionId,
          mode: 'audit',
          uploadId: 'upload_test_202401'
        })
        .expect(200);

      expect(response.body.analysis.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('segregation of duties'),
          expect.stringContaining('approval controls'),
          expect.stringContaining('reconciliation')
        ])
      );
    });
  });

  describe('Lending Workflow', () => {
    const lendingSession = workflowTestData.lendingWorkflow.sessionContext;

    beforeEach(() => {
      // Mock session data for lending mode
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('session:lending-session-002')) {
          return Promise.resolve(JSON.stringify(lendingSession));
        }
        return Promise.resolve(null);
      });

      // Mock database responses for lending queries
      mockDb.request().query.mockImplementation(async (sql: string) => {
        if (sql.includes('ratio')) {
          return { recordset: mockFinancialData.financialRatios };
        } else if (sql.includes('debt') || sql.includes('capacity')) {
          return { recordset: mockLendingPortfolio.companies.map(c => ({
            company_name: c.company_name,
            debt_capacity: c.total_assets * 0.4 - c.debt_amount,
            current_debt: c.debt_amount,
            risk_rating: c.risk_rating
          }))};
        } else if (sql.includes('risk') || sql.includes('score')) {
          return { recordset: mockLendingPortfolio.companies };
        }
        return { recordset: [] };
      });
    });

    it('should execute complete lending workflow sequence', async () => {
      const sequence = workflowTestData.lendingWorkflow.querySequence;
      
      for (const step of sequence) {
        const response = await request(app)
          .post('/api/query')
          .send({
            query: step.query,
            clientId: lendingSession.clientId,
            sessionId: lendingSession.sessionId,
            mode: lendingSession.mode
          })
          .expect(200);

        expect(response.body).toMatchObject({
          success: true,
          data: expect.any(Array),
          metadata: expect.objectContaining({
            template: expect.stringContaining(step.expectedTemplate)
          })
        });
      }
    });

    it('should handle portfolio-wide analysis', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Analyze portfolio risk across all companies",
          clientId: lendingSession.clientId,
          sessionId: lendingSession.sessionId,
          mode: 'lending'
        })
        .expect(200);

      // Should return data for multiple companies
      expect(response.body.data.length).toBeGreaterThan(1);
      expect(response.body.metadata.companiesAnalyzed).toBeGreaterThan(1);
    });

    it('should enforce lending-specific constraints', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "SELECT * FROM detailed_audit_logs", // Audit-specific table
          clientId: lendingSession.clientId,
          sessionId: lendingSession.sessionId,
          mode: 'lending'
        })
        .expect(403);

      expect(response.body.error).toContain('not allowed in lending mode');
    });

    it('should provide lending-specific recommendations', async () => {
      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          query: "Help me assess credit risk for the portfolio",
          clientId: lendingSession.clientId,
          sessionId: lendingSession.sessionId,
          mode: 'lending'
        })
        .expect(200);

      expect(response.body.analysis.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('debt-to-equity'),
          expect.stringContaining('cash flow'),
          expect.stringContaining('credit score')
        ])
      );
    });
  });

  describe('Mode Switching', () => {
    it('should prevent mode switching after session is locked', async () => {
      // Establish audit session
      await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "test-client-123",
          sessionId: "mode-switch-session",
          mode: "audit",
          uploadId: "upload_test_202401"
        })
        .expect(200);

      // Attempt to switch to lending mode
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Analyze portfolio ratios",
          clientId: "test-client-123",
          sessionId: "mode-switch-session",
          mode: "lending" // Different mode
        })
        .expect(400);

      expect(response.body.error).toContain('mode cannot be changed');
    });

    it('should allow new session with different mode', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Analyze portfolio ratios",
          clientId: "test-client-123",
          sessionId: "new-lending-session",
          mode: "lending"
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should create new session when none exists', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "new-client-456",
          sessionId: "brand-new-session",
          mode: "audit",
          uploadId: "upload_test_202401"
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Verify session was created in Redis
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('session:brand-new-session'),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should handle session expiry', async () => {
      // Mock expired session
      mockRedis.get.mockResolvedValue(null); // Session not found

      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "test-client-123",
          sessionId: "expired-session",
          mode: "audit",
          uploadId: "upload_test_202401"
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.sessionRecreated).toBe(true);
    });

    it('should validate client access to upload data', async () => {
      // Mock upload that doesn't belong to client
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('upload:upload_other_client')) {
          return Promise.resolve(JSON.stringify({
            upload_id: 'upload_other_client_202401',
            client_id: 'different-client-789',
            status: 'active'
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "test-client-123",
          sessionId: "unauthorized-session",
          mode: "audit",
          uploadId: "upload_other_client_202401"
        })
        .expect(403);

      expect(response.body.error).toContain('not authorized');
    });
  });

  describe('Error Recovery', () => {
    it('should recover from database timeout', async () => {
      // Mock database timeout on first call, success on retry
      mockDb.request().query
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValue({ recordset: mockFinancialData.accountBalances });

      const response = await request(app)
        .post('/api/query')
        .send({
          query: "Show account balances",
          clientId: "test-client-123",
          sessionId: "recovery-session",
          mode: "audit",
          uploadId: "upload_test_202401"
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.retryAttempts).toBe(1);
    });

    it('should handle AI service degradation', async () => {
      const { ChatAnthropic } = require('@langchain/anthropic');
      ChatAnthropic.mockImplementation(() => ({
        invoke: jest.fn().mockRejectedValue(new Error('Service unavailable'))
      }));

      const response = await request(app)
        .post('/api/query/analyze')
        .send({
          query: "Analyze complex patterns",
          clientId: "test-client-123",
          sessionId: "ai-error-session",
          mode: "audit"
        })
        .expect(503);

      expect(response.body.error).toContain('service unavailable');
      expect(response.body.fallback).toBeDefined();
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent queries from same session', async () => {
      const queries = Array.from({ length: 5 }, (_, i) => 
        request(app)
          .post('/api/query')
          .send({
            query: `Show account balances - query ${i}`,
            clientId: "concurrent-client",
            sessionId: "concurrent-session",
            mode: "audit",
            uploadId: "upload_test_202401"
          })
      );

      const responses = await Promise.all(queries);
      const successfulResponses = responses.filter(r => r.status === 200);
      
      expect(successfulResponses.length).toBe(5);
      
      // All should return consistent session info
      const sessionIds = successfulResponses.map(r => r.body.metadata.sessionId);
      expect(new Set(sessionIds).size).toBe(1);
    });

    it('should enforce query queuing for resource management', async () => {
      // Mock slow database responses
      mockDb.request().query.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({ recordset: [] }), 1000)
        )
      );

      const startTime = Date.now();
      
      const queries = Array.from({ length: 3 }, () => 
        request(app)
          .post('/api/query')
          .send({
            query: "SELECT COUNT(*) FROM upload_test_202401",
            clientId: "queue-client",
            sessionId: "queue-session",
            mode: "audit",
            uploadId: "upload_test_202401"
          })
      );

      await Promise.all(queries);
      const totalTime = Date.now() - startTime;
      
      // Should have queued queries (not fully parallel)
      expect(totalTime).toBeGreaterThan(2000); // At least 2 seconds for 3 queries
    }, 10000);
  });
});