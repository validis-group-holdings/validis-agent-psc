/**
 * End-to-End Audit Workflow Tests
 * 
 * Complete audit workflow scenarios testing the entire system
 * from natural language queries to SQL execution and results.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { workflowTestData, mockFinancialData } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Audit Workflow E2E Tests', () => {
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
    
    // Mock AI responses for different query types
    const { ChatAnthropic } = require('@langchain/anthropic');
    ChatAnthropic.mockImplementation(() => ({
      invoke: jest.fn().mockImplementation(async (messages) => {
        const content = messages.content || messages[0]?.content || '';
        
        if (content.includes('account balance') || content.includes('balance')) {
          return { content: 'Use accountBalance template to show current account balances with client filtering' };
        } else if (content.includes('unusual') || content.includes('pattern') || content.includes('anomal')) {
          return { content: 'Use unusualPatterns template to identify suspicious transactions and entries' };
        } else if (content.includes('weekend') || content.includes('after hours')) {
          return { content: 'Use weekendTransactions template to find transactions outside business hours' };
        } else if (content.includes('journal') || content.includes('entries')) {
          return { content: 'Use journalEntries template to analyze journal entry patterns' };
        } else if (content.includes('vendor') || content.includes('payment')) {
          return { content: 'Use vendorPayments template to examine vendor payment patterns' };
        } else if (content.includes('expense')) {
          return { content: 'Use expenseAnalysis template for detailed expense breakdown' };
        }
        
        return { content: 'Use accountBalance template as default analysis approach' };
      })
    }));
    
    const { default: createApp } = require('../../src/server');
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup audit session context
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('session:audit-e2e-session')) {
        return Promise.resolve(JSON.stringify({
          sessionId: 'audit-e2e-session',
          clientId: 'audit-e2e-client',
          mode: 'audit',
          currentUploadId: 'upload_audit_e2e_202401',
          availableUploadIds: ['upload_audit_e2e_202401'],
          companyContext: {
            name: 'E2E Test Company',
            uploadId: 'upload_audit_e2e_202401',
            period: '2024-01'
          }
        }));
      }
      
      if (key.includes('upload:upload_audit_e2e_202401')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_audit_e2e_202401',
          client_id: 'audit-e2e-client',
          company_name: 'E2E Test Company',
          period: '2024-01',
          status: 'active'
        }));
      }
      
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('Complete Audit Investigation Workflow', () => {
    it('should execute a complete audit investigation from start to finish', async () => {
      const auditWorkflow = [
        {
          step: 1,
          description: 'Initial account balance review',
          query: 'Show me the current account balances for all accounts',
          expectedTemplate: 'accountBalance',
          mockData: mockFinancialData.accountBalances,
          expectedRows: 3
        },
        {
          step: 2,
          description: 'Identify unusual transaction patterns',
          query: 'Find any unusual or suspicious transaction patterns from the last month',
          expectedTemplate: 'unusualPatterns',
          mockData: [
            {
              id: 1,
              transaction_date: '2024-01-15',
              amount: 50000,
              description: 'Large cash withdrawal - unusual',
              risk_score: 8.5,
              client_id: 'audit-e2e-client'
            },
            {
              id: 2,
              transaction_date: '2024-01-22',
              amount: 15000,
              description: 'Round number payment - flagged',
              risk_score: 6.2,
              client_id: 'audit-e2e-client'
            }
          ],
          expectedRows: 2
        },
        {
          step: 3,
          description: 'Investigate weekend/after-hours transactions',
          query: 'Show me all transactions that occurred on weekends or after business hours',
          expectedTemplate: 'weekendTransactions',
          mockData: [
            {
              id: 1,
              transaction_date: '2024-01-06T22:30:00', // Saturday evening
              amount: 5000,
              description: 'After-hours transfer',
              day_of_week: 'Saturday',
              time_of_day: '22:30',
              client_id: 'audit-e2e-client'
            }
          ],
          expectedRows: 1
        },
        {
          step: 4,
          description: 'Review journal entries for manual adjustments',
          query: 'Analyze the journal entries for any manual adjustments or corrections',
          expectedTemplate: 'journalEntries',
          mockData: mockFinancialData.journalEntries,
          expectedRows: 2
        },
        {
          step: 5,
          description: 'Examine vendor payment patterns',
          query: 'Review vendor payments for any irregularities or policy violations',
          expectedTemplate: 'vendorPayments',
          mockData: mockFinancialData.vendorPayments,
          expectedRows: 2
        }
      ];

      for (const step of auditWorkflow) {
        console.log(`\nExecuting Audit Step ${step.step}: ${step.description}`);
        
        // Setup mock database response for this step
        mockDb.request().query.mockResolvedValue({
          recordset: step.mockData
        });

        // Execute the query
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'audit-e2e-client',
            sessionId: 'audit-e2e-session',
            mode: 'audit',
            uploadId: 'upload_audit_e2e_202401',
            query: step.query
          })
          .expect(200);

        // Verify response structure
        expect(response.body).toMatchObject({
          success: true,
          data: expect.any(Array),
          metadata: expect.objectContaining({
            query: expect.any(String),
            template: expect.stringContaining(step.expectedTemplate),
            executionTime: expect.any(Number),
            rowCount: step.expectedRows
          })
        });

        // Verify data integrity
        expect(response.body.data.length).toBe(step.expectedRows);
        
        // All returned data should belong to the client
        response.body.data.forEach((record: any) => {
          expect(record.client_id).toBe('audit-e2e-client');
        });

        console.log(`✓ Step ${step.step} completed successfully - ${step.expectedRows} records found`);
      }

      console.log('\n✅ Complete audit investigation workflow executed successfully');
    });

    it('should handle discovery of issues and drill-down investigations', async () => {
      // Step 1: Initial query finds suspicious transaction
      mockDb.request().query.mockResolvedValueOnce({
        recordset: [
          {
            id: 100,
            transaction_date: '2024-01-15',
            amount: 75000,
            description: 'Large unusual payment',
            vendor_name: 'Suspicious Vendor LLC',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const initialResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Show me all payments over $50,000 from last month'
        })
        .expect(200);

      expect(initialResponse.body.data).toHaveLength(1);
      const suspiciousTransaction = initialResponse.body.data[0];
      expect(suspiciousTransaction.amount).toBe(75000);

      // Step 2: Drill down - investigate this specific vendor
      mockDb.request().query.mockResolvedValueOnce({
        recordset: [
          {
            id: 100,
            transaction_date: '2024-01-15',
            amount: 75000,
            description: 'Large unusual payment',
            vendor_name: 'Suspicious Vendor LLC',
            client_id: 'audit-e2e-client'
          },
          {
            id: 85,
            transaction_date: '2024-01-10',
            amount: 45000,
            description: 'Another large payment',
            vendor_name: 'Suspicious Vendor LLC',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const drillDownResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Show me all payments to Suspicious Vendor LLC this year'
        })
        .expect(200);

      expect(drillDownResponse.body.data).toHaveLength(2);
      expect(drillDownResponse.body.data.every((r: any) => r.vendor_name === 'Suspicious Vendor LLC')).toBe(true);

      // Step 3: Cross-reference - check if vendor exists in approved list
      mockDb.request().query.mockResolvedValueOnce({
        recordset: [] // No approved vendor record found
      });

      const crossRefResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Check if Suspicious Vendor LLC is in our approved vendor list'
        })
        .expect(200);

      expect(crossRefResponse.body.data).toHaveLength(0);

      console.log('✅ Drill-down investigation workflow completed - potential compliance issue identified');
    });
  });

  describe('Audit Controls and Compliance Testing', () => {
    it('should verify segregation of duties controls', async () => {
      // Test for proper segregation between transaction creation and approval
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            transaction_id: 1001,
            created_by: 'user_john_doe',
            approved_by: 'user_john_doe', // Same user - control violation
            amount: 25000,
            description: 'Segregation violation',
            client_id: 'audit-e2e-client'
          },
          {
            transaction_id: 1002,
            created_by: 'user_jane_smith',
            approved_by: 'user_mike_johnson', // Different user - proper control
            amount: 15000,
            description: 'Proper segregation',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Identify transactions where the same person created and approved the transaction'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // The query should identify the control violation
      const violations = response.body.data.filter((r: any) => r.created_by === r.approved_by);
      expect(violations).toHaveLength(1);
      expect(violations[0].transaction_id).toBe(1001);
    });

    it('should test approval limits and authorization controls', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            transaction_id: 2001,
            amount: 150000,
            approver_limit: 100000,
            approver_name: 'manager_smith',
            approval_level_required: 'senior_manager',
            client_id: 'audit-e2e-client'
          },
          {
            transaction_id: 2002,
            amount: 75000,
            approver_limit: 100000,
            approver_name: 'manager_jones',
            approval_level_required: 'manager',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Find transactions approved by users who exceeded their authorization limits'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // Transaction 2001 should be flagged as exceeding limits
      const limitExceeded = response.body.data.filter((r: any) => r.amount > r.approver_limit);
      expect(limitExceeded).toHaveLength(1);
      expect(limitExceeded[0].transaction_id).toBe(2001);
    });

    it('should verify month-end cutoff procedures', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            transaction_id: 3001,
            transaction_date: '2024-01-31T23:45:00',
            posting_date: '2024-02-01T08:15:00',
            amount: 8500,
            description: 'Late posting - cutoff issue',
            client_id: 'audit-e2e-client'
          },
          {
            transaction_id: 3002,
            transaction_date: '2024-01-31T14:30:00',
            posting_date: '2024-01-31T16:00:00',
            amount: 12000,
            description: 'Proper cutoff timing',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Identify transactions with cutoff issues where transaction date and posting date are in different periods'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // Should identify cutoff violations
      const cutoffIssues = response.body.data.filter((r: any) => {
        const transDate = new Date(r.transaction_date);
        const postDate = new Date(r.posting_date);
        return transDate.getMonth() !== postDate.getMonth();
      });
      
      expect(cutoffIssues).toHaveLength(1);
      expect(cutoffIssues[0].transaction_id).toBe(3001);
    });
  });

  describe('Month-End and Period-End Procedures', () => {
    it('should test month-end adjustment entries', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            journal_id: 'JE-2024-001',
            entry_date: '2024-01-31',
            description: 'Depreciation expense - monthly',
            debit_account: '6500',
            credit_account: '1500',
            amount: 5000,
            entry_type: 'adjustment',
            prepared_by: 'accounting_clerk',
            reviewed_by: 'accounting_manager',
            client_id: 'audit-e2e-client'
          },
          {
            journal_id: 'JE-2024-002',
            entry_date: '2024-01-31',
            description: 'Accrued expenses',
            debit_account: '6000',
            credit_account: '2100',
            amount: 3500,
            entry_type: 'adjustment',
            prepared_by: 'accounting_clerk',
            reviewed_by: null, // Missing review - control issue
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Review all month-end adjustment entries and verify proper approval controls'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // Check for unapproved adjustments
      const unapproved = response.body.data.filter((r: any) => !r.reviewed_by);
      expect(unapproved).toHaveLength(1);
      expect(unapproved[0].journal_id).toBe('JE-2024-002');
    });

    it('should validate accruals and deferrals', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            accrual_id: 'ACC-2024-001',
            account_name: 'Accrued Interest Expense',
            amount: 2500,
            calculation_basis: '50000 * 0.05 / 12',
            supporting_documentation: 'loan_agreement_123.pdf',
            reversal_date: '2024-02-01',
            client_id: 'audit-e2e-client'
          },
          {
            accrual_id: 'ACC-2024-002',
            account_name: 'Accrued Consulting Fees',
            amount: 8500,
            calculation_basis: null, // Missing documentation
            supporting_documentation: null,
            reversal_date: '2024-02-01',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Examine accruals for proper documentation and calculation support'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // Identify accruals lacking proper support
      const unsupported = response.body.data.filter((r: any) => !r.calculation_basis || !r.supporting_documentation);
      expect(unsupported).toHaveLength(1);
      expect(unsupported[0].accrual_id).toBe('ACC-2024-002');
    });
  });

  describe('Error Handling in Audit Workflow', () => {
    it('should handle database timeouts gracefully during audit', async () => {
      // Mock timeout on complex audit query
      mockDb.request().query.mockRejectedValue(new Error('Query timeout'));

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Perform comprehensive analysis of all transactions with complex calculations'
        })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('timeout'),
        suggestion: expect.stringContaining('simplify query')
      });
    });

    it('should provide meaningful error messages for audit-specific issues', async () => {
      // Mock missing audit trail data
      mockDb.request().query.mockResolvedValue({ recordset: [] });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Show me the audit trail for all high-value transactions'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.metadata.auditNote).toContain('No audit trail records found');
    });

    it('should handle partial data corruption during audit', async () => {
      // Mock corrupted data response
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            id: 1,
            account_name: 'Cash',
            balance: 10000,
            client_id: 'audit-e2e-client'
          },
          {
            id: 2,
            account_name: null, // Corrupted data
            balance: null,
            client_id: 'audit-e2e-client'
          },
          {
            id: 3,
            account_name: 'Inventory',
            balance: 25000,
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Show all account balances for review'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.metadata.dataQualityIssues).toContain('null values detected');
    });
  });

  describe('Audit Report Generation', () => {
    it('should generate comprehensive audit summary', async () => {
      // Mock summary data for report
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            finding_type: 'Control Weakness',
            severity: 'Medium',
            count: 3,
            description: 'Segregation of duties violations',
            client_id: 'audit-e2e-client'
          },
          {
            finding_type: 'Data Quality Issue',
            severity: 'Low',
            count: 7,
            description: 'Missing vendor information',
            client_id: 'audit-e2e-client'
          },
          {
            finding_type: 'Policy Violation',
            severity: 'High',
            count: 1,
            description: 'Approval limit exceeded',
            client_id: 'audit-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'audit-e2e-client',
          sessionId: 'audit-e2e-session',
          mode: 'audit',
          uploadId: 'upload_audit_e2e_202401',
          query: 'Generate a summary of all audit findings and their severity levels'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      
      // Verify high severity issues are flagged
      const highSeverity = response.body.data.filter((r: any) => r.severity === 'High');
      expect(highSeverity).toHaveLength(1);
      expect(highSeverity[0].finding_type).toBe('Policy Violation');
    });
  });
});