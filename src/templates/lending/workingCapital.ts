import { QueryTemplate } from '../common/types';

export const workingCapitalAnalysis: QueryTemplate = {
  id: 'lending-working-capital',
  name: 'Working Capital Analysis',
  description: 'Analyze working capital components and calculate key working capital ratios',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'asOfDate', type: 'date', required: false, description: 'Date to calculate working capital (defaults to latest)' },
    { name: 'periodsToCompare', type: 'number', required: false, defaultValue: 4, description: 'Number of periods to compare for trend analysis' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    QuarterlyBalances AS (
      SELECT 
        ab.account_code,
        ab.account_name,
        ab.account_type,
        ab.ending_balance,
        ab.balance_date,
        YEAR(ab.balance_date) as balance_year,
        CEILING(MONTH(ab.balance_date) / 3.0) as balance_quarter,
        ROW_NUMBER() OVER (
          PARTITION BY ab.account_code, YEAR(ab.balance_date), CEILING(MONTH(ab.balance_date) / 3.0) 
          ORDER BY ab.balance_date DESC
        ) as rn
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE (@asOfDate IS NULL OR ab.balance_date <= @asOfDate)
        AND ab.balance_date >= DATEADD(QUARTER, -@periodsToCompare, COALESCE(@asOfDate, GETDATE()))
    ),
    WorkingCapitalComponents AS (
      SELECT 
        qb.balance_year,
        qb.balance_quarter,
        qb.balance_date,
        
        -- Current Assets
        SUM(CASE 
          WHEN (qb.account_type LIKE '%Current Asset%' OR qb.account_type LIKE '%Cash%' 
                OR qb.account_type LIKE '%Receivable%' OR qb.account_type LIKE '%Inventory%'
                OR qb.account_code LIKE '1%') 
               AND qb.account_type NOT LIKE '%Fixed%' 
               AND qb.account_type NOT LIKE '%Long%'
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as current_assets,
        
        -- Cash and Cash Equivalents
        SUM(CASE 
          WHEN qb.account_type IN ('Cash', 'Bank', 'Cash and Cash Equivalents')
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as cash_and_equivalents,
        
        -- Accounts Receivable
        SUM(CASE 
          WHEN qb.account_type LIKE '%Receivable%' OR qb.account_name LIKE '%receivable%'
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as accounts_receivable,
        
        -- Inventory
        SUM(CASE 
          WHEN qb.account_type LIKE '%Inventory%' OR qb.account_name LIKE '%inventory%'
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as inventory,
        
        -- Current Liabilities
        SUM(CASE 
          WHEN qb.account_type LIKE '%Current Liability%' OR qb.account_type LIKE '%Payable%'
               OR (qb.account_code LIKE '2%' AND qb.account_type NOT LIKE '%Long%')
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as current_liabilities,
        
        -- Accounts Payable
        SUM(CASE 
          WHEN qb.account_type LIKE '%Accounts Payable%' OR qb.account_name LIKE '%payable%'
          THEN ABS(qb.ending_balance) 
          ELSE 0 
        END) as accounts_payable
        
      FROM QuarterlyBalances qb
      WHERE qb.rn = 1
      GROUP BY qb.balance_year, qb.balance_quarter, qb.balance_date
    ),
    WorkingCapitalMetrics AS (
      SELECT 
        wcc.*,
        wcc.current_assets - wcc.current_liabilities as working_capital,
        CASE 
          WHEN wcc.current_liabilities > 0 
          THEN wcc.current_assets / wcc.current_liabilities 
          ELSE NULL 
        END as current_ratio,
        CASE 
          WHEN wcc.current_liabilities > 0 
          THEN (wcc.current_assets - wcc.inventory) / wcc.current_liabilities 
          ELSE NULL 
        END as quick_ratio,
        CASE 
          WHEN wcc.current_liabilities > 0 
          THEN wcc.cash_and_equivalents / wcc.current_liabilities 
          ELSE NULL 
        END as cash_ratio,
        LAG(wcc.current_assets - wcc.current_liabilities, 1) OVER (
          ORDER BY wcc.balance_year, wcc.balance_quarter
        ) as prior_working_capital
      FROM WorkingCapitalComponents wcc
    )
    SELECT 
      wcm.balance_year,
      wcm.balance_quarter,
      wcm.balance_date,
      wcm.current_assets,
      wcm.cash_and_equivalents,
      wcm.accounts_receivable,
      wcm.inventory,
      wcm.current_liabilities,
      wcm.accounts_payable,
      wcm.working_capital,
      wcm.current_ratio,
      wcm.quick_ratio,
      wcm.cash_ratio,
      wcm.prior_working_capital,
      wcm.working_capital - ISNULL(wcm.prior_working_capital, 0) as working_capital_change,
      CASE 
        WHEN wcm.prior_working_capital IS NOT NULL AND wcm.prior_working_capital <> 0
        THEN ((wcm.working_capital - wcm.prior_working_capital) / ABS(wcm.prior_working_capital)) * 100
        ELSE NULL
      END as working_capital_change_pct,
      CASE 
        WHEN wcm.current_ratio >= 2.0 THEN 'Strong Liquidity'
        WHEN wcm.current_ratio >= 1.5 THEN 'Good Liquidity'
        WHEN wcm.current_ratio >= 1.0 THEN 'Adequate Liquidity'
        WHEN wcm.current_ratio < 1.0 THEN 'Liquidity Concern'
        ELSE 'Unable to Calculate'
      END as liquidity_assessment,
      CASE 
        WHEN wcm.working_capital > 0 THEN 'Positive Working Capital'
        WHEN wcm.working_capital < 0 THEN 'Negative Working Capital'
        ELSE 'Zero Working Capital'
      END as working_capital_status
    FROM WorkingCapitalMetrics wcm
    ORDER BY wcm.balance_year DESC, wcm.balance_quarter DESC
  `,
  estimatedRuntime: 8,
  complexity: 'high',
  tags: ['working-capital', 'liquidity-analysis', 'current-ratio', 'quick-ratio']
};

export const accountsReceivableTurnover: QueryTemplate = {
  id: 'lending-ar-turnover',
  name: 'Accounts Receivable Turnover',
  description: 'Calculate accounts receivable turnover and days sales outstanding to assess collection efficiency',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for revenue calculation' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    RevenueAnalysis AS (
      SELECT 
        SUM(ABS(t.amount)) as annual_revenue,
        COUNT(DISTINCT YEAR(t.transaction_date)) as years_in_analysis
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.account_code LIKE '4%' -- Revenue accounts
        AND t.amount < 0 -- Revenue typically shows as negative
        AND t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    ARBalances AS (
      SELECT 
        ab.balance_date,
        SUM(ABS(ab.ending_balance)) as total_ar_balance,
        ROW_NUMBER() OVER (ORDER BY ab.balance_date DESC) as rn
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE (ab.account_type LIKE '%Receivable%' OR ab.account_name LIKE '%receivable%')
        AND ab.account_type NOT LIKE '%Long%'
        AND ab.balance_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
      GROUP BY ab.balance_date
    ),
    ARTrend AS (
      SELECT 
        arb.balance_date,
        arb.total_ar_balance,
        AVG(arb.total_ar_balance) OVER (
          ORDER BY arb.balance_date 
          ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
        ) as avg_ar_balance,
        arb.rn
      FROM ARBalances arb
    ),
    CurrentAR AS (
      SELECT 
        total_ar_balance as current_ar_balance,
        balance_date as current_date
      FROM ARTrend 
      WHERE rn = 1
    ),
    AverageAR AS (
      SELECT 
        AVG(total_ar_balance) as average_ar_balance
      FROM ARTrend
      WHERE rn <= 12 -- Use up to 12 most recent periods
    )
    SELECT 
      ra.annual_revenue,
      ra.years_in_analysis,
      car.current_ar_balance,
      aar.average_ar_balance,
      car.current_date,
      CASE 
        WHEN aar.average_ar_balance > 0 
        THEN ra.annual_revenue / aar.average_ar_balance 
        ELSE NULL 
      END as ar_turnover_ratio,
      CASE 
        WHEN aar.average_ar_balance > 0 AND ra.annual_revenue > 0
        THEN (aar.average_ar_balance / ra.annual_revenue) * 365 
        ELSE NULL 
      END as days_sales_outstanding,
      CASE 
        WHEN ra.annual_revenue > 0 
        THEN (car.current_ar_balance / ra.annual_revenue) * 365 
        ELSE NULL 
      END as current_dso,
      @monthsToAnalyze as analysis_period_months,
      CASE 
        WHEN (aar.average_ar_balance / NULLIF(ra.annual_revenue, 0)) * 365 <= 30 THEN 'Excellent Collection'
        WHEN (aar.average_ar_balance / NULLIF(ra.annual_revenue, 0)) * 365 <= 45 THEN 'Good Collection'
        WHEN (aar.average_ar_balance / NULLIF(ra.annual_revenue, 0)) * 365 <= 60 THEN 'Average Collection'
        WHEN (aar.average_ar_balance / NULLIF(ra.annual_revenue, 0)) * 365 <= 90 THEN 'Slow Collection'
        WHEN (aar.average_ar_balance / NULLIF(ra.annual_revenue, 0)) * 365 > 90 THEN 'Poor Collection'
        ELSE 'Unable to Calculate'
      END as collection_assessment,
      -- Industry benchmarks vary, but general guidelines:
      CASE 
        WHEN ra.annual_revenue / NULLIF(aar.average_ar_balance, 0) >= 12 THEN 'High Efficiency'
        WHEN ra.annual_revenue / NULLIF(aar.average_ar_balance, 0) >= 8 THEN 'Good Efficiency'
        WHEN ra.annual_revenue / NULLIF(aar.average_ar_balance, 0) >= 6 THEN 'Average Efficiency'
        WHEN ra.annual_revenue / NULLIF(aar.average_ar_balance, 0) >= 4 THEN 'Below Average'
        WHEN ra.annual_revenue / NULLIF(aar.average_ar_balance, 0) < 4 THEN 'Poor Efficiency'
        ELSE 'Unable to Calculate'
      END as efficiency_rating
    FROM RevenueAnalysis ra
    CROSS JOIN CurrentAR car
    CROSS JOIN AverageAR aar
  `,
  estimatedRuntime: 6,
  complexity: 'medium',
  tags: ['accounts-receivable', 'turnover-analysis', 'dso', 'collection-efficiency']
};