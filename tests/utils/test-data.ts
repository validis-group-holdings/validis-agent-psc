/**
 * Test Data and Mock Data Sets
 * 
 * Provides comprehensive mock data for different testing scenarios
 * including financial data, audit scenarios, and edge cases.
 */

export const mockFinancialData = {
  // Sample account balances for audit testing
  accountBalances: [
    {
      id: 1,
      account_name: 'Cash and Cash Equivalents',
      account_code: '1000',
      balance: 125000.50,
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401',
      period: '2024-01'
    },
    {
      id: 2,
      account_name: 'Accounts Receivable',
      account_code: '1200',
      balance: 75000.25,
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401',
      period: '2024-01'
    },
    {
      id: 3,
      account_name: 'Inventory',
      account_code: '1300',
      balance: 200000.00,
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401',
      period: '2024-01'
    }
  ],

  // Journal entries for testing
  journalEntries: [
    {
      id: 1,
      journal_date: '2024-01-15',
      reference: 'JE-001',
      description: 'Monthly depreciation',
      debit_account: '6500',
      credit_account: '1500',
      amount: 5000.00,
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    },
    {
      id: 2,
      journal_date: '2024-01-16',
      reference: 'JE-002',
      description: 'Accrued expenses',
      debit_account: '6000',
      credit_account: '2100',
      amount: 3500.00,
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    }
  ],

  // Vendor payments for lending analysis
  vendorPayments: [
    {
      id: 1,
      payment_date: '2024-01-10',
      vendor_name: 'Acme Supplies',
      amount: 15000.00,
      payment_method: 'ACH',
      reference: 'PAY-001',
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    },
    {
      id: 2,
      payment_date: '2024-01-12',
      vendor_name: 'Office Depot',
      amount: 2500.50,
      payment_method: 'Check',
      reference: 'PAY-002',
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    }
  ],

  // Financial ratios for lending mode
  financialRatios: [
    {
      id: 1,
      ratio_name: 'Current Ratio',
      value: 2.35,
      calculation: 'Current Assets / Current Liabilities',
      period: '2024-01',
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    },
    {
      id: 2,
      ratio_name: 'Debt-to-Equity',
      value: 0.65,
      calculation: 'Total Debt / Total Equity',
      period: '2024-01',
      client_id: 'test-client-123',
      upload_id: 'upload_test_202401'
    }
  ]
};

export const mockLendingPortfolio = {
  // Multiple companies for portfolio analysis
  companies: [
    {
      upload_id: 'upload_company_a_202401',
      client_id: 'lending-client-456',
      company_name: 'TechCorp Inc',
      period: '2024-01',
      total_assets: 5000000,
      total_revenue: 2500000,
      net_income: 350000,
      debt_amount: 1200000,
      credit_score: 720,
      risk_rating: 'Medium'
    },
    {
      upload_id: 'upload_company_b_202401',
      client_id: 'lending-client-456',
      company_name: 'Manufacturing LLC',
      period: '2024-01',
      total_assets: 8000000,
      total_revenue: 4200000,
      net_income: 580000,
      debt_amount: 2100000,
      credit_score: 680,
      risk_rating: 'Medium-High'
    },
    {
      upload_id: 'upload_company_c_202401',
      client_id: 'lending-client-456',
      company_name: 'Retail Solutions',
      period: '2024-01',
      total_assets: 3200000,
      total_revenue: 1800000,
      net_income: 125000,
      debt_amount: 850000,
      credit_score: 750,
      risk_rating: 'Low-Medium'
    }
  ],

  // Cash flow analysis data
  cashFlowData: [
    {
      id: 1,
      upload_id: 'upload_company_a_202401',
      month: '2024-01',
      operating_cash_flow: 180000,
      investing_cash_flow: -75000,
      financing_cash_flow: -25000,
      net_cash_flow: 80000,
      client_id: 'lending-client-456'
    }
  ]
};

export const securityTestData = {
  // SQL injection attempts
  sqlInjectionPayloads: [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "' UNION SELECT * FROM sensitive_data --",
    "'; UPDATE accounts SET balance = 0; --",
    "' OR 1=1 --",
    "admin'--",
    "' OR 'x'='x",
    "); INSERT INTO logs (message) VALUES ('hacked'); --"
  ],

  // Cross-client data access attempts
  crossClientQueries: [
    "SELECT * FROM upload_other_client_202401",
    "SELECT client_id, balance FROM upload_all_clients",
    "SELECT * FROM client_sensitive_data WHERE client_id != 'current-client'"
  ],

  // Potentially dangerous operations
  dangerousOperations: [
    "DROP TABLE upload_test_202401",
    "DELETE FROM users",
    "UPDATE accounts SET balance = 999999",
    "ALTER TABLE users ADD COLUMN backdoor VARCHAR(255)",
    "TRUNCATE TABLE audit_logs"
  ]
};

