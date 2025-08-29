import { QueryTemplate } from '../common/types';

export const debtCovenantMonitoring: QueryTemplate = {
  id: 'lending-debt-covenant-monitoring',
  name: 'Debt Covenant Monitoring',
  description: 'Monitor compliance with common debt covenants including financial ratios and restrictions',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'minCurrentRatio', type: 'number', required: false, defaultValue: 1.2, description: 'Minimum current ratio covenant' },
    { name: 'maxDebtToEquity', type: 'number', required: false, defaultValue: 0.75, description: 'Maximum debt-to-equity ratio covenant' },
    { name: 'minDebtServiceCoverage', type: 'number', required: false, defaultValue: 1.25, description: 'Minimum debt service coverage ratio' },
    { name: 'minNetWorth', type: 'number', required: false, description: 'Minimum net worth requirement' },
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for analysis' }
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
        YEAR(ab.balance_date) as balance_year,
        CEILING(MONTH(ab.balance_date) / 3.0) as balance_quarter,
        MAX(ab.balance_date) as quarter_end_date,
        
        -- Current Assets
        SUM(CASE 
          WHEN ab.account_type LIKE '%Current Asset%' OR 
               (ab.account_code LIKE '1%' AND ab.account_type NOT LIKE '%Fixed%') 
          THEN ABS(ab.ending_balance) ELSE 0 
        END) as current_assets,
        
        -- Current Liabilities
        SUM(CASE 
          WHEN ab.account_type LIKE '%Current Liability%' OR ab.account_type LIKE '%Payable%'
          THEN ABS(ab.ending_balance) ELSE 0 
        END) as current_liabilities,
        
        -- Total Debt
        SUM(CASE 
          WHEN ab.account_type IN ('Long-term Debt', 'Short-term Debt', 'Notes Payable', 'Loans Payable')
               OR ab.account_name LIKE '%loan%' OR ab.account_name LIKE '%debt%'
          THEN ABS(ab.ending_balance) ELSE 0 
        END) as total_debt,
        
        -- Total Equity
        SUM(CASE 
          WHEN ab.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock', 'Paid-in Capital')
               OR ab.account_code LIKE '3%'
          THEN ABS(ab.ending_balance) ELSE 0 
        END) as total_equity,
        
        -- Total Assets
        SUM(CASE 
          WHEN ab.account_type LIKE '%Asset%' OR ab.account_code LIKE '1%'
          THEN ABS(ab.ending_balance) ELSE 0 
        END) as total_assets
        
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
      GROUP BY YEAR(ab.balance_date), CEILING(MONTH(ab.balance_date) / 3.0)
    ),
    QuarterlyCashFlow AS (
      SELECT 
        YEAR(t.transaction_date) as cash_flow_year,
        CEILING(MONTH(t.transaction_date) / 3.0) as cash_flow_quarter,
        
        -- Revenue
        SUM(CASE 
          WHEN t.account_code LIKE '4%' AND t.amount < 0 THEN ABS(t.amount) ELSE 0 
        END) as quarterly_revenue,
        
        -- Operating Expenses
        SUM(CASE 
          WHEN (t.account_code LIKE '5%' OR t.account_code LIKE '6%') 
               AND t.account_name NOT LIKE '%interest%' 
               AND t.account_name NOT LIKE '%depreciation%'
          THEN ABS(t.amount) ELSE 0 
        END) as quarterly_operating_expenses,
        
        -- Interest Expense
        SUM(CASE 
          WHEN t.account_name LIKE '%interest%' AND t.amount > 0 
          THEN t.amount ELSE 0 
        END) as quarterly_interest_expense,
        
        -- Debt Service Payments
        SUM(CASE 
          WHEN t.account_name LIKE '%loan%' OR t.account_name LIKE '%debt%' 
               OR t.account_name LIKE '%principal%'
          THEN ABS(t.amount) ELSE 0 
        END) as quarterly_debt_service,
        
        -- Depreciation (non-cash)
        SUM(CASE 
          WHEN t.account_name LIKE '%depreciation%' OR t.account_name LIKE '%amortization%'
          THEN ABS(t.amount) ELSE 0 
        END) as quarterly_depreciation
        
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
      GROUP BY YEAR(t.transaction_date), CEILING(MONTH(t.transaction_date) / 3.0)
    ),
    CovenantAnalysis AS (
      SELECT 
        qb.balance_year,
        qb.balance_quarter,
        qb.quarter_end_date,
        qb.current_assets,
        qb.current_liabilities,
        qb.total_debt,
        qb.total_equity,
        qb.total_assets,
        qcf.quarterly_revenue,
        qcf.quarterly_operating_expenses,
        qcf.quarterly_interest_expense,
        qcf.quarterly_debt_service,
        qcf.quarterly_depreciation,
        
        -- Calculate Covenant Ratios
        CASE 
          WHEN qb.current_liabilities > 0 
          THEN qb.current_assets / qb.current_liabilities 
          ELSE NULL 
        END as current_ratio,
        
        CASE 
          WHEN qb.total_equity > 0 
          THEN qb.total_debt / qb.total_equity 
          ELSE NULL 
        END as debt_to_equity_ratio,
        
        CASE 
          WHEN qcf.quarterly_debt_service > 0 
          THEN (qcf.quarterly_revenue - qcf.quarterly_operating_expenses - qcf.quarterly_interest_expense + qcf.quarterly_depreciation) / qcf.quarterly_debt_service
          ELSE NULL 
        END as debt_service_coverage_ratio,
        
        qb.total_equity as net_worth,
        
        -- Calculate net income
        qcf.quarterly_revenue - qcf.quarterly_operating_expenses - qcf.quarterly_interest_expense as net_income
        
      FROM QuarterlyBalances qb
      LEFT JOIN QuarterlyCashFlow qcf ON qb.balance_year = qcf.cash_flow_year 
                                      AND qb.balance_quarter = qcf.cash_flow_quarter
    ),
    CovenantCompliance AS (
      SELECT 
        ca.*,
        
        -- Covenant Compliance Checks
        CASE 
          WHEN ca.current_ratio >= @minCurrentRatio THEN 'Compliant'
          WHEN ca.current_ratio IS NULL THEN 'Unable to Calculate'
          ELSE 'Non-Compliant'
        END as current_ratio_compliance,
        
        CASE 
          WHEN ca.debt_to_equity_ratio <= @maxDebtToEquity THEN 'Compliant'
          WHEN ca.debt_to_equity_ratio IS NULL THEN 'Unable to Calculate'
          ELSE 'Non-Compliant'
        END as debt_to_equity_compliance,
        
        CASE 
          WHEN ca.debt_service_coverage_ratio >= @minDebtServiceCoverage THEN 'Compliant'
          WHEN ca.debt_service_coverage_ratio IS NULL THEN 'Unable to Calculate'
          ELSE 'Non-Compliant'
        END as debt_service_coverage_compliance,
        
        CASE 
          WHEN @minNetWorth IS NULL THEN 'Not Applicable'
          WHEN ca.net_worth >= @minNetWorth THEN 'Compliant'
          WHEN ca.net_worth IS NULL THEN 'Unable to Calculate'
          ELSE 'Non-Compliant'
        END as net_worth_compliance,
        
        -- Cushion/Headroom calculations
        CASE 
          WHEN ca.current_ratio IS NOT NULL 
          THEN ca.current_ratio - @minCurrentRatio 
          ELSE NULL 
        END as current_ratio_cushion,
        
        CASE 
          WHEN ca.debt_to_equity_ratio IS NOT NULL 
          THEN @maxDebtToEquity - ca.debt_to_equity_ratio 
          ELSE NULL 
        END as debt_to_equity_cushion,
        
        CASE 
          WHEN ca.debt_service_coverage_ratio IS NOT NULL 
          THEN ca.debt_service_coverage_ratio - @minDebtServiceCoverage 
          ELSE NULL 
        END as dscr_cushion
        
      FROM CovenantAnalysis ca
    )
    SELECT 
      cc.balance_year,
      cc.balance_quarter,
      cc.quarter_end_date,
      cc.current_ratio,
      @minCurrentRatio as required_current_ratio,
      cc.current_ratio_compliance,
      cc.current_ratio_cushion,
      
      cc.debt_to_equity_ratio,
      @maxDebtToEquity as max_allowed_debt_to_equity,
      cc.debt_to_equity_compliance,
      cc.debt_to_equity_cushion,
      
      cc.debt_service_coverage_ratio,
      @minDebtServiceCoverage as required_dscr,
      cc.debt_service_coverage_compliance,
      cc.dscr_cushion,
      
      cc.net_worth,
      @minNetWorth as required_net_worth,
      cc.net_worth_compliance,
      
      -- Overall Compliance Status
      CASE 
        WHEN cc.current_ratio_compliance = 'Non-Compliant' 
          OR cc.debt_to_equity_compliance = 'Non-Compliant'
          OR cc.debt_service_coverage_compliance = 'Non-Compliant'
          OR cc.net_worth_compliance = 'Non-Compliant'
        THEN 'Covenant Breach'
        WHEN cc.current_ratio_compliance = 'Unable to Calculate' 
          OR cc.debt_to_equity_compliance = 'Unable to Calculate'
          OR cc.debt_service_coverage_compliance = 'Unable to Calculate'
          OR cc.net_worth_compliance = 'Unable to Calculate'
        THEN 'Incomplete Data'
        ELSE 'All Covenants Compliant'
      END as overall_compliance_status,
      
      -- Risk Warning
      CASE 
        WHEN cc.current_ratio_cushion IS NOT NULL AND cc.current_ratio_cushion < 0.1 THEN 'Current Ratio Risk'
        WHEN cc.debt_to_equity_cushion IS NOT NULL AND cc.debt_to_equity_cushion < 0.05 THEN 'Leverage Risk'
        WHEN cc.dscr_cushion IS NOT NULL AND cc.dscr_cushion < 0.1 THEN 'Coverage Risk'
        ELSE 'No Immediate Risk'
      END as risk_warning
      
    FROM CovenantCompliance cc
    ORDER BY cc.balance_year DESC, cc.balance_quarter DESC
  `,
  estimatedRuntime: 10,
  complexity: 'high',
  tags: ['debt-covenants', 'compliance-monitoring', 'financial-ratios', 'loan-terms']
};

export const covenantTrendAnalysis: QueryTemplate = {
  id: 'lending-covenant-trends',
  name: 'Covenant Trend Analysis',
  description: 'Analyze trends in covenant compliance over time to predict future compliance issues',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'periodsToAnalyze', type: 'number', required: false, defaultValue: 8, description: 'Number of quarters to analyze for trends' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    HistoricalRatios AS (
      SELECT 
        YEAR(ab.balance_date) as ratio_year,
        CEILING(MONTH(ab.balance_date) / 3.0) as ratio_quarter,
        MAX(ab.balance_date) as period_end_date,
        
        -- Current Ratio components
        SUM(CASE WHEN ab.account_type LIKE '%Current Asset%' OR (ab.account_code LIKE '1%' AND ab.account_type NOT LIKE '%Fixed%') THEN ABS(ab.ending_balance) ELSE 0 END) /
        NULLIF(SUM(CASE WHEN ab.account_type LIKE '%Current Liability%' THEN ABS(ab.ending_balance) ELSE 0 END), 0) as current_ratio,
        
        -- Debt-to-Equity components
        SUM(CASE WHEN ab.account_type IN ('Long-term Debt', 'Short-term Debt', 'Notes Payable') THEN ABS(ab.ending_balance) ELSE 0 END) /
        NULLIF(SUM(CASE WHEN ab.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock') THEN ABS(ab.ending_balance) ELSE 0 END), 0) as debt_to_equity,
        
        -- Net Worth
        SUM(CASE WHEN ab.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock') THEN ABS(ab.ending_balance) ELSE 0 END) as net_worth,
        
        -- Total Assets
        SUM(CASE WHEN ab.account_type LIKE '%Asset%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_assets
        
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date >= DATEADD(QUARTER, -@periodsToAnalyze, GETDATE())
      GROUP BY YEAR(ab.balance_date), CEILING(MONTH(ab.balance_date) / 3.0)
    ),
    TrendCalculations AS (
      SELECT 
        hr.*,
        
        -- Calculate period-over-period changes
        LAG(hr.current_ratio, 1) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter) as prior_current_ratio,
        LAG(hr.debt_to_equity, 1) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter) as prior_debt_to_equity,
        LAG(hr.net_worth, 1) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter) as prior_net_worth,
        
        -- Calculate 4-quarter moving averages
        AVG(hr.current_ratio) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter ROWS 3 PRECEDING) as current_ratio_4q_avg,
        AVG(hr.debt_to_equity) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter ROWS 3 PRECEDING) as debt_to_equity_4q_avg,
        AVG(hr.net_worth) OVER (ORDER BY hr.ratio_year, hr.ratio_quarter ROWS 3 PRECEDING) as net_worth_4q_avg,
        
        -- Calculate linear trend slopes (simplified)
        ROW_NUMBER() OVER (ORDER BY hr.ratio_year, hr.ratio_quarter) as period_number
        
      FROM HistoricalRatios hr
    ),
    TrendAnalysis AS (
      SELECT 
        tc.*,
        
        -- Quarter-over-quarter changes
        CASE 
          WHEN tc.prior_current_ratio IS NOT NULL 
          THEN tc.current_ratio - tc.prior_current_ratio 
          ELSE NULL 
        END as current_ratio_qoq_change,
        
        CASE 
          WHEN tc.prior_debt_to_equity IS NOT NULL 
          THEN tc.debt_to_equity - tc.prior_debt_to_equity 
          ELSE NULL 
        END as debt_to_equity_qoq_change,
        
        CASE 
          WHEN tc.prior_net_worth IS NOT NULL 
          THEN ((tc.net_worth - tc.prior_net_worth) / NULLIF(ABS(tc.prior_net_worth), 0)) * 100 
          ELSE NULL 
        END as net_worth_qoq_pct_change,
        
        -- Trend direction indicators
        CASE 
          WHEN tc.current_ratio > tc.current_ratio_4q_avg THEN 'Improving'
          WHEN tc.current_ratio < tc.current_ratio_4q_avg * 0.95 THEN 'Deteriorating'
          ELSE 'Stable'
        END as current_ratio_trend,
        
        CASE 
          WHEN tc.debt_to_equity < tc.debt_to_equity_4q_avg THEN 'Improving'
          WHEN tc.debt_to_equity > tc.debt_to_equity_4q_avg * 1.05 THEN 'Deteriorating'
          ELSE 'Stable'
        END as debt_to_equity_trend,
        
        CASE 
          WHEN tc.net_worth > tc.net_worth_4q_avg THEN 'Growing'
          WHEN tc.net_worth < tc.net_worth_4q_avg * 0.95 THEN 'Declining'
          ELSE 'Stable'
        END as net_worth_trend
        
      FROM TrendCalculations tc
    )
    SELECT 
      ta.ratio_year,
      ta.ratio_quarter,
      ta.period_end_date,
      ta.current_ratio,
      ta.current_ratio_4q_avg,
      ta.current_ratio_qoq_change,
      ta.current_ratio_trend,
      
      ta.debt_to_equity,
      ta.debt_to_equity_4q_avg,
      ta.debt_to_equity_qoq_change,
      ta.debt_to_equity_trend,
      
      ta.net_worth,
      ta.net_worth_4q_avg,
      ta.net_worth_qoq_pct_change,
      ta.net_worth_trend,
      
      ta.total_assets,
      
      -- Overall trend assessment
      CASE 
        WHEN ta.current_ratio_trend = 'Deteriorating' 
          OR ta.debt_to_equity_trend = 'Deteriorating' 
          OR ta.net_worth_trend = 'Declining'
        THEN 'Concerning Trends'
        WHEN ta.current_ratio_trend = 'Improving' 
          AND ta.debt_to_equity_trend = 'Improving' 
          AND ta.net_worth_trend = 'Growing'
        THEN 'Positive Trends'
        ELSE 'Mixed/Stable Trends'
      END as overall_trend_assessment,
      
      -- Future compliance risk prediction
      CASE 
        WHEN ta.current_ratio_trend = 'Deteriorating' AND ta.current_ratio < 1.5 THEN 'High Risk - Current Ratio'
        WHEN ta.debt_to_equity_trend = 'Deteriorating' AND ta.debt_to_equity > 0.6 THEN 'High Risk - Leverage'
        WHEN ta.net_worth_trend = 'Declining' AND ta.net_worth_qoq_pct_change < -5 THEN 'High Risk - Capital Erosion'
        WHEN ta.current_ratio_trend = 'Deteriorating' OR ta.debt_to_equity_trend = 'Deteriorating' THEN 'Medium Risk'
        ELSE 'Low Risk'
      END as future_compliance_risk,
      
      ta.period_number
      
    FROM TrendAnalysis ta
    WHERE ta.period_number <= @periodsToAnalyze
    ORDER BY ta.ratio_year DESC, ta.ratio_quarter DESC
  `,
  estimatedRuntime: 9,
  complexity: 'high',
  tags: ['covenant-trends', 'predictive-analysis', 'compliance-risk', 'trend-monitoring']
};