/**
 * End-to-End Lending Workflow Tests
 * 
 * Complete lending workflow scenarios testing portfolio analysis,
 * risk assessment, and credit decision support workflows.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { mockLendingPortfolio, mockFinancialData } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('Lending Workflow E2E Tests', () => {
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
    
    // Mock AI responses for lending queries
    const { ChatAnthropic } = require('@langchain/anthropic');
    ChatAnthropic.mockImplementation(() => ({
      invoke: jest.fn().mockImplementation(async (messages) => {
        const content = messages.content || messages[0]?.content || '';
        
        if (content.includes('ratio') || content.includes('financial')) {
          return { content: 'Use financialRatios template for comprehensive ratio analysis across portfolio companies' };
        } else if (content.includes('debt') || content.includes('capacity')) {
          return { content: 'Use debtCapacity template to analyze borrowing capacity and existing debt levels' };
        } else if (content.includes('risk') || content.includes('score')) {
          return { content: 'Use riskScoring template for comprehensive credit risk assessment' };
        } else if (content.includes('cash') || content.includes('liquidity')) {
          return { content: 'Use liquidityAnalysis template to evaluate cash flow and liquidity positions' };
        } else if (content.includes('covenant') || content.includes('compliance')) {
          return { content: 'Use covenantCompliance template to monitor loan covenant adherence' };
        } else if (content.includes('portfolio') || content.includes('overview')) {
          return { content: 'Use portfolioCash template for high-level portfolio performance overview' };
        }
        
        return { content: 'Use financialRatios template as default lending analysis approach' };
      })
    }));
    
    const { default: createApp } = require('../../src/server');
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup lending session context with portfolio
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('session:lending-e2e-session')) {
        return Promise.resolve(JSON.stringify({
          sessionId: 'lending-e2e-session',
          clientId: 'lending-e2e-client',
          mode: 'lending',
          availableUploadIds: ['upload_techcorp_202401', 'upload_manufacturing_202401', 'upload_retail_202401'],
          portfolioContext: {
            totalCompanies: 3,
            activeUploadIds: ['upload_techcorp_202401', 'upload_manufacturing_202401', 'upload_retail_202401']
          }
        }));
      }
      
      // Mock upload info for each company
      if (key.includes('upload:upload_techcorp_202401')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_techcorp_202401',
          client_id: 'lending-e2e-client',
          company_name: 'TechCorp Inc',
          period: '2024-01',
          status: 'active'
        }));
      }
      if (key.includes('upload:upload_manufacturing_202401')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_manufacturing_202401',
          client_id: 'lending-e2e-client',
          company_name: 'Manufacturing LLC',
          period: '2024-01',
          status: 'active'
        }));
      }
      if (key.includes('upload:upload_retail_202401')) {
        return Promise.resolve(JSON.stringify({
          upload_id: 'upload_retail_202401',
          client_id: 'lending-e2e-client',
          company_name: 'Retail Solutions',
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

  describe('Complete Credit Assessment Workflow', () => {
    it('should execute a complete credit assessment from portfolio overview to decision', async () => {
      const creditWorkflow = [
        {
          step: 1,
          description: 'Portfolio overview and initial screening',
          query: 'Show me an overview of all companies in the portfolio with key financial metrics',
          expectedTemplate: 'portfolioCash',
          mockData: mockLendingPortfolio.companies,
          expectedRows: 3
        },
        {
          step: 2,
          description: 'Detailed financial ratio analysis',
          query: 'Calculate comprehensive financial ratios for all portfolio companies',
          expectedTemplate: 'financialRatios',
          mockData: [
            {
              company_name: 'TechCorp Inc',
              current_ratio: 2.35,
              debt_to_equity: 0.45,
              roa: 0.12,
              roe: 0.18,
              gross_margin: 0.65,
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Manufacturing LLC',
              current_ratio: 1.85,
              debt_to_equity: 0.72,
              roa: 0.09,
              roe: 0.15,
              gross_margin: 0.42,
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Retail Solutions',
              current_ratio: 1.92,
              debt_to_equity: 0.38,
              roa: 0.07,
              roe: 0.11,
              gross_margin: 0.38,
              client_id: 'lending-e2e-client'
            }
          ],
          expectedRows: 3
        },
        {
          step: 3,
          description: 'Debt capacity and borrowing analysis',
          query: 'Analyze debt capacity and existing debt levels for each company',
          expectedTemplate: 'debtCapacity',
          mockData: [
            {
              company_name: 'TechCorp Inc',
              current_debt: 1200000,
              debt_capacity: 800000,
              available_capacity: 800000,
              debt_service_coverage: 3.2,
              recommended_limit: 2000000,
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Manufacturing LLC',
              current_debt: 2100000,
              debt_capacity: 1100000,
              available_capacity: 1100000,
              debt_service_coverage: 2.1,
              recommended_limit: 3200000,
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Retail Solutions',
              current_debt: 850000,
              debt_capacity: 430000,
              available_capacity: 430000,
              debt_service_coverage: 2.8,
              recommended_limit: 1280000,
              client_id: 'lending-e2e-client'
            }
          ],
          expectedRows: 3
        },
        {
          step: 4,
          description: 'Risk scoring and creditworthiness assessment',
          query: 'Generate comprehensive risk scores for all companies based on financial and operational factors',
          expectedTemplate: 'riskScoring',
          mockData: [
            {
              company_name: 'TechCorp Inc',
              credit_score: 720,
              risk_grade: 'B+',
              probability_of_default: 0.045,
              risk_factors: ['Industry volatility', 'High growth rate'],
              strengths: ['Strong cash flow', 'Low debt ratio', 'Growing market'],
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Manufacturing LLC',
              credit_score: 680,
              risk_grade: 'B',
              probability_of_default: 0.078,
              risk_factors: ['Cyclical industry', 'Higher leverage'],
              strengths: ['Established operations', 'Diverse customer base'],
              client_id: 'lending-e2e-client'
            },
            {
              company_name: 'Retail Solutions',
              credit_score: 750,
              risk_grade: 'A-',
              probability_of_default: 0.025,
              risk_factors: ['Seasonal variations'],
              strengths: ['Low debt', 'Stable margins', 'Strong management'],
              client_id: 'lending-e2e-client'
            }
          ],
          expectedRows: 3
        },
        {
          step: 5,
          description: 'Liquidity and cash flow analysis',
          query: 'Evaluate liquidity positions and cash flow sustainability for lending decisions',
          expectedTemplate: 'liquidityAnalysis',
          mockData: [
            ...mockLendingPortfolio.cashFlowData,
            {
              id: 2,
              upload_id: 'upload_manufacturing_202401',
              month: '2024-01',
              operating_cash_flow: 225000,
              investing_cash_flow: -125000,
              financing_cash_flow: -45000,
              net_cash_flow: 55000,
              client_id: 'lending-e2e-client'
            },
            {
              id: 3,
              upload_id: 'upload_retail_202401',
              month: '2024-01',
              operating_cash_flow: 95000,
              investing_cash_flow: -25000,
              financing_cash_flow: -15000,
              net_cash_flow: 55000,
              client_id: 'lending-e2e-client'
            }
          ],
          expectedRows: 3
        }
      ];

      for (const step of creditWorkflow) {
        console.log(`\nExecuting Credit Assessment Step ${step.step}: ${step.description}`);
        
        // Setup mock database response for this step
        mockDb.request().query.mockResolvedValue({
          recordset: step.mockData
        });

        // Execute the query
        const response = await request(app)
          .post('/api/query')
          .send({
            clientId: 'lending-e2e-client',
            sessionId: 'lending-e2e-session',
            mode: 'lending',
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
            rowCount: step.expectedRows,
            companiesAnalyzed: step.expectedRows
          })
        });

        // Verify data integrity
        expect(response.body.data.length).toBe(step.expectedRows);
        
        // All returned data should belong to the client
        response.body.data.forEach((record: any) => {
          expect(record.client_id).toBe('lending-e2e-client');
        });

        console.log(`✓ Step ${step.step} completed successfully - ${step.expectedRows} companies analyzed`);
      }

      console.log('\n✅ Complete credit assessment workflow executed successfully');
    });

    it('should handle credit decision recommendations and loan structuring', async () => {
      // Step 1: Get risk assessment results
      mockDb.request().query.mockResolvedValueOnce({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            credit_score: 720,
            debt_service_coverage: 3.2,
            current_ratio: 2.35,
            recommended_amount: 500000,
            interest_rate_category: 'Prime + 2%',
            collateral_requirement: 'Minimal',
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const riskResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Provide loan recommendation for TechCorp Inc based on comprehensive risk analysis'
        })
        .expect(200);

      expect(riskResponse.body.data).toHaveLength(1);
      const recommendation = riskResponse.body.data[0];
      expect(recommendation.recommended_amount).toBe(500000);
      expect(recommendation.interest_rate_category).toBe('Prime + 2%');

      // Step 2: Analyze loan covenant requirements
      mockDb.request().query.mockResolvedValueOnce({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            min_debt_service_coverage: 1.5,
            max_debt_to_equity: 0.75,
            min_current_ratio: 1.25,
            quarterly_reporting: true,
            annual_audit: true,
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const covenantResponse = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Define appropriate loan covenants for TechCorp Inc based on their financial profile'
        })
        .expect(200);

      expect(covenantResponse.body.data).toHaveLength(1);
      expect(covenantResponse.body.data[0].min_debt_service_coverage).toBe(1.5);

      console.log('✅ Credit decision and loan structuring analysis completed');
    });
  });

  describe('Portfolio Risk Management', () => {
    it('should monitor portfolio concentration and diversification', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            industry: 'Technology',
            company_count: 1,
            total_exposure: 1200000,
            percentage_of_portfolio: 0.25,
            risk_concentration: 'Acceptable',
            client_id: 'lending-e2e-client'
          },
          {
            industry: 'Manufacturing',
            company_count: 1,
            total_exposure: 2100000,
            percentage_of_portfolio: 0.44,
            risk_concentration: 'High',
            client_id: 'lending-e2e-client'
          },
          {
            industry: 'Retail',
            company_count: 1,
            total_exposure: 850000,
            percentage_of_portfolio: 0.18,
            risk_concentration: 'Low',
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Analyze portfolio concentration risk by industry and recommend diversification strategies'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      
      // Identify high concentration risks
      const highRisk = response.body.data.filter((r: any) => r.risk_concentration === 'High');
      expect(highRisk).toHaveLength(1);
      expect(highRisk[0].industry).toBe('Manufacturing');
      expect(highRisk[0].percentage_of_portfolio).toBe(0.44);
    });

    it('should track covenant compliance across portfolio', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            covenant_type: 'Debt Service Coverage',
            required_minimum: 1.5,
            current_value: 3.2,
            status: 'Compliant',
            margin: 1.7,
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Manufacturing LLC',
            covenant_type: 'Current Ratio',
            required_minimum: 1.25,
            current_value: 1.15,
            status: 'Breach',
            margin: -0.1,
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Retail Solutions',
            covenant_type: 'Debt-to-Equity',
            required_maximum: 0.75,
            current_value: 0.38,
            status: 'Compliant',
            margin: 0.37,
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Monitor loan covenant compliance across all portfolio companies'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      
      // Identify covenant breaches
      const breaches = response.body.data.filter((r: any) => r.status === 'Breach');
      expect(breaches).toHaveLength(1);
      expect(breaches[0].company_name).toBe('Manufacturing LLC');
      expect(breaches[0].covenant_type).toBe('Current Ratio');
    });

    it('should perform stress testing scenarios', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            scenario: 'Economic Downturn (-20% Revenue)',
            projected_debt_service_coverage: 2.1,
            projected_current_ratio: 1.8,
            survival_probability: 0.85,
            risk_level: 'Medium',
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Manufacturing LLC',
            scenario: 'Economic Downturn (-20% Revenue)',
            projected_debt_service_coverage: 1.2,
            projected_current_ratio: 1.1,
            survival_probability: 0.65,
            risk_level: 'High',
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Retail Solutions',
            scenario: 'Economic Downturn (-20% Revenue)',
            projected_debt_service_coverage: 2.0,
            projected_current_ratio: 1.45,
            survival_probability: 0.88,
            risk_level: 'Low',
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Run stress testing scenarios for portfolio companies under economic downturn conditions'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      
      // Identify high-risk companies under stress
      const highRisk = response.body.data.filter((r: any) => r.risk_level === 'High');
      expect(highRisk).toHaveLength(1);
      expect(highRisk[0].company_name).toBe('Manufacturing LLC');
      expect(highRisk[0].survival_probability).toBe(0.65);
    });
  });

  describe('Credit Monitoring and Early Warning', () => {
    it('should identify early warning indicators', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            company_name: 'Manufacturing LLC',
            indicator: 'Declining Cash Flow',
            current_value: -15000,
            threshold: 50000,
            severity: 'High',
            trend: 'Worsening',
            months_observed: 2,
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'TechCorp Inc',
            indicator: 'Increasing Receivables Days',
            current_value: 65,
            threshold: 45,
            severity: 'Medium',
            trend: 'Stable',
            months_observed: 1,
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Identify early warning indicators for potential credit deterioration'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      
      // High severity warnings should be flagged
      const highSeverity = response.body.data.filter((r: any) => r.severity === 'High');
      expect(highSeverity).toHaveLength(1);
      expect(highSeverity[0].indicator).toBe('Declining Cash Flow');
    });

    it('should track payment history and behavior', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            payment_due_date: '2024-01-15',
            payment_received_date: '2024-01-14',
            days_early_late: -1,
            amount_due: 25000,
            amount_paid: 25000,
            payment_status: 'On Time',
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Manufacturing LLC',
            payment_due_date: '2024-01-15',
            payment_received_date: '2024-01-22',
            days_early_late: 7,
            amount_due: 35000,
            amount_paid: 30000,
            payment_status: 'Late/Partial',
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Retail Solutions',
            payment_due_date: '2024-01-15',
            payment_received_date: '2024-01-13',
            days_early_late: -2,
            amount_due: 18000,
            amount_paid: 18000,
            payment_status: 'Early',
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Analyze payment history and behavior patterns for all borrowers'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      
      // Identify problem payments
      const problemPayments = response.body.data.filter((r: any) => 
        r.payment_status.includes('Late') || r.payment_status.includes('Partial')
      );
      expect(problemPayments).toHaveLength(1);
      expect(problemPayments[0].company_name).toBe('Manufacturing LLC');
    });
  });

  describe('Regulatory and Compliance Reporting', () => {
    it('should generate regulatory capital calculations', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            loan_category: 'Commercial - Secured',
            outstanding_balance: 1200000,
            risk_weight: 0.50,
            risk_weighted_assets: 600000,
            required_capital: 48000,
            client_id: 'lending-e2e-client'
          },
          {
            loan_category: 'Commercial - Unsecured',
            outstanding_balance: 2100000,
            risk_weight: 1.00,
            risk_weighted_assets: 2100000,
            required_capital: 168000,
            client_id: 'lending-e2e-client'
          },
          {
            loan_category: 'Small Business',
            outstanding_balance: 850000,
            risk_weight: 0.75,
            risk_weighted_assets: 637500,
            required_capital: 51000,
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Calculate regulatory capital requirements for the lending portfolio'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      
      const totalRiskWeighted = response.body.data.reduce((sum: number, r: any) => sum + r.risk_weighted_assets, 0);
      const totalCapitalRequired = response.body.data.reduce((sum: number, r: any) => sum + r.required_capital, 0);
      
      expect(totalRiskWeighted).toBe(3337500);
      expect(totalCapitalRequired).toBe(267000);
    });

    it('should monitor large exposure limits', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            borrower_name: 'Manufacturing LLC',
            total_exposure: 2100000,
            regulatory_limit: 5000000,
            percentage_of_capital: 0.18,
            limit_utilization: 0.42,
            status: 'Within Limits',
            client_id: 'lending-e2e-client'
          },
          {
            borrower_name: 'TechCorp Inc',
            total_exposure: 1200000,
            regulatory_limit: 5000000,
            percentage_of_capital: 0.10,
            limit_utilization: 0.24,
            status: 'Within Limits',
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Monitor large exposure limits and concentration risks for regulatory compliance'
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((r: any) => r.status === 'Within Limits')).toBe(true);
    });
  });

  describe('Error Handling in Lending Workflow', () => {
    it('should handle missing company data gracefully', async () => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          {
            company_name: 'TechCorp Inc',
            financial_data_available: true,
            risk_score: 720,
            client_id: 'lending-e2e-client'
          },
          {
            company_name: 'Incomplete Company',
            financial_data_available: false,
            risk_score: null,
            client_id: 'lending-e2e-client'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'lending-e2e-client',
          sessionId: 'lending-e2e-session',
          mode: 'lending',
          query: 'Generate risk assessment for all portfolio companies'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.metadata.dataCompleteness).toContain('incomplete data');
    });

    it('should handle portfolio access errors', async () => {
      // Mock session with no available uploads
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('session:empty-portfolio-session')) {
          return Promise.resolve(JSON.stringify({
            sessionId: 'empty-portfolio-session',
            clientId: 'empty-client',
            mode: 'lending',
            availableUploadIds: [],
            portfolioContext: {
              totalCompanies: 0,
              activeUploadIds: []
            }
          }));
        }
        return Promise.resolve(null);
      });

      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'empty-client',
          sessionId: 'empty-portfolio-session',
          mode: 'lending',
          query: 'Show portfolio overview'
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('no companies in portfolio'),
        suggestion: expect.stringContaining('upload company data')
      });
    });
  });
});