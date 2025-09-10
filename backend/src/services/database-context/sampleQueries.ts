export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: 'lending' | 'audit';
  naturalLanguageExample: string;
  sqlTemplate: string;
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'date' | 'boolean';
    description: string;
    defaultValue?: any;
  }>;
  involvedTables: string[];
  expectedColumns: string[];
  performanceNotes?: string[];
}

/**
 * Get all sample query templates
 */
export function getSampleQueries(): {
  lending: QueryTemplate[];
  audit: QueryTemplate[];
} {
  return {
    lending: getLendingTemplates(),
    audit: getAuditTemplates()
  };
}

/**
 * Get lending-specific query templates (portfolio-level)
 */
function getLendingTemplates(): QueryTemplate[] {
  return [
    {
      id: 'lending-top-ar-opportunities',
      name: 'Top 20 Asset-Based Finance Opportunities',
      description: 'Identify companies with strong AR balances suitable for factoring or ABL',
      category: 'lending',
      naturalLanguageExample: 'Show me the top 20 asset-based finance opportunities across the portfolio',
      sqlTemplate: `
        WITH LatestUploads AS (
          SELECT
            sme_id,
            company_name,
            MAX(upload_id) as latest_upload_id
          FROM upload
          WHERE client_id = @clientId
            AND upload_date >= DATEADD(month, -3, GETDATE())
          GROUP BY sme_id, company_name
        ),
        ARMetrics AS (
          SELECT
            u.sme_id,
            u.company_name,
            SUM(sh.outstanding_amount) as ar_balance,
            COUNT(DISTINCT sh.customer_id) as customer_count,
            AVG(DATEDIFF(day, sh.invoice_date, GETDATE())) as avg_days_outstanding,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) > 60 THEN sh.outstanding_amount ELSE 0 END) as overdue_60_plus
          FROM LatestUploads u
          INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
          WHERE sh.status = 'Open'
          GROUP BY u.sme_id, u.company_name
        ),
        RevenueMetrics AS (
          SELECT
            u.sme_id,
            SUM(sl.net_amount) as total_revenue_12m
          FROM LatestUploads u
          INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
          INNER JOIN saleLine sl ON sl.sale_id = sh.sale_id
          WHERE sh.invoice_date >= DATEADD(month, -12, GETDATE())
          GROUP BY u.sme_id
        )
        SELECT TOP 20
          arm.company_name,
          arm.ar_balance,
          rm.total_revenue_12m as annual_revenue,
          (arm.ar_balance / NULLIF(rm.total_revenue_12m, 0)) * 100 as ar_to_revenue_ratio,
          arm.avg_days_outstanding,
          arm.customer_count,
          CASE
            WHEN arm.avg_days_outstanding < 30 THEN 'Excellent'
            WHEN arm.avg_days_outstanding < 45 THEN 'Good'
            WHEN arm.avg_days_outstanding < 60 THEN 'Fair'
            ELSE 'Poor'
          END as ar_quality_score,
          (arm.overdue_60_plus / NULLIF(arm.ar_balance, 0)) * 100 as overdue_percentage
        FROM ARMetrics arm
        LEFT JOIN RevenueMetrics rm ON arm.sme_id = rm.sme_id
        WHERE arm.ar_balance > 100000  -- £100k minimum
          AND (arm.ar_balance / NULLIF(rm.total_revenue_12m, 0)) > 0.15  -- AR/Revenue > 15%
          AND arm.avg_days_outstanding < 60  -- Average aging < 60 days
        ORDER BY arm.ar_balance DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        }
      ],
      involvedTables: ['upload', 'saleHeader', 'saleLine'],
      expectedColumns: ['company_name', 'ar_balance', 'annual_revenue', 'ar_to_revenue_ratio', 'ar_quality_score'],
      performanceNotes: [
        'Uses latest upload per company from last 3 months',
        'Filters by uploadId (clustered index) for optimal performance',
        'Pre-aggregates metrics in CTEs before final JOIN'
      ]
    },
    {
      id: 'lending-ar-aging-quality',
      name: 'Assess Accounts Receivable Quality and Aging',
      description: 'Analyze AR aging patterns across the portfolio',
      category: 'lending',
      naturalLanguageExample: 'Assess the accounts receivable quality and aging across my portfolio',
      sqlTemplate: `
        WITH LatestUploads AS (
          SELECT
            sme_id,
            company_name,
            MAX(upload_id) as latest_upload_id
          FROM upload
          WHERE client_id = @clientId
            AND upload_date >= DATEADD(month, -3, GETDATE())
          GROUP BY sme_id, company_name
        ),
        AgingAnalysis AS (
          SELECT
            u.company_name,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) <= 0 THEN sh.outstanding_amount ELSE 0 END) as current_balance,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) BETWEEN 1 AND 30 THEN sh.outstanding_amount ELSE 0 END) as days_1_30,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) BETWEEN 31 AND 60 THEN sh.outstanding_amount ELSE 0 END) as days_31_60,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) BETWEEN 61 AND 90 THEN sh.outstanding_amount ELSE 0 END) as days_61_90,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) BETWEEN 91 AND 120 THEN sh.outstanding_amount ELSE 0 END) as days_91_120,
            SUM(CASE WHEN DATEDIFF(day, sh.due_date, GETDATE()) > 120 THEN sh.outstanding_amount ELSE 0 END) as days_over_120,
            SUM(sh.outstanding_amount) as total_ar,
            COUNT(DISTINCT sh.customer_id) as customer_count,
            MAX(sh.outstanding_amount) as largest_invoice
          FROM LatestUploads u
          INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
          WHERE sh.status = 'Open'
          GROUP BY u.company_name
        )
        SELECT
          company_name,
          total_ar,
          current_balance,
          days_1_30,
          days_31_60,
          days_61_90,
          days_91_120,
          days_over_120,
          (current_balance / NULLIF(total_ar, 0)) * 100 as current_percentage,
          ((days_91_120 + days_over_120) / NULLIF(total_ar, 0)) * 100 as critical_aging_percentage,
          customer_count,
          largest_invoice,
          (largest_invoice / NULLIF(total_ar, 0)) * 100 as concentration_risk_percentage
        FROM AgingAnalysis
        WHERE total_ar > 0
        ORDER BY total_ar DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        }
      ],
      involvedTables: ['upload', 'saleHeader'],
      expectedColumns: ['company_name', 'total_ar', 'current_balance', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_120', 'days_over_120'],
      performanceNotes: [
        'Aggregates aging buckets in single scan',
        'Uses CASE expressions for efficient bucketing'
      ]
    },
    {
      id: 'lending-cash-analysis',
      name: 'Analyze Cash Position Relative to Operational Needs',
      description: 'Evaluate cash runway and burn rate across portfolio',
      category: 'lending',
      naturalLanguageExample: 'Analyze the cash position relative to operational needs for my portfolio companies',
      sqlTemplate: `
        WITH LatestUploads AS (
          SELECT
            sme_id,
            company_name,
            MAX(upload_id) as latest_upload_id
          FROM upload
          WHERE client_id = @clientId
            AND upload_date >= DATEADD(month, -3, GETDATE())
          GROUP BY sme_id, company_name
        ),
        CashMetrics AS (
          SELECT
            u.company_name,
            SUM(CASE WHEN tb.account_code LIKE 'CASH%' OR tb.account_code LIKE 'BANK%' THEN tb.balance ELSE 0 END) as cash_balance,
            SUM(CASE WHEN tb.account_type = 'Current Liability' THEN tb.balance ELSE 0 END) as current_liabilities
          FROM LatestUploads u
          INNER JOIN trialBalance tb ON tb.uploadId = u.latest_upload_id
          GROUP BY u.company_name
        ),
        MonthlyExpenses AS (
          SELECT
            u.company_name,
            AVG(ABS(tl.amount)) as avg_monthly_expenses
          FROM LatestUploads u
          INNER JOIN transactionHeader th ON th.uploadId = u.latest_upload_id
          INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
          WHERE th.transaction_date >= DATEADD(month, -3, GETDATE())
            AND tl.account_type IN ('Expense', 'Cost of Sales')
          GROUP BY u.company_name
        )
        SELECT
          cm.company_name,
          cm.cash_balance,
          me.avg_monthly_expenses as monthly_burn_rate,
          CASE
            WHEN me.avg_monthly_expenses > 0 THEN cm.cash_balance / me.avg_monthly_expenses
            ELSE NULL
          END as months_of_runway,
          cm.current_liabilities,
          cm.cash_balance - cm.current_liabilities as net_cash_position,
          CASE
            WHEN cm.cash_balance / NULLIF(me.avg_monthly_expenses, 0) < 1 THEN 'Critical'
            WHEN cm.cash_balance / NULLIF(me.avg_monthly_expenses, 0) < 3 THEN 'Warning'
            WHEN cm.cash_balance / NULLIF(me.avg_monthly_expenses, 0) < 6 THEN 'Moderate'
            ELSE 'Healthy'
          END as cash_health_status
        FROM CashMetrics cm
        LEFT JOIN MonthlyExpenses me ON cm.company_name = me.company_name
        ORDER BY months_of_runway ASC NULLS FIRST
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        }
      ],
      involvedTables: ['upload', 'trialBalance', 'transactionHeader', 'transactionLine'],
      expectedColumns: ['company_name', 'cash_balance', 'monthly_burn_rate', 'months_of_runway', 'cash_health_status']
    },
    {
      id: 'lending-working-capital-strain',
      name: 'Identify Companies with Working Capital Strain',
      description: 'Find companies experiencing working capital pressure',
      category: 'lending',
      naturalLanguageExample: 'Which companies in my portfolio have working capital strain?',
      sqlTemplate: `
        WITH LatestUploads AS (
          SELECT
            sme_id,
            company_name,
            MAX(upload_id) as latest_upload_id
          FROM upload
          WHERE client_id = @clientId
            AND upload_date >= DATEADD(month, -3, GETDATE())
          GROUP BY sme_id, company_name
        ),
        WorkingCapitalMetrics AS (
          SELECT
            u.company_name,
            SUM(CASE WHEN tb.account_type = 'Current Asset' THEN tb.balance ELSE 0 END) as current_assets,
            SUM(CASE WHEN tb.account_type = 'Current Liability' THEN tb.balance ELSE 0 END) as current_liabilities,
            SUM(CASE WHEN tb.account_code LIKE 'AR%' THEN tb.balance ELSE 0 END) as accounts_receivable,
            SUM(CASE WHEN tb.account_code LIKE 'AP%' THEN tb.balance ELSE 0 END) as accounts_payable,
            SUM(CASE WHEN tb.account_code LIKE 'INV%' THEN tb.balance ELSE 0 END) as inventory
          FROM LatestUploads u
          INNER JOIN trialBalance tb ON tb.uploadId = u.latest_upload_id
          GROUP BY u.company_name
        ),
        CashConversion AS (
          SELECT
            u.company_name,
            AVG(DATEDIFF(day, sh.invoice_date, sh.payment_date)) as dso,
            AVG(DATEDIFF(day, ph.invoice_date, ph.payment_date)) as dpo
          FROM LatestUploads u
          LEFT JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id AND sh.status = 'Paid'
          LEFT JOIN purchaseHeader ph ON ph.uploadId = u.latest_upload_id AND ph.status = 'Paid'
          GROUP BY u.company_name
        )
        SELECT
          wcm.company_name,
          wcm.current_assets - wcm.current_liabilities as working_capital,
          wcm.current_assets / NULLIF(wcm.current_liabilities, 0) as current_ratio,
          (wcm.current_assets - wcm.inventory) / NULLIF(wcm.current_liabilities, 0) as quick_ratio,
          cc.dso as days_sales_outstanding,
          cc.dpo as days_payable_outstanding,
          cc.dso - cc.dpo as cash_conversion_cycle,
          CASE
            WHEN wcm.current_assets / NULLIF(wcm.current_liabilities, 0) < 1.0 THEN 'Critical'
            WHEN wcm.current_assets / NULLIF(wcm.current_liabilities, 0) < 1.2 THEN 'Strained'
            WHEN cc.dso > 60 AND cc.dpo < 30 THEN 'Cash Flow Pressure'
            ELSE 'Stable'
          END as working_capital_status
        FROM WorkingCapitalMetrics wcm
        LEFT JOIN CashConversion cc ON wcm.company_name = cc.company_name
        WHERE wcm.current_assets / NULLIF(wcm.current_liabilities, 0) < 1.2  -- Current ratio < 1.2
           OR cc.dso > 60  -- DSO > 60 days
           OR cc.dpo < 30  -- DPO < 30 days
        ORDER BY wcm.current_assets / NULLIF(wcm.current_liabilities, 0) ASC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        }
      ],
      involvedTables: ['upload', 'trialBalance', 'saleHeader', 'purchaseHeader'],
      expectedColumns: ['company_name', 'working_capital', 'current_ratio', 'quick_ratio', 'working_capital_status']
    },
    {
      id: 'lending-revenue-growth',
      name: 'Revenue Growth Opportunities',
      description: 'Identify high-growth companies in the portfolio',
      category: 'lending',
      naturalLanguageExample: 'Show me companies with strong revenue growth in my portfolio',
      sqlTemplate: `
        WITH LatestUploads AS (
          SELECT
            sme_id,
            company_name,
            MAX(upload_id) as latest_upload_id
          FROM upload
          WHERE client_id = @clientId
            AND upload_date >= DATEADD(month, -3, GETDATE())
          GROUP BY sme_id, company_name
        ),
        RevenueByPeriod AS (
          SELECT
            u.company_name,
            YEAR(sh.invoice_date) as year,
            MONTH(sh.invoice_date) as month,
            SUM(sh.gross_amount) as monthly_revenue
          FROM LatestUploads u
          INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
          WHERE sh.invoice_date >= DATEADD(month, -24, GETDATE())
          GROUP BY u.company_name, YEAR(sh.invoice_date), MONTH(sh.invoice_date)
        ),
        GrowthMetrics AS (
          SELECT
            company_name,
            SUM(CASE WHEN year = YEAR(GETDATE()) THEN monthly_revenue ELSE 0 END) as current_year_revenue,
            SUM(CASE WHEN year = YEAR(DATEADD(year, -1, GETDATE())) THEN monthly_revenue ELSE 0 END) as prior_year_revenue,
            AVG(monthly_revenue) as avg_monthly_revenue,
            STDEV(monthly_revenue) as revenue_volatility
          FROM RevenueByPeriod
          GROUP BY company_name
        )
        SELECT
          company_name,
          current_year_revenue,
          prior_year_revenue,
          ((current_year_revenue - prior_year_revenue) / NULLIF(prior_year_revenue, 0)) * 100 as yoy_growth_rate,
          avg_monthly_revenue,
          revenue_volatility / NULLIF(avg_monthly_revenue, 0) as coefficient_of_variation,
          CASE
            WHEN ((current_year_revenue - prior_year_revenue) / NULLIF(prior_year_revenue, 0)) > 0.20 THEN 'High Growth'
            WHEN ((current_year_revenue - prior_year_revenue) / NULLIF(prior_year_revenue, 0)) > 0.10 THEN 'Moderate Growth'
            WHEN ((current_year_revenue - prior_year_revenue) / NULLIF(prior_year_revenue, 0)) > 0 THEN 'Low Growth'
            ELSE 'Declining'
          END as growth_category
        FROM GrowthMetrics
        WHERE current_year_revenue > 0 OR prior_year_revenue > 0
        ORDER BY yoy_growth_rate DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        }
      ],
      involvedTables: ['upload', 'saleHeader'],
      expectedColumns: ['company_name', 'current_year_revenue', 'prior_year_revenue', 'yoy_growth_rate', 'growth_category']
    }
  ];
}

/**
 * Get audit-specific query templates (company-level)
 */
function getAuditTemplates(): QueryTemplate[] {
  return [
    {
      id: 'audit-variance-analysis',
      name: 'Identify Transactions with Significant Variance',
      description: 'Find transactions >10% up/down vs prior period for a specific company',
      category: 'audit',
      naturalLanguageExample: 'Identify transactions more than 10% up or down versus prior period for ABC Company',
      sqlTemplate: `
        WITH CurrentPeriod AS (
          SELECT
            th.transaction_id,
            th.transaction_date,
            th.description,
            tl.account_code,
            tl.account_name,
            tl.amount,
            tl.line_description
          FROM transactionHeader th
          INNER JOIN transactionLine tl ON th.transaction_id = tl.transaction_id
          WHERE th.uploadId = (
            SELECT TOP 1 upload_id
            FROM upload
            WHERE client_id = @clientId
              AND LOWER(company_name) = LOWER(@companyName)
            ORDER BY upload_date DESC
          )
          AND th.transaction_date >= DATEADD(month, -1, GETDATE())
        ),
        PriorPeriod AS (
          SELECT
            tl.account_code,
            AVG(tl.amount) as avg_amount,
            STDEV(tl.amount) as std_amount
          FROM transactionHeader th
          INNER JOIN transactionLine tl ON th.transaction_id = tl.transaction_id
          WHERE th.uploadId = (
            SELECT TOP 1 upload_id
            FROM upload
            WHERE client_id = @clientId
              AND LOWER(company_name) = LOWER(@companyName)
            ORDER BY upload_date DESC
          )
          AND th.transaction_date >= DATEADD(month, -13, GETDATE())
          AND th.transaction_date < DATEADD(month, -1, GETDATE())
          GROUP BY tl.account_code
        )
        SELECT
          cp.transaction_date,
          cp.account_code,
          cp.account_name,
          cp.description,
          cp.amount as current_amount,
          pp.avg_amount as prior_avg_amount,
          ((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) * 100 as variance_percentage,
          CASE
            WHEN ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.5 THEN 'Critical'
            WHEN ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.25 THEN 'High'
            WHEN ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.1 THEN 'Moderate'
            ELSE 'Low'
          END as variance_level,
          cp.line_description
        FROM CurrentPeriod cp
        INNER JOIN PriorPeriod pp ON cp.account_code = pp.account_code
        WHERE ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.1  -- >10% variance
          AND cp.amount > 1000  -- Materiality threshold
        ORDER BY ABS(variance_percentage) DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'transactionHeader', 'transactionLine'],
      expectedColumns: ['transaction_date', 'account_code', 'account_name', 'current_amount', 'prior_avg_amount', 'variance_percentage']
    },
    {
      id: 'audit-large-sales',
      name: 'Identify Large Sales Transactions',
      description: 'Find sales transactions >10% of total sales for a company',
      category: 'audit',
      naturalLanguageExample: 'Show me sales transactions greater than 10% of total sales for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1 upload_id, company_name
          FROM upload
          WHERE client_id = @clientId
            AND LOWER(company_name) = LOWER(@companyName)
          ORDER BY upload_date DESC
        ),
        TotalSales AS (
          SELECT
            SUM(sh.gross_amount) as total_sales_amount
          FROM CompanyUpload cu
          INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
        ),
        LargeSales AS (
          SELECT
            cu.company_name,
            sh.invoice_number,
            sh.invoice_date,
            sh.customer_name,
            sh.gross_amount,
            sh.net_amount,
            sh.tax_amount,
            sh.description,
            ts.total_sales_amount,
            (sh.gross_amount / ts.total_sales_amount) * 100 as percentage_of_total
          FROM CompanyUpload cu
          INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
          CROSS JOIN TotalSales ts
          WHERE sh.gross_amount > ts.total_sales_amount * 0.1  -- >10% of total
        )
        SELECT
          invoice_number,
          invoice_date,
          customer_name,
          gross_amount,
          percentage_of_total,
          description,
          CASE
            WHEN percentage_of_total > 25 THEN 'Very High Concentration'
            WHEN percentage_of_total > 15 THEN 'High Concentration'
            ELSE 'Moderate Concentration'
          END as risk_level
        FROM LargeSales
        ORDER BY gross_amount DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'saleHeader'],
      expectedColumns: ['invoice_number', 'invoice_date', 'customer_name', 'gross_amount', 'percentage_of_total', 'risk_level']
    },
    {
      id: 'audit-aged-receivables',
      name: 'Identify Old Outstanding Receivables',
      description: 'Find receivables >5% of sales outstanding >120 days',
      category: 'audit',
      naturalLanguageExample: 'Identify receivables greater than 5% of total sales outstanding more than 120 days for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1 upload_id, company_name
          FROM upload
          WHERE client_id = @clientId
            AND LOWER(company_name) = LOWER(@companyName)
          ORDER BY upload_date DESC
        ),
        TotalSales AS (
          SELECT
            SUM(sh.gross_amount) as total_sales_12m
          FROM CompanyUpload cu
          INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
          WHERE sh.invoice_date >= DATEADD(month, -12, GETDATE())
        ),
        AgedReceivables AS (
          SELECT
            cu.company_name,
            sh.invoice_number,
            sh.invoice_date,
            sh.due_date,
            sh.customer_name,
            sh.outstanding_amount,
            DATEDIFF(day, sh.due_date, GETDATE()) as days_overdue,
            ts.total_sales_12m,
            (sh.outstanding_amount / ts.total_sales_12m) * 100 as percentage_of_sales
          FROM CompanyUpload cu
          INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
          CROSS JOIN TotalSales ts
          WHERE sh.status = 'Open'
            AND DATEDIFF(day, sh.due_date, GETDATE()) > 120  -- >120 days overdue
            AND sh.outstanding_amount > ts.total_sales_12m * 0.05  -- >5% of total sales
        )
        SELECT
          invoice_number,
          invoice_date,
          due_date,
          customer_name,
          outstanding_amount,
          days_overdue,
          percentage_of_sales,
          CASE
            WHEN days_overdue > 365 THEN 'Write-off Candidate'
            WHEN days_overdue > 180 THEN 'Critical'
            ELSE 'Seriously Overdue'
          END as collection_status,
          outstanding_amount * 0.5 as potential_provision  -- 50% provision for >120 days
        FROM AgedReceivables
        ORDER BY outstanding_amount DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'saleHeader'],
      expectedColumns: ['invoice_number', 'customer_name', 'outstanding_amount', 'days_overdue', 'collection_status']
    },
    {
      id: 'audit-weekend-entries',
      name: 'Journal Entries Made After Hours/Weekends',
      description: 'Identify potentially suspicious journal entries made outside business hours',
      category: 'audit',
      naturalLanguageExample: 'Show me journal entries made after hours or on weekends for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1 upload_id, company_name
          FROM upload
          WHERE client_id = @clientId
            AND LOWER(company_name) = LOWER(@companyName)
          ORDER BY upload_date DESC
        )
        SELECT
          th.transaction_id,
          th.transaction_date,
          th.created_date,
          th.created_by,
          th.description,
          th.reference,
          DATENAME(WEEKDAY, th.created_date) as day_of_week,
          DATEPART(HOUR, th.created_date) as hour_created,
          SUM(ABS(tl.amount)) as total_amount,
          COUNT(tl.line_id) as line_count,
          STRING_AGG(DISTINCT tl.account_code, ', ') as affected_accounts,
          CASE
            WHEN DATEPART(WEEKDAY, th.created_date) IN (1, 7) THEN 'Weekend Entry'
            WHEN DATEPART(HOUR, th.created_date) < 8 THEN 'Early Morning Entry'
            WHEN DATEPART(HOUR, th.created_date) >= 18 THEN 'After Hours Entry'
            ELSE 'Business Hours'
          END as entry_timing,
          CASE
            WHEN th.entry_type = 'Manual' THEN 'Manual'
            WHEN th.entry_type = 'Adjustment' THEN 'Adjustment'
            ELSE 'System'
          END as entry_type
        FROM CompanyUpload cu
        INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
        INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
        WHERE (
            DATEPART(WEEKDAY, th.created_date) IN (1, 7)  -- Sunday, Saturday
            OR DATEPART(HOUR, th.created_date) NOT BETWEEN 8 AND 17  -- Outside 8am-6pm
          )
          AND th.entry_type IN ('Manual', 'Adjustment')  -- Focus on manual entries
        GROUP BY
          th.transaction_id,
          th.transaction_date,
          th.created_date,
          th.created_by,
          th.description,
          th.reference,
          th.entry_type
        ORDER BY th.created_date DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'transactionHeader', 'transactionLine'],
      expectedColumns: ['transaction_id', 'transaction_date', 'created_date', 'created_by', 'total_amount', 'entry_timing']
    },
    {
      id: 'audit-round-amounts',
      name: 'Round Amount Transactions',
      description: 'Identify suspiciously round amounts that may indicate estimates',
      category: 'audit',
      naturalLanguageExample: 'Find round amount transactions for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1 upload_id, company_name
          FROM upload
          WHERE client_id = @clientId
            AND LOWER(company_name) = LOWER(@companyName)
          ORDER BY upload_date DESC
        )
        SELECT
          th.transaction_id,
          th.transaction_date,
          th.description,
          th.reference,
          th.created_by,
          tl.account_code,
          tl.account_name,
          tl.amount,
          tl.line_description,
          CASE
            WHEN tl.amount % 10000 = 0 THEN 'Ten Thousand Round'
            WHEN tl.amount % 5000 = 0 THEN 'Five Thousand Round'
            WHEN tl.amount % 1000 = 0 THEN 'Thousand Round'
            WHEN tl.amount % 500 = 0 THEN 'Five Hundred Round'
            ELSE 'Other Round'
          END as rounding_level,
          th.entry_type,
          CASE
            WHEN th.entry_type = 'Manual' AND tl.amount >= 10000 THEN 'High Risk'
            WHEN th.entry_type = 'Manual' AND tl.amount >= 5000 THEN 'Medium Risk'
            WHEN th.entry_type = 'Adjustment' THEN 'Review Required'
            ELSE 'Low Risk'
          END as risk_assessment
        FROM CompanyUpload cu
        INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
        INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
        WHERE tl.amount >= 1000  -- Materiality threshold
          AND (
            tl.amount % 1000 = 0  -- Amounts ending in 000
            OR tl.amount % 500 = 0  -- Amounts ending in 500
          )
          AND th.entry_type IN ('Manual', 'Adjustment')  -- Focus on manual entries
        ORDER BY tl.amount DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'transactionHeader', 'transactionLine'],
      expectedColumns: ['transaction_id', 'transaction_date', 'amount', 'rounding_level', 'risk_assessment']
    },
    {
      id: 'audit-duplicate-payments',
      name: 'Duplicate Payment Analysis',
      description: 'Identify potential duplicate payments to suppliers',
      category: 'audit',
      naturalLanguageExample: 'Find duplicate payments for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1 upload_id, company_name
          FROM upload
          WHERE client_id = @clientId
            AND LOWER(company_name) = LOWER(@companyName)
          ORDER BY upload_date DESC
        ),
        PotentialDuplicates AS (
          SELECT
            ph.supplier_name,
            ph.gross_amount,
            ph.invoice_date,
            ph.reference,
            COUNT(*) as occurrence_count,
            STRING_AGG(ph.invoice_number, ', ') as invoice_numbers,
            MIN(ph.invoice_date) as first_date,
            MAX(ph.invoice_date) as last_date,
            DATEDIFF(day, MIN(ph.invoice_date), MAX(ph.invoice_date)) as days_between
          FROM CompanyUpload cu
          INNER JOIN purchaseHeader ph ON ph.uploadId = cu.upload_id
          WHERE ph.status IN ('Paid', 'Open')
          GROUP BY
            ph.supplier_name,
            ph.gross_amount,
            ph.invoice_date,
            ph.reference
          HAVING COUNT(*) > 1  -- Multiple occurrences
        )
        SELECT
          supplier_name,
          gross_amount,
          occurrence_count,
          invoice_numbers,
          first_date,
          last_date,
          days_between,
          gross_amount * (occurrence_count - 1) as potential_overpayment,
          CASE
            WHEN days_between = 0 THEN 'Same Day Duplicate'
            WHEN days_between <= 7 THEN 'Likely Duplicate'
            WHEN days_between <= 30 THEN 'Possible Duplicate'
            ELSE 'Review Required'
          END as duplicate_likelihood
        FROM PotentialDuplicates
        ORDER BY potential_overpayment DESC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'purchaseHeader'],
      expectedColumns: ['supplier_name', 'gross_amount', 'occurrence_count', 'potential_overpayment', 'duplicate_likelihood']
    },
    {
      id: 'audit-revenue-cutoff',
      name: 'Revenue Cutoff Testing',
      description: 'Analyze sales near period end for proper cutoff',
      category: 'audit',
      naturalLanguageExample: 'Perform revenue cutoff testing for ABC Company',
      sqlTemplate: `
        WITH CompanyUpload AS (
          SELECT TOP 1
            u.upload_id,
            u.company_name,
            fp.period_end_date
          FROM upload u
          LEFT JOIN financialPeriod fp ON u.financial_period_id = fp.period_id
          WHERE u.client_id = @clientId
            AND LOWER(u.company_name) = LOWER(@companyName)
          ORDER BY u.upload_date DESC
        ),
        CutoffTransactions AS (
          SELECT
            cu.company_name,
            cu.period_end_date,
            sh.invoice_number,
            sh.invoice_date,
            sh.customer_name,
            sh.gross_amount,
            sh.delivery_date,
            sh.description,
            DATEDIFF(day, sh.invoice_date, cu.period_end_date) as days_from_period_end,
            CASE
              WHEN sh.invoice_date <= cu.period_end_date AND sh.delivery_date > cu.period_end_date THEN 'Early Recognition Risk'
              WHEN sh.invoice_date > cu.period_end_date AND sh.delivery_date <= cu.period_end_date THEN 'Late Recognition Risk'
              WHEN ABS(DATEDIFF(day, sh.invoice_date, cu.period_end_date)) <= 3 THEN 'Near Cutoff - Review'
              ELSE 'Properly Recorded'
            END as cutoff_assessment
          FROM CompanyUpload cu
          INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
          WHERE ABS(DATEDIFF(day, sh.invoice_date, cu.period_end_date)) <= 7  -- Within 7 days of period end
        )
        SELECT
          invoice_number,
          invoice_date,
          period_end_date,
          customer_name,
          gross_amount,
          delivery_date,
          days_from_period_end,
          cutoff_assessment,
          description
        FROM CutoffTransactions
        WHERE cutoff_assessment != 'Properly Recorded'
        ORDER BY ABS(days_from_period_end) ASC
      `,
      parameters: [
        {
          name: 'clientId',
          type: 'string',
          description: 'Client identifier for multi-tenant filtering'
        },
        {
          name: 'companyName',
          type: 'string',
          description: 'Name of the company to analyze'
        }
      ],
      involvedTables: ['upload', 'saleHeader', 'financialPeriod'],
      expectedColumns: ['invoice_number', 'invoice_date', 'customer_name', 'gross_amount', 'cutoff_assessment']
    }
  ];
}

/**
 * Get query template by ID
 */
export function getQueryTemplateById(id: string): QueryTemplate | undefined {
  const allQueries = getSampleQueries();
  return [...allQueries.lending, ...allQueries.audit].find(q => q.id === id);
}

/**
 * Get query templates for specific tables
 */
export function getQueryTemplatesForTables(tableNames: string[]): QueryTemplate[] {
  const allQueries = getSampleQueries();
  const allTemplates = [...allQueries.lending, ...allQueries.audit];

  return allTemplates.filter(template =>
    template.involvedTables.some(table =>
      tableNames.some(name => name.toLowerCase().includes(table.toLowerCase()))
    )
  );
}

export default {
  getSampleQueries,
  getQueryTemplateById,
  getQueryTemplatesForTables
};
