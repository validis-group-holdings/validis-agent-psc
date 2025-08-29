import { QueryTemplate } from '../common/types';

export const cashFlowAnalysis: QueryTemplate = {
  id: 'lending-cash-flow-analysis',
  name: 'Cash Flow Analysis',
  description: 'Analyze cash inflows and outflows to assess liquidity and cash management',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months to analyze' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum transaction amount to include' }
  ],
  expectedColumns: ['TOP'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CashAccounts AS (
      SELECT DISTINCT account_code
      FROM dbo.chart_of_accounts coa
      INNER JOIN RecentUpload u ON coa.upload_id = u.upload_id
      WHERE coa.account_type IN ('Cash', 'Bank', 'Cash and Cash Equivalents')
         OR coa.account_code LIKE '1%' -- Typically cash accounts start with 1
    ),
    MonthlyCashFlow AS (
      SELECT 
        YEAR(t.transaction_date) as flow_year,
        MONTH(t.transaction_date) as flow_month,
        SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as cash_inflow,
        SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as cash_outflow,
        SUM(t.amount) as net_cash_flow,
        COUNT(*) as transaction_count,
        AVG(ABS(t.amount)) as avg_transaction_size
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      INNER JOIN CashAccounts ca ON t.account_code = ca.account_code
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
        AND ABS(t.amount) >= @minAmount
      GROUP BY YEAR(t.transaction_date), MONTH(t.transaction_date)
    )
    SELECT 
      mcf.flow_year,
      mcf.flow_month,
      mcf.cash_inflow,
      mcf.cash_outflow,
      mcf.net_cash_flow,
      mcf.transaction_count,
      mcf.avg_transaction_size,
      CASE 
        WHEN mcf.net_cash_flow > 0 THEN mcf.cash_inflow / NULLIF(mcf.cash_outflow, 0) 
        ELSE 0 
      END as cash_flow_ratio,
      LAG(mcf.net_cash_flow, 1) OVER (ORDER BY mcf.flow_year, mcf.flow_month) as prior_month_flow,
      mcf.net_cash_flow - LAG(mcf.net_cash_flow, 1) OVER (ORDER BY mcf.flow_year, mcf.flow_month) as flow_change,
      CASE 
        WHEN mcf.net_cash_flow < 0 THEN 'Negative Cash Flow'
        WHEN mcf.net_cash_flow < mcf.cash_outflow * 0.1 THEN 'Tight Cash Flow'
        ELSE 'Positive Cash Flow'
      END as cash_flow_status
    FROM MonthlyCashFlow mcf
    ORDER BY mcf.flow_year DESC, mcf.flow_month DESC
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'medium',
  tags: ['cash-flow', 'liquidity-analysis', 'financial-performance']
};

export const dailyCashPosition: QueryTemplate = {
  id: 'lending-daily-cash-position',
  name: 'Daily Cash Position',
  description: 'Track daily cash positions to identify cash management patterns and liquidity constraints',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'daysToAnalyze', type: 'number', required: false, defaultValue: 90, description: 'Number of days to analyze' },
    { name: 'lowCashThreshold', type: 'number', required: false, defaultValue: 10000, description: 'Threshold for low cash warning' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CashAccounts AS (
      SELECT DISTINCT account_code, account_name
      FROM dbo.chart_of_accounts coa
      INNER JOIN RecentUpload u ON coa.upload_id = u.upload_id
      WHERE coa.account_type IN ('Cash', 'Bank', 'Cash and Cash Equivalents')
         OR coa.account_code LIKE '1%'
    ),
    DailyCashActivity AS (
      SELECT 
        CAST(t.transaction_date AS DATE) as activity_date,
        t.account_code,
        ca.account_name,
        SUM(t.amount) as daily_net_change,
        COUNT(*) as transaction_count
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      INNER JOIN CashAccounts ca ON t.account_code = ca.account_code
      WHERE t.transaction_date >= DATEADD(DAY, -@daysToAnalyze, GETDATE())
      GROUP BY CAST(t.transaction_date AS DATE), t.account_code, ca.account_name
    ),
    CashPositions AS (
      SELECT 
        dca.activity_date,
        dca.account_code,
        dca.account_name,
        dca.daily_net_change,
        dca.transaction_count,
        SUM(dca.daily_net_change) OVER (
          PARTITION BY dca.account_code 
          ORDER BY dca.activity_date 
          ROWS UNBOUNDED PRECEDING
        ) as running_balance
      FROM DailyCashActivity dca
    )
    SELECT 
      cp.activity_date,
      cp.account_code,
      cp.account_name,
      cp.daily_net_change,
      cp.transaction_count,
      cp.running_balance,
      CASE 
        WHEN cp.running_balance < @lowCashThreshold THEN 'Low Cash'
        WHEN cp.running_balance < 0 THEN 'Overdraft'
        ELSE 'Adequate'
      END as cash_status,
      LAG(cp.running_balance, 1) OVER (PARTITION BY cp.account_code ORDER BY cp.activity_date) as prior_day_balance,
      CASE 
        WHEN cp.daily_net_change > 0 THEN 'Cash Increase'
        WHEN cp.daily_net_change < 0 THEN 'Cash Decrease'
        ELSE 'No Change'
      END as daily_trend
    FROM CashPositions cp
    WHERE cp.running_balance < @lowCashThreshold OR cp.running_balance < 0
    ORDER BY cp.activity_date DESC, cp.running_balance ASC
  `,
  estimatedRuntime: 5,
  estimatedExecutionTime: 5000,
  complexity: 'medium',
  tags: ['daily-cash', 'liquidity-monitoring', 'cash-management']
};