export const performanceTestData = {
  // Large dataset simulation
  largeQuery: `
    SELECT 
      account_name,
      SUM(amount) as total_amount,
      COUNT(*) as transaction_count,
      AVG(amount) as avg_amount,
      MAX(transaction_date) as last_transaction
    FROM upload_test_202401
    WHERE client_id = 'test-client-123'
      AND transaction_date >= '2023-01-01'
      AND amount > 0
    GROUP BY account_name
    HAVING COUNT(*) > 100
    ORDER BY total_amount DESC
  `,

  // Inefficient query patterns
  inefficientQueries: [
    "SELECT * FROM upload_test_202401 WHERE description LIKE '%pattern%'", // Leading wildcard
    "SELECT * FROM upload_test_202401 ORDER BY NEWID()", // Non-deterministic ordering
    "SELECT DISTINCT * FROM upload_test_202401 t1, upload_test_202401 t2", // Cartesian join
    "SELECT * FROM upload_test_202401 WHERE UPPER(account_name) = 'CASH'" // Function on column
  ],

  // Expected performance metrics
  performanceThresholds: {
    maxQueryTimeMs: 3000,
    maxRowsPerQuery: 10000,
    maxMemoryUsageMB: 256,
    maxConcurrentQueries: 10
  }
};

export const workflowTestData = {
  // Complete audit workflow scenario
  auditWorkflow: {
    sessionContext: {
      sessionId: 'audit-session-001',
      clientId: 'audit-client-123',
      mode: 'audit' as const,
      currentUploadId: 'upload_test_202401',
      availableUploadIds: ['upload_test_202401'],
      companyContext: {
        name: 'Test Company Ltd',
        uploadId: 'upload_test_202401',
        period: '2024-01'
      }
    },
    querySequence: [
      {
        step: 1,
        query: "Show me the account balances",
        expectedTemplate: "accountBalance",
        expectedRows: 50
      },
      {
        step: 2,
        query: "Find unusual journal entries from last month",
        expectedTemplate: "unusualPatterns",
        expectedRows: 5
      },
      {
        step: 3,
        query: "Analyze weekend transactions",
        expectedTemplate: "weekendTransactions",
        expectedRows: 12
      }
    ]
  },

  // Complete lending workflow scenario
  lendingWorkflow: {
    sessionContext: {
      sessionId: 'lending-session-002',
      clientId: 'lending-client-456',
      mode: 'lending' as const,
      currentUploadId: undefined,
      availableUploadIds: ['upload_company_a_202401', 'upload_company_b_202401', 'upload_company_c_202401'],
      portfolioContext: {
        totalCompanies: 3,
        activeUploadIds: ['upload_company_a_202401', 'upload_company_b_202401', 'upload_company_c_202401']
      }
    },
    querySequence: [
      {
        step: 1,
        query: "Show portfolio financial ratios",
        expectedTemplate: "financialRatios",
        expectedRows: 15
      },
      {
        step: 2,
        query: "Analyze debt capacity across companies",
        expectedTemplate: "debtCapacity",
        expectedRows: 3
      },
      {
        step: 3,
        query: "Generate risk scoring report",
        expectedTemplate: "riskScoring",
        expectedRows: 3
      }
    ]
  }
};

export const errorScenarios = {
  // Database connection failures
  dbConnectionError: new Error('Database connection failed'),
  dbTimeoutError: new Error('Query timeout after 30 seconds'),
  
  // Authentication/Authorization errors
  unauthorizedAccess: new Error('Unauthorized access to client data'),
  invalidToken: new Error('Invalid or expired JWT token'),
  
  // Business logic errors
  invalidUploadId: new Error('Upload ID does not exist or is inactive'),
  crossClientViolation: new Error('Attempt to access data from different client'),
  
  // API errors
  anthropicApiError: new Error('Anthropic API rate limit exceeded'),
  anthropicTimeoutError: new Error('Anthropic API request timeout'),
  
  // Validation errors
  invalidQueryError: new Error('Query contains prohibited operations'),
  complexityLimitError: new Error('Query exceeds complexity limits')
};

// Export helper functions
export function getRandomFinancialRecord() {
  const records = mockFinancialData.accountBalances;
  return records[Math.floor(Math.random() * records.length)];
}

export function generateLargeDataset(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    id: index + 1,
    account_name: `Account ${index + 1}`,
    balance: Math.random() * 100000,
    client_id: 'test-client-123',
    upload_id: 'upload_test_202401'
  }));
}