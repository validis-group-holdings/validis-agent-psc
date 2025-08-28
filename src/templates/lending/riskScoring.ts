import { QueryTemplate } from '../common/types';

export const creditRiskScorecard: QueryTemplate = {
  id: 'lending-credit-risk-scorecard',
  name: 'Credit Risk Scorecard',
  description: 'Calculate comprehensive credit risk score based on financial metrics and ratios',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for analysis' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    FinancialMetrics AS (
      SELECT 
        -- Revenue and Income
        SUM(CASE WHEN t.account_code LIKE '4%' AND t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as revenue,
        SUM(CASE WHEN (t.account_name LIKE '%cost of goods%' OR t.account_name LIKE '%cogs%') AND t.amount > 0 THEN t.amount ELSE 0 END) as cogs,
        SUM(CASE WHEN (t.account_code LIKE '5%' OR t.account_code LIKE '6%') AND t.account_name NOT LIKE '%interest%' THEN ABS(t.amount) ELSE 0 END) as operating_expenses,
        SUM(CASE WHEN t.account_name LIKE '%interest%' AND t.amount > 0 THEN t.amount ELSE 0 END) as interest_expense,
        SUM(CASE WHEN t.account_name LIKE '%depreciation%' OR t.account_name LIKE '%amortization%' THEN ABS(t.amount) ELSE 0 END) as depreciation
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    BalanceSheetMetrics AS (
      SELECT 
        SUM(CASE WHEN ab.account_type LIKE '%Asset%' OR ab.account_code LIKE '1%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_assets,
        SUM(CASE WHEN ab.account_type LIKE '%Current Asset%' OR (ab.account_code LIKE '1%' AND ab.account_type NOT LIKE '%Fixed%') THEN ABS(ab.ending_balance) ELSE 0 END) as current_assets,
        SUM(CASE WHEN ab.account_type LIKE '%Liability%' OR ab.account_code LIKE '2%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_liabilities,
        SUM(CASE WHEN ab.account_type LIKE '%Current Liability%' OR ab.account_type LIKE '%Payable%' THEN ABS(ab.ending_balance) ELSE 0 END) as current_liabilities,
        SUM(CASE WHEN ab.account_type IN ('Long-term Debt', 'Short-term Debt', 'Notes Payable') THEN ABS(ab.ending_balance) ELSE 0 END) as total_debt,
        SUM(CASE WHEN ab.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock') THEN ABS(ab.ending_balance) ELSE 0 END) as total_equity,
        SUM(CASE WHEN ab.account_type IN ('Cash', 'Bank') THEN ABS(ab.ending_balance) ELSE 0 END) as cash
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date = (SELECT MAX(ab2.balance_date) FROM dbo.account_balances ab2 WHERE ab2.upload_id = u.upload_id)
    ),
    RiskCalculations AS (
      SELECT 
        fm.*,
        bsm.*,
        
        -- Profitability Metrics
        fm.revenue - fm.cogs as gross_profit,
        fm.revenue - fm.cogs - fm.operating_expenses as operating_income,
        fm.revenue - fm.cogs - fm.operating_expenses - fm.interest_expense as net_income,
        fm.revenue - fm.cogs - fm.operating_expenses + fm.depreciation as ebitda,
        
        -- Liquidity Ratios
        CASE WHEN bsm.current_liabilities > 0 THEN bsm.current_assets / bsm.current_liabilities ELSE NULL END as current_ratio,
        CASE WHEN bsm.current_liabilities > 0 THEN bsm.cash / bsm.current_liabilities ELSE NULL END as cash_ratio,
        
        -- Leverage Ratios
        CASE WHEN bsm.total_equity > 0 THEN bsm.total_debt / bsm.total_equity ELSE NULL END as debt_to_equity,
        CASE WHEN bsm.total_assets > 0 THEN bsm.total_debt / bsm.total_assets ELSE NULL END as debt_to_assets,
        
        -- Coverage Ratios
        CASE WHEN fm.interest_expense > 0 THEN (fm.revenue - fm.cogs - fm.operating_expenses) / fm.interest_expense ELSE NULL END as interest_coverage,
        CASE WHEN fm.interest_expense > 0 THEN (fm.revenue - fm.cogs - fm.operating_expenses + fm.depreciation) / fm.interest_expense ELSE NULL END as ebitda_coverage,
        
        -- Efficiency Ratios
        CASE WHEN bsm.total_assets > 0 THEN fm.revenue / bsm.total_assets ELSE NULL END as asset_turnover,
        CASE WHEN fm.revenue > 0 THEN (fm.revenue - fm.cogs - fm.operating_expenses - fm.interest_expense) / fm.revenue * 100 ELSE NULL END as net_margin
        
      FROM FinancialMetrics fm
      CROSS JOIN BalanceSheetMetrics bsm
    ),
    RiskScoring AS (
      SELECT 
        rc.*,
        
        -- Profitability Score (0-25 points)
        CASE 
          WHEN rc.net_margin >= 15 THEN 25
          WHEN rc.net_margin >= 10 THEN 20
          WHEN rc.net_margin >= 5 THEN 15
          WHEN rc.net_margin >= 0 THEN 10
          WHEN rc.net_margin < 0 THEN 0
          ELSE 5 -- Unable to calculate
        END as profitability_score,
        
        -- Liquidity Score (0-25 points)
        CASE 
          WHEN rc.current_ratio >= 2.0 THEN 25
          WHEN rc.current_ratio >= 1.5 THEN 20
          WHEN rc.current_ratio >= 1.2 THEN 15
          WHEN rc.current_ratio >= 1.0 THEN 10
          WHEN rc.current_ratio < 1.0 THEN 5
          ELSE 5 -- Unable to calculate
        END as liquidity_score,
        
        -- Leverage Score (0-25 points) - Lower debt is better
        CASE 
          WHEN rc.debt_to_equity <= 0.3 THEN 25
          WHEN rc.debt_to_equity <= 0.5 THEN 20
          WHEN rc.debt_to_equity <= 0.7 THEN 15
          WHEN rc.debt_to_equity <= 1.0 THEN 10
          WHEN rc.debt_to_equity > 1.0 THEN 5
          ELSE 10 -- Unable to calculate
        END as leverage_score,
        
        -- Coverage Score (0-25 points)
        CASE 
          WHEN rc.interest_coverage >= 5.0 THEN 25
          WHEN rc.interest_coverage >= 3.0 THEN 20
          WHEN rc.interest_coverage >= 2.0 THEN 15
          WHEN rc.interest_coverage >= 1.5 THEN 10
          WHEN rc.interest_coverage >= 1.0 THEN 5
          WHEN rc.interest_coverage < 1.0 THEN 0
          ELSE 10 -- Unable to calculate
        END as coverage_score
        
      FROM RiskCalculations rc
    )
    SELECT 
      rs.revenue,
      rs.gross_profit,
      rs.operating_income,
      rs.net_income,
      rs.ebitda,
      rs.total_assets,
      rs.total_liabilities,
      rs.total_debt,
      rs.total_equity,
      rs.current_ratio,
      rs.cash_ratio,
      rs.debt_to_equity,
      rs.debt_to_assets,
      rs.interest_coverage,
      rs.ebitda_coverage,
      rs.asset_turnover,
      rs.net_margin,
      rs.profitability_score,
      rs.liquidity_score,
      rs.leverage_score,
      rs.coverage_score,
      
      -- Overall Risk Score (0-100)
      rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score as total_risk_score,
      
      -- Risk Grade
      CASE 
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 85 THEN 'AAA - Excellent'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 75 THEN 'AA - Very Good'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 65 THEN 'A - Good'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 55 THEN 'BBB - Satisfactory'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 45 THEN 'BB - Marginal'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 35 THEN 'B - Weak'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 25 THEN 'CCC - Poor'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 15 THEN 'CC - Very Poor'
        ELSE 'C - Extremely Poor'
      END as risk_grade,
      
      -- Lending Recommendation
      CASE 
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 75 THEN 'Approved - Low Risk'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 60 THEN 'Approved - Moderate Risk'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 45 THEN 'Conditional Approval'
        WHEN (rs.profitability_score + rs.liquidity_score + rs.leverage_score + rs.coverage_score) >= 30 THEN 'Review Required'
        ELSE 'Decline - High Risk'
      END as lending_recommendation,
      
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
      
    FROM RiskScoring rs
  `,
  estimatedRuntime: 9,
  complexity: 'high',
  tags: ['credit-risk', 'risk-scoring', 'lending-decision', 'financial-analysis']
};

export const industryBenchmarking: QueryTemplate = {
  id: 'lending-industry-benchmarking',
  name: 'Industry Benchmarking',
  description: 'Compare key financial metrics against industry benchmarks for lending assessment',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'industryType', type: 'string', required: false, defaultValue: 'General', description: 'Industry type for benchmarking (Manufacturing, Retail, Services, etc.)' },
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for analysis' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CompanyMetrics AS (
      SELECT 
        -- Revenue and Profitability
        SUM(CASE WHEN t.account_code LIKE '4%' AND t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as revenue,
        SUM(CASE WHEN (t.account_name LIKE '%cost of goods%' OR t.account_name LIKE '%cogs%') AND t.amount > 0 THEN t.amount ELSE 0 END) as cogs,
        SUM(CASE WHEN (t.account_code LIKE '5%' OR t.account_code LIKE '6%') THEN ABS(t.amount) ELSE 0 END) as total_expenses,
        SUM(CASE WHEN t.account_name LIKE '%interest%' AND t.amount > 0 THEN t.amount ELSE 0 END) as interest_expense
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    CompanyBalances AS (
      SELECT 
        SUM(CASE WHEN ab.account_type LIKE '%Asset%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_assets,
        SUM(CASE WHEN ab.account_type LIKE '%Current Asset%' THEN ABS(ab.ending_balance) ELSE 0 END) as current_assets,
        SUM(CASE WHEN ab.account_type LIKE '%Current Liability%' THEN ABS(ab.ending_balance) ELSE 0 END) as current_liabilities,
        SUM(CASE WHEN ab.account_type LIKE '%Debt%' OR ab.account_name LIKE '%loan%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_debt,
        SUM(CASE WHEN ab.account_type LIKE '%Equity%' THEN ABS(ab.ending_balance) ELSE 0 END) as total_equity
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date = (SELECT MAX(ab2.balance_date) FROM dbo.account_balances ab2 WHERE ab2.upload_id = u.upload_id)
    ),
    IndustryBenchmarks AS (
      -- Industry benchmark ranges (these would typically come from external data)
      SELECT 
        @industryType as industry,
        CASE @industryType
          WHEN 'Manufacturing' THEN 15.0 ELSE
          WHEN 'Retail' THEN 25.0 ELSE
          WHEN 'Services' THEN 35.0 ELSE
          WHEN 'Technology' THEN 40.0 ELSE
          WHEN 'Healthcare' THEN 20.0 ELSE
          20.0 -- General/Default
        END as benchmark_gross_margin,
        
        CASE @industryType
          WHEN 'Manufacturing' THEN 8.0 ELSE
          WHEN 'Retail' THEN 5.0 ELSE
          WHEN 'Services' THEN 12.0 ELSE
          WHEN 'Technology' THEN 15.0 ELSE
          WHEN 'Healthcare' THEN 10.0 ELSE
          8.0 -- General/Default
        END as benchmark_operating_margin,
        
        CASE @industryType
          WHEN 'Manufacturing' THEN 1.2 ELSE
          WHEN 'Retail' THEN 2.5 ELSE
          WHEN 'Services' THEN 1.8 ELSE
          WHEN 'Technology' THEN 2.0 ELSE
          WHEN 'Healthcare' THEN 1.5 ELSE
          1.5 -- General/Default
        END as benchmark_current_ratio,
        
        CASE @industryType
          WHEN 'Manufacturing' THEN 0.6 ELSE
          WHEN 'Retail' THEN 0.4 ELSE
          WHEN 'Services' THEN 0.3 ELSE
          WHEN 'Technology' THEN 0.2 ELSE
          WHEN 'Healthcare' THEN 0.4 ELSE
          0.4 -- General/Default
        END as benchmark_debt_to_equity,
        
        CASE @industryType
          WHEN 'Manufacturing' THEN 1.5 ELSE
          WHEN 'Retail' THEN 2.8 ELSE
          WHEN 'Services' THEN 2.2 ELSE
          WHEN 'Technology' THEN 1.8 ELSE
          WHEN 'Healthcare' THEN 1.6 ELSE
          1.8 -- General/Default
        END as benchmark_asset_turnover
    ),
    CompanyRatios AS (
      SELECT 
        cm.*,
        cb.*,
        -- Calculate company ratios
        CASE WHEN cm.revenue > 0 THEN ((cm.revenue - cm.cogs) / cm.revenue) * 100 ELSE NULL END as company_gross_margin,
        CASE WHEN cm.revenue > 0 THEN ((cm.revenue - cm.total_expenses) / cm.revenue) * 100 ELSE NULL END as company_operating_margin,
        CASE WHEN cb.current_liabilities > 0 THEN cb.current_assets / cb.current_liabilities ELSE NULL END as company_current_ratio,
        CASE WHEN cb.total_equity > 0 THEN cb.total_debt / cb.total_equity ELSE NULL END as company_debt_to_equity,
        CASE WHEN cb.total_assets > 0 THEN cm.revenue / cb.total_assets ELSE NULL END as company_asset_turnover,
        CASE WHEN cm.revenue > 0 THEN ((cm.revenue - cm.total_expenses) / cm.revenue) * 100 ELSE NULL END as company_net_margin
      FROM CompanyMetrics cm
      CROSS JOIN CompanyBalances cb
    )
    SELECT 
      ib.industry,
      cr.revenue as company_revenue,
      cr.company_gross_margin,
      ib.benchmark_gross_margin,
      cr.company_operating_margin,
      ib.benchmark_operating_margin,
      cr.company_current_ratio,
      ib.benchmark_current_ratio,
      cr.company_debt_to_equity,
      ib.benchmark_debt_to_equity,
      cr.company_asset_turnover,
      ib.benchmark_asset_turnover,
      
      -- Performance vs Benchmark
      CASE 
        WHEN cr.company_gross_margin >= ib.benchmark_gross_margin * 1.1 THEN 'Above Benchmark'
        WHEN cr.company_gross_margin >= ib.benchmark_gross_margin * 0.9 THEN 'At Benchmark'
        ELSE 'Below Benchmark'
      END as gross_margin_performance,
      
      CASE 
        WHEN cr.company_current_ratio >= ib.benchmark_current_ratio * 0.9 THEN 'Above Benchmark'
        WHEN cr.company_current_ratio >= ib.benchmark_current_ratio * 0.8 THEN 'At Benchmark'
        ELSE 'Below Benchmark'
      END as liquidity_performance,
      
      CASE 
        WHEN cr.company_debt_to_equity <= ib.benchmark_debt_to_equity * 1.1 THEN 'Better than Benchmark'
        WHEN cr.company_debt_to_equity <= ib.benchmark_debt_to_equity * 1.3 THEN 'At Benchmark'
        ELSE 'Worse than Benchmark'
      END as leverage_performance,
      
      -- Overall Assessment
      CASE 
        WHEN (CASE WHEN cr.company_gross_margin >= ib.benchmark_gross_margin * 1.1 THEN 1 ELSE 0 END +
              CASE WHEN cr.company_current_ratio >= ib.benchmark_current_ratio * 0.9 THEN 1 ELSE 0 END +
              CASE WHEN cr.company_debt_to_equity <= ib.benchmark_debt_to_equity * 1.1 THEN 1 ELSE 0 END) >= 2
        THEN 'Strong vs Industry'
        WHEN (CASE WHEN cr.company_gross_margin >= ib.benchmark_gross_margin * 0.9 THEN 1 ELSE 0 END +
              CASE WHEN cr.company_current_ratio >= ib.benchmark_current_ratio * 0.8 THEN 1 ELSE 0 END +
              CASE WHEN cr.company_debt_to_equity <= ib.benchmark_debt_to_equity * 1.3 THEN 1 ELSE 0 END) >= 2
        THEN 'Average vs Industry'
        ELSE 'Weak vs Industry'
      END as overall_industry_performance,
      
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
      
    FROM CompanyRatios cr
    CROSS JOIN IndustryBenchmarks ib
  `,
  estimatedRuntime: 8,
  complexity: 'high',
  tags: ['industry-benchmarking', 'comparative-analysis', 'performance-assessment']
};