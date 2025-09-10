export interface BusinessRule {
  name: string;
  description: string;
  category: 'financial-ratio' | 'aging' | 'audit' | 'performance' | 'validation';
  formula?: string;
  sqlExample?: string;
  tables: string[];
  conditions?: string[];
  thresholds?: Record<string, any>;
}

/**
 * Get all business rules and calculations
 */
export function getBusinessRules(): BusinessRule[] {
  return [
    // Financial Ratios
    {
      name: 'Current Ratio',
      description: 'Measure of liquidity - current assets divided by current liabilities',
      category: 'financial-ratio',
      formula: 'Current Assets / Current Liabilities',
      sqlExample: `
        SELECT
          company_id,
          SUM(CASE WHEN account_type = 'Current Asset' THEN balance ELSE 0 END) /
          NULLIF(SUM(CASE WHEN account_type = 'Current Liability' THEN balance ELSE 0 END), 0) as current_ratio
        FROM trialBalance
        WHERE uploadId = @uploadId
        GROUP BY company_id
      `,
      tables: ['trialBalance'],
      thresholds: {
        healthy: '>= 1.5',
        warning: '1.0 - 1.5',
        critical: '< 1.0'
      }
    },
    {
      name: 'Quick Ratio (Acid Test)',
      description: 'More conservative liquidity measure excluding inventory',
      category: 'financial-ratio',
      formula: '(Current Assets - Inventory) / Current Liabilities',
      sqlExample: `
        SELECT
          company_id,
          (SUM(CASE WHEN account_type = 'Current Asset' AND account_code NOT LIKE 'INV%' THEN balance ELSE 0 END)) /
          NULLIF(SUM(CASE WHEN account_type = 'Current Liability' THEN balance ELSE 0 END), 0) as quick_ratio
        FROM trialBalance
        WHERE uploadId = @uploadId
        GROUP BY company_id
      `,
      tables: ['trialBalance'],
      thresholds: {
        healthy: '>= 1.0',
        warning: '0.75 - 1.0',
        critical: '< 0.75'
      }
    },
    {
      name: 'Days Sales Outstanding (DSO)',
      description: 'Average number of days to collect payment after a sale',
      category: 'financial-ratio',
      formula: '(Accounts Receivable / Total Credit Sales) × Number of Days',
      sqlExample: `
        WITH ARBalance AS (
          SELECT SUM(outstanding_amount) as total_ar
          FROM saleHeader
          WHERE uploadId = @uploadId AND status = 'Open'
        ),
        SalesTotal AS (
          SELECT SUM(gross_amount) as total_sales
          FROM saleHeader
          WHERE uploadId = @uploadId
            AND date >= DATEADD(day, -365, GETDATE())
        )
        SELECT (ar.total_ar / NULLIF(s.total_sales, 0)) * 365 as dso
        FROM ARBalance ar, SalesTotal s
      `,
      tables: ['saleHeader'],
      thresholds: {
        excellent: '< 30 days',
        good: '30-45 days',
        warning: '45-60 days',
        critical: '> 60 days'
      }
    },
    {
      name: 'Days Payable Outstanding (DPO)',
      description: 'Average number of days to pay suppliers',
      category: 'financial-ratio',
      formula: '(Accounts Payable / Total Purchases) × Number of Days',
      sqlExample: `
        WITH APBalance AS (
          SELECT SUM(outstanding_amount) as total_ap
          FROM purchaseHeader
          WHERE uploadId = @uploadId AND status = 'Open'
        ),
        PurchaseTotal AS (
          SELECT SUM(gross_amount) as total_purchases
          FROM purchaseHeader
          WHERE uploadId = @uploadId
            AND date >= DATEADD(day, -365, GETDATE())
        )
        SELECT (ap.total_ap / NULLIF(p.total_purchases, 0)) * 365 as dpo
        FROM APBalance ap, PurchaseTotal p
      `,
      tables: ['purchaseHeader'],
      thresholds: {
        optimal: '30-45 days',
        early: '< 30 days',
        late: '> 45 days'
      }
    },
    {
      name: 'Working Capital',
      description: 'Difference between current assets and current liabilities',
      category: 'financial-ratio',
      formula: 'Current Assets - Current Liabilities',
      sqlExample: `
        SELECT
          company_id,
          SUM(CASE WHEN account_type = 'Current Asset' THEN balance ELSE 0 END) -
          SUM(CASE WHEN account_type = 'Current Liability' THEN balance ELSE 0 END) as working_capital
        FROM trialBalance
        WHERE uploadId = @uploadId
        GROUP BY company_id
      `,
      tables: ['trialBalance'],
      conditions: ['Positive working capital indicates ability to meet short-term obligations']
    },
    {
      name: 'Inventory Turnover',
      description: 'How many times inventory is sold and replaced over a period',
      category: 'financial-ratio',
      formula: 'Cost of Goods Sold / Average Inventory',
      sqlExample: `
        WITH COGS AS (
          SELECT SUM(amount) as total_cogs
          FROM transactionLine
          WHERE uploadId = @uploadId
            AND account_code LIKE 'COGS%'
        ),
        AvgInventory AS (
          SELECT AVG(balance) as avg_inventory
          FROM trialBalance
          WHERE uploadId = @uploadId
            AND account_code LIKE 'INV%'
        )
        SELECT c.total_cogs / NULLIF(i.avg_inventory, 0) as inventory_turnover
        FROM COGS c, AvgInventory i
      `,
      tables: ['transactionLine', 'trialBalance'],
      thresholds: {
        high: '> 12 (monthly turnover)',
        moderate: '6-12',
        low: '< 6'
      }
    },

    // Aging Analysis Rules
    {
      name: 'AR Aging Buckets',
      description: 'Categorize receivables by age',
      category: 'aging',
      sqlExample: `
        SELECT
          CASE
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 0 THEN 'Current'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 30 THEN '1-30 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 60 THEN '31-60 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 90 THEN '61-90 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 120 THEN '91-120 days'
            ELSE '120+ days'
          END as age_bucket,
          COUNT(*) as invoice_count,
          SUM(outstanding_amount) as total_outstanding
        FROM saleHeader
        WHERE uploadId = @uploadId AND status = 'Open'
        GROUP BY age_bucket
      `,
      tables: ['saleHeader', 'saleAged'],
      conditions: [
        'Current: Not yet due',
        '1-30 days: Recently overdue',
        '31-60 days: Significantly overdue',
        '61-90 days: Seriously overdue',
        '91-120 days: Critical',
        '120+ days: May require write-off consideration'
      ]
    },
    {
      name: 'AP Aging Buckets',
      description: 'Categorize payables by age',
      category: 'aging',
      sqlExample: `
        SELECT
          CASE
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 0 THEN 'Current'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 30 THEN '1-30 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 60 THEN '31-60 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 90 THEN '61-90 days'
            WHEN DATEDIFF(day, due_date, GETDATE()) <= 120 THEN '91-120 days'
            ELSE '120+ days'
          END as age_bucket,
          COUNT(*) as invoice_count,
          SUM(outstanding_amount) as total_outstanding
        FROM purchaseHeader
        WHERE uploadId = @uploadId AND status = 'Open'
        GROUP BY age_bucket
      `,
      tables: ['purchaseHeader', 'purchaseAged']
    },

    // Audit Rules
    {
      name: 'Weekend/After-Hours Entries',
      description: 'Identify journal entries made outside business hours',
      category: 'audit',
      sqlExample: `
        SELECT *
        FROM transactionHeader
        WHERE uploadId = @uploadId
          AND (
            DATEPART(WEEKDAY, created_date) IN (1, 7) -- Sunday, Saturday
            OR DATEPART(HOUR, created_date) NOT BETWEEN 8 AND 18
          )
      `,
      tables: ['transactionHeader'],
      conditions: [
        'Weekend entries may indicate manual adjustments',
        'After-hours entries (before 8am or after 6pm) require review',
        'Holiday entries should be investigated'
      ]
    },
    {
      name: 'Round Amount Transactions',
      description: 'Identify suspiciously round amounts that may indicate estimates or fraud',
      category: 'audit',
      sqlExample: `
        SELECT *
        FROM transactionLine
        WHERE uploadId = @uploadId
          AND amount >= 1000
          AND amount % 1000 = 0
          AND entry_type = 'Manual'
      `,
      tables: ['transactionLine'],
      conditions: [
        'Amounts ending in 000',
        'Manual entries only',
        'Amount > 1000 for materiality'
      ]
    },
    {
      name: 'Duplicate Payments',
      description: 'Identify potential duplicate payments to suppliers',
      category: 'audit',
      sqlExample: `
        SELECT
          supplier_id,
          amount,
          reference,
          COUNT(*) as occurrence_count
        FROM purchaseHeader
        WHERE uploadId = @uploadId
        GROUP BY supplier_id, amount, reference
        HAVING COUNT(*) > 1
      `,
      tables: ['purchaseHeader'],
      conditions: [
        'Same supplier',
        'Same amount',
        'Same or similar reference'
      ]
    },
    {
      name: 'Revenue Cutoff',
      description: 'Identify sales transactions near period end for cutoff testing',
      category: 'audit',
      sqlExample: `
        SELECT *
        FROM saleHeader
        WHERE uploadId = @uploadId
          AND ABS(DATEDIFF(day, date, period_end_date)) <= 5
        ORDER BY date DESC
      `,
      tables: ['saleHeader'],
      conditions: [
        'Transactions within 5 days of period end',
        'Review for proper period allocation',
        'Check shipping/delivery dates'
      ]
    },
    {
      name: 'Related Party Transactions',
      description: 'Identify transactions with related parties requiring disclosure',
      category: 'audit',
      sqlExample: `
        SELECT *
        FROM transactionHeader th
        INNER JOIN transactionLine tl ON th.transaction_id = tl.transaction_id
        WHERE th.uploadId = @uploadId
          AND (
            tl.account_code LIKE 'DLA%' -- Director Loan Accounts
            OR th.description LIKE '%director%'
            OR th.description LIKE '%shareholder%'
            OR th.description LIKE '%related%'
          )
      `,
      tables: ['transactionHeader', 'transactionLine'],
      conditions: [
        'Director loan accounts',
        'Shareholder transactions',
        'Inter-company transactions'
      ]
    },

    // Performance Rules
    {
      name: 'Use Clustered Index',
      description: 'Always filter by uploadId first for optimal performance',
      category: 'performance',
      sqlExample: `
        -- GOOD: Uses clustered index
        SELECT * FROM transactionHeader
        WHERE uploadId = @uploadId
          AND date >= '2024-01-01'

        -- BAD: Doesn't use clustered index efficiently
        SELECT * FROM transactionHeader
        WHERE date >= '2024-01-01'
          AND uploadId = @uploadId
      `,
      tables: ['all transaction tables'],
      conditions: [
        'uploadId should be the first condition in WHERE clause',
        'Clustered index on uploadId provides best performance',
        'Reduces I/O operations significantly'
      ]
    },
    {
      name: 'Portfolio Query Optimization',
      description: 'Limit portfolio queries to recent uploads for performance',
      category: 'performance',
      sqlExample: `
        SELECT company_id, metrics
        FROM upload u
        INNER JOIN transactionHeader th ON u.upload_id = th.uploadId
        WHERE u.client_id = @clientId
          AND u.upload_date >= DATEADD(month, -3, GETDATE())
      `,
      tables: ['upload'],
      conditions: [
        'Limit to last 3 months of uploads',
        'Use client_id for multi-tenant filtering',
        'Apply TOP or OFFSET-FETCH for large results'
      ]
    },

    // Validation Rules
    {
      name: 'Trial Balance Validation',
      description: 'Ensure trial balance debits equal credits',
      category: 'validation',
      sqlExample: `
        SELECT
          SUM(CASE WHEN balance_type = 'Debit' THEN balance ELSE 0 END) as total_debits,
          SUM(CASE WHEN balance_type = 'Credit' THEN balance ELSE 0 END) as total_credits,
          SUM(CASE WHEN balance_type = 'Debit' THEN balance ELSE -balance END) as net_balance
        FROM trialBalance
        WHERE uploadId = @uploadId
        HAVING ABS(net_balance) > 0.01 -- Allow for rounding differences
      `,
      tables: ['trialBalance'],
      conditions: [
        'Total debits must equal total credits',
        'Net balance should be zero (within rounding tolerance)',
        'Each period should balance independently'
      ]
    },
    {
      name: 'Customer Concentration Risk',
      description: 'Identify revenue concentration in top customers',
      category: 'validation',
      sqlExample: `
        WITH CustomerSales AS (
          SELECT
            customer_id,
            SUM(gross_amount) as customer_total,
            SUM(SUM(gross_amount)) OVER () as grand_total
          FROM saleHeader
          WHERE uploadId = @uploadId
          GROUP BY customer_id
        )
        SELECT
          customer_id,
          customer_total,
          (customer_total / grand_total) * 100 as percentage_of_total
        FROM CustomerSales
        WHERE (customer_total / grand_total) > 0.1 -- Customers > 10% of revenue
        ORDER BY customer_total DESC
      `,
      tables: ['saleHeader'],
      thresholds: {
        high_risk: '> 25% from single customer',
        moderate_risk: '> 10% from single customer',
        diversified: '< 10% from any single customer'
      }
    },
    {
      name: 'Cash Burn Rate',
      description: 'Calculate monthly cash consumption rate',
      category: 'financial-ratio',
      formula: '(Starting Cash - Ending Cash) / Number of Months',
      sqlExample: `
        WITH CashBalances AS (
          SELECT
            period_id,
            SUM(balance) as cash_balance
          FROM trialBalance
          WHERE uploadId = @uploadId
            AND account_code LIKE 'CASH%'
          GROUP BY period_id
        )
        SELECT
          AVG(cash_balance) as avg_cash_balance,
          MIN(cash_balance) as min_cash_balance,
          MAX(cash_balance) as max_cash_balance,
          (MAX(cash_balance) - MIN(cash_balance)) / COUNT(DISTINCT period_id) as monthly_burn_rate
        FROM CashBalances
      `,
      tables: ['trialBalance'],
      conditions: [
        'Negative burn rate indicates cash consumption',
        'Compare to revenue for sustainability analysis',
        'Calculate months of runway: current_cash / burn_rate'
      ]
    }
  ];
}

/**
 * Get business rules by category
 */
export function getBusinessRulesByCategory(category: BusinessRule['category']): BusinessRule[] {
  return getBusinessRules().filter(rule => rule.category === category);
}

/**
 * Get business rules for specific tables
 */
export function getBusinessRulesForTables(tableNames: string[]): BusinessRule[] {
  return getBusinessRules().filter(rule =>
    rule.tables.some(table =>
      tableNames.some(name => name.toLowerCase().includes(table.toLowerCase()))
    )
  );
}

/**
 * Get financial ratio calculations
 */
export function getFinancialRatios(): BusinessRule[] {
  return getBusinessRulesByCategory('financial-ratio');
}

/**
 * Get audit rules and checks
 */
export function getAuditRules(): BusinessRule[] {
  return getBusinessRulesByCategory('audit');
}

export default {
  getBusinessRules,
  getBusinessRulesByCategory,
  getBusinessRulesForTables,
  getFinancialRatios,
  getAuditRules
};
