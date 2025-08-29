/**
 * Client Data Isolation Tests
 * 
 * Tests strict client data isolation, preventing cross-client
 * data access and ensuring proper authorization boundaries.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { mockFinancialData, mockLendingPortfolio } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Client Data Isolation Tests', () => {
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
    
    // Setup mock data for different clients
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('upload:upload_client_a')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_client_a_202401',
          client_id: 'client-a-123',
          company_name: 'Company A',
          status: 'active'
        }));
      }
      if (key.includes('upload:upload_client_b')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_client_b_202401',
          client_id: 'client-b-456',
          company_name: 'Company B', 
          status: 'active'
        }));
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('Upload ID Authorization', () => {
    it('should allow access to own client upload data', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: mockFinancialData.accountBalances.filter(r => r.client_id === 'client-a-123')
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'session-a',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT * FROM upload_client_a_202401 WHERE client_id = \'client-a-123\''
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should deny access to other client upload data', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'session-a',
          mode: 'audit',
          uploadId: 'upload_client_b_202401', // Different client's upload
          query: 'SELECT * FROM upload_client_b_202401'
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('not authorized'),
        violation: 'UPLOAD_ACCESS_DENIED',
        uploadId: 'upload_client_b_202401',
        requestedBy: 'client-a-123',
        ownedBy: 'client-b-456'
      });
    });

    it('should validate upload ownership during session initialization', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'new-session',
          mode: 'audit',
          uploadId: 'upload_nonexistent_202401',
          query: 'SELECT * FROM upload_nonexistent_202401'
        })
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Upload not found'),
        uploadId: 'upload_nonexistent_202401'
      });
    });

    it('should prevent upload ID manipulation in queries', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'manipulation-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT * FROM upload_client_b_202401' // Query references different upload
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('unauthorized table access'),
        violation: 'CROSS_CLIENT_TABLE_ACCESS',
        authorizedUpload: 'upload_client_a_202401',
        unauthorizedTable: 'upload_client_b_202401'
      });
    });
  });

  describe('Client ID Filtering', () => {
    it('should automatically inject client_id filters', async () => {
      mockDb.request().query.mockImplementation((sql: string) => {
        // Verify client_id filter was injected
        expect(sql).toContain('client_id = \'client-a-123\'');
        return Promise.resolve({
          recordset: mockFinancialData.accountBalances.filter(r => r.client_id === 'client-a-123')
        });
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'filter-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT account_name, balance FROM upload_client_a_202401'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockDb.request().query).toHaveBeenCalledWith(
        expect.stringContaining('client_id = \'client-a-123\'')
      );
    });

    it('should reject queries that try to bypass client_id filters', async () => {
      const bypassAttempts = [
        'SELECT * FROM upload_client_a_202401 WHERE client_id != \'client-a-123\'',
        'SELECT * FROM upload_client_a_202401 WHERE client_id = \'client-b-456\'',
        'SELECT * FROM upload_client_a_202401 WHERE 1=1 OR client_id = \'other-client\'',
        'SELECT * FROM upload_client_a_202401 WHERE client_id IN (\'client-a-123\', \'client-b-456\')'
      ];

      for (const query of bypassAttempts) {
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'client-a-123',
            sessionId: 'bypass-session',
            mode: 'audit',
            uploadId: 'upload_client_a_202401',
            query
          })
          .expect(403);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('filter bypass'),
          violation: 'CLIENT_FILTER_BYPASS'
        });
      }
    });

    it('should handle queries without explicit client_id filters', async () => {
      mockDb.request().query.mockImplementation((sql: string) => {
        // Should have auto-injected client filter
        expect(sql).toContain('client_id = \'client-a-123\'');
        return Promise.resolve({ recordset: [] });
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'auto-filter-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT COUNT(*) FROM upload_client_a_202401'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Cross-Client Query Detection', () => {
    it('should detect direct table name violations', async () => {
      const crossClientQueries = [
        'SELECT * FROM upload_other_client_202401',
        'SELECT COUNT(*) FROM upload_client_b_202401',
        'SELECT balance FROM upload_competitor_data',
        'SELECT sensitive_data FROM client_xyz_financial_data'
      ];

      for (const query of crossClientQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'client-a-123',
            sessionId: 'cross-client-session',
            mode: 'audit',
            uploadId: 'upload_client_a_202401',
            query
          })
          .expect(403);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('unauthorized'),
          violation: 'CROSS_CLIENT_ACCESS',
          unauthorizedTable: expect.any(String)
        });
      }
    });

    it('should detect join-based cross-client access', async () => {
      const joinQueries = [
        `SELECT a.*, b.sensitive_data 
         FROM upload_client_a_202401 a 
         JOIN upload_client_b_202401 b ON a.id = b.ref_id`,
        
        `SELECT client_a.balance, client_b.revenue
         FROM upload_client_a_202401 client_a, upload_client_b_202401 client_b
         WHERE client_a.company_id = client_b.company_id`,
         
        `SELECT * FROM upload_client_a_202401 
         WHERE id IN (SELECT id FROM upload_other_client_202401)`
      ];

      for (const query of joinQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'client-a-123',
            sessionId: 'join-attack-session',
            mode: 'audit',
            uploadId: 'upload_client_a_202401',
            query
          })
          .expect(403);

        expect(response.body.violation).toBe('CROSS_CLIENT_JOIN');
      }
    });

    it('should detect union-based cross-client access', async () => {
      const unionQueries = [
        `SELECT account_name, balance FROM upload_client_a_202401
         UNION
         SELECT account_name, balance FROM upload_client_b_202401`,
         
        `SELECT * FROM upload_client_a_202401 WHERE amount > 1000
         UNION ALL
         SELECT * FROM upload_competitor_data WHERE amount > 1000`
      ];

      for (const query of unionQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'client-a-123',
            sessionId: 'union-attack-session',
            mode: 'audit',
            uploadId: 'upload_client_a_202401',
            query
          })
          .expect(403);

        expect(response.body.violation).toBe('CROSS_CLIENT_UNION');
      }
    });
  });

  describe('Lending Mode Portfolio Isolation', () => {
    beforeEach(() => {
      // Setup portfolio data for different lending clients
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('session:lending-session-a')) {
          return Promise.resolve(JSON.stringify({
            sessionId: 'lending-session-a',
            clientId: 'lending-client-a',
            mode: 'lending',
            availableUploadIds: ['upload_company_1', 'upload_company_2'],
            portfolioContext: {
              totalCompanies: 2,
              activeUploadIds: ['upload_company_1', 'upload_company_2']
            }
          }));
        }
        if (key.includes('session:lending-session-b')) {
          return Promise.resolve(JSON.stringify({
            sessionId: 'lending-session-b',
            clientId: 'lending-client-b',
            mode: 'lending',
            availableUploadIds: ['upload_company_3', 'upload_company_4'],
            portfolioContext: {
              totalCompanies: 2,
              activeUploadIds: ['upload_company_3', 'upload_company_4']
            }
          }));
        }
        return Promise.resolve(null);
      });
    });

    it('should restrict portfolio queries to client\'s companies', async () => {
      mockDb.request().query.mockImplementation((sql: string) => {
        // Should only access authorized upload IDs
        expect(sql).toMatch(/(upload_company_1|upload_company_2)/);
        expect(sql).not.toMatch(/(upload_company_3|upload_company_4)/);
        return Promise.resolve({ recordset: [] });
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-client-a',
          sessionId: 'lending-session-a',
          mode: 'lending',
          query: 'SELECT company_name, debt_amount FROM portfolio_companies'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should prevent access to other client\'s portfolio', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-client-a',
          sessionId: 'lending-session-a',
          mode: 'lending',
          query: 'SELECT * FROM upload_company_3' // Client B's company
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('unauthorized'),
        violation: 'PORTFOLIO_ACCESS_DENIED',
        unauthorizedUpload: 'upload_company_3'
      });
    });

    it('should validate company ownership in cross-references', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-client-a',
          sessionId: 'lending-session-a',
          mode: 'lending',
          query: `SELECT a.company_name, b.financial_data 
                  FROM upload_company_1 a 
                  JOIN upload_company_3 b ON a.id = b.ref_id` // Company 3 not owned
        })
        .expect(403);

      expect(response.body.violation).toBe('CROSS_PORTFOLIO_ACCESS');
    });
  });

  describe('Session Context Isolation', () => {
    it('should isolate session data between clients', async () => {
      // Setup sessions for different clients
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('session:shared-session-id')) {
          // Same session ID but should be isolated by client
          if (key.includes('client-a-123')) {
            return Promise.resolve(JSON.stringify({
              sessionId: 'shared-session-id',
              clientId: 'client-a-123',
              mode: 'audit',
              currentUploadId: 'upload_client_a_202401'
            }));
          }
          if (key.includes('client-b-456')) {
            return Promise.resolve(JSON.stringify({
              sessionId: 'shared-session-id',
              clientId: 'client-b-456',
              mode: 'audit',
              currentUploadId: 'upload_client_b_202401'
            }));
          }
        }
        return Promise.resolve(null);
      });

      // Client A should only see their data
      const responseA = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'shared-session-id',
          mode: 'audit',
          query: 'SELECT * FROM upload_client_a_202401'
        })
        .expect(200);

      // Client B should only see their data
      const responseB = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-b-456',
          sessionId: 'shared-session-id',
          mode: 'audit',
          query: 'SELECT * FROM upload_client_b_202401'
        })
        .expect(200);

      expect(responseA.body.success).toBe(true);
      expect(responseB.body.success).toBe(true);

      // Verify sessions are isolated
      expect(mockRedis.get).toHaveBeenCalledWith('session:shared-session-id:client-a-123');
      expect(mockRedis.get).toHaveBeenCalledWith('session:shared-session-id:client-b-456');
    });

    it('should prevent session hijacking attempts', async () => {
      // Client A tries to use Client B's session context
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123', // Client A
          sessionId: 'lending-session-b', // But using Client B's session
          mode: 'lending',
          query: 'SELECT * FROM portfolio_companies'
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('session mismatch'),
        violation: 'SESSION_HIJACK_ATTEMPT',
        requestingClient: 'client-a-123',
        sessionOwner: 'lending-client-b'
      });
    });
  });

  describe('Cache Isolation', () => {
    it('should isolate cached query results between clients', async () => {
      const query = 'SELECT account_name, balance FROM transactions LIMIT 100';
      
      // Setup different cached results for each client
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('query:client-a-123')) {
          return Promise.resolve(JSON.stringify({
            data: [{ account: 'Client A Data', balance: 1000 }],
            metadata: { fromCache: true }
          }));
        }
        if (key.includes('query:client-b-456')) {
          return Promise.resolve(JSON.stringify({
            data: [{ account: 'Client B Data', balance: 2000 }],
            metadata: { fromCache: true }
          }));
        }
        return Promise.resolve(null);
      });

      // Client A query
      const responseA = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'cache-session-a',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query
        })
        .expect(200);

      // Client B query  
      const responseB = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-b-456',
          sessionId: 'cache-session-b',
          mode: 'audit',
          uploadId: 'upload_client_b_202401',
          query
        })
        .expect(200);

      // Should get different cached results
      expect(responseA.body.data[0].account).toBe('Client A Data');
      expect(responseB.body.data[0].account).toBe('Client B Data');

      // Verify separate cache keys were used
      const clientAKey = `query:client-a-123:${Buffer.from(query).toString('base64')}`;
      const clientBKey = `query:client-b-456:${Buffer.from(query).toString('base64')}`;
      
      expect(mockRedis.get).toHaveBeenCalledWith(clientAKey);
      expect(mockRedis.get).toHaveBeenCalledWith(clientBKey);
    });

    it('should not allow cache key manipulation for cross-client access', async () => {
      // Attempt to manipulate cache key to access other client's data
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'cache-manipulation-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT * FROM upload_client_a_202401',
          options: {
            cacheKeyOverride: 'query:client-b-456:sensitive-data'
          }
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('invalid cache operation'),
        violation: 'CACHE_KEY_MANIPULATION'
      });
    });
  });

  describe('Audit Trail for Isolation Violations', () => {
    it('should log all isolation violation attempts', async () => {
      await request(app)
        .post('/api/query')
        .send({
          clientId: 'client-a-123',
          sessionId: 'audit-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT * FROM upload_client_b_202401'
        })
        .expect(403);

      // Verify comprehensive audit logging
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/audit:violation:/),
        expect.stringContaining(JSON.stringify({
          type: 'CROSS_CLIENT_ACCESS',
          clientId: 'client-a-123',
          attemptedAccess: 'upload_client_b_202401',
          authorizedAccess: 'upload_client_a_202401',
          timestamp: expect.any(String),
          severity: 'HIGH'
        })),
        expect.any(Object)
      );
    });

    it('should escalate repeated violation attempts', async () => {
      const violations = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: 'persistent-violator',
            sessionId: `violation-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_client_a_202401',
            query: `SELECT * FROM upload_other_client_${i}`
          })
          .expect(403)
      );

      await Promise.all(violations);

      // Next request should trigger escalated blocking
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'persistent-violator',
          sessionId: 'escalated-block-session',
          mode: 'audit',
          uploadId: 'upload_client_a_202401',
          query: 'SELECT COUNT(*) FROM upload_client_a_202401' // Even legitimate query
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('client temporarily blocked'),
        escalation: true,
        violationCount: 5,
        blockDuration: expect.any(Number)
      });
    });
  });

  describe('Administrative Override Controls', () => {
    it('should allow admin cross-client access with proper authorization', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [{ audit_trail: 'Admin access logged' }]
      });

      const response = await request(app)
        .post('/api/query')
        .set('Authorization', 'Bearer admin-token')
        .set('X-Admin-Override', 'cross-client-audit')
        .send({
          clientId: 'client-a-123',
          sessionId: 'admin-override-session',
          mode: 'audit',
          uploadId: 'upload_client_b_202401', // Cross-client access
          query: 'SELECT * FROM upload_client_b_202401',
          adminReason: 'Compliance audit investigation'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.adminOverride).toBe(true);

      // Verify admin access was logged
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/audit:admin_override:/),
        expect.stringContaining('cross-client-audit'),
        expect.any(Object)
      );
    });

    it('should reject admin override without proper credentials', async () => {
      const response = await request(app)
        .post('/api/query')
        .set('X-Admin-Override', 'cross-client-audit') // No admin token
        .send({
          clientId: 'client-a-123',
          sessionId: 'fake-admin-session',
          mode: 'audit',
          uploadId: 'upload_client_b_202401',
          query: 'SELECT * FROM upload_client_b_202401'
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('admin authorization required'),
        violation: 'UNAUTHORIZED_OVERRIDE_ATTEMPT'
      });
    });
  });
});