import { QueryTemplate } from '../common/types';

export const liquidityRatioAnalysis: QueryTemplate = {
  id: 'lending-liquidity-ratios',
  name: 'Liquidity Ratio Analysis',
  description: 'Comprehensive analysis of liquidity ratios including current, quick, and cash ratios',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'asOfDate', type: 'date', required: false, description: 'Date for ratio calculation (defaults to latest)' },
    { name: 'periodsToCompare', type: 'number', required: false, defaultValue: 4, description: 'Number of periods for trend analysis' }
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
    LiquidityComponents AS (
      SELECT 
        qb.balance_year,
        qb.balance_quarter,
        MAX(qb.balance_date) as period_end_date,
        
        -- Cash and Cash Equivalents
        SUM(CASE 
          WHEN qb.account_type IN ('Cash', 'Bank', 'Cash and Cash Equivalents', 'Checking Account', 'Savings Account')
               OR qb.account_name LIKE '%cash%' OR qb.account_name LIKE '%checking%' OR qb.account_name LIKE '%savings%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as cash_and_equivalents,
        
        -- Short-term Marketable Securities
        SUM(CASE 
          WHEN qb.account_type LIKE '%Marketable Securities%' OR qb.account_name LIKE '%securities%'
               OR qb.account_name LIKE '%investments%' 
               AND qb.account_type NOT LIKE '%Long%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as marketable_securities,
        
        -- Accounts Receivable
        SUM(CASE 
          WHEN qb.account_type LIKE '%Receivable%' OR qb.account_name LIKE '%receivable%'
               AND qb.account_type NOT LIKE '%Long%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as accounts_receivable,
        
        -- Inventory
        SUM(CASE 
          WHEN qb.account_type LIKE '%Inventory%' OR qb.account_name LIKE '%inventory%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as inventory,
        
        -- Prepaid Expenses
        SUM(CASE 
          WHEN qb.account_type LIKE '%Prepaid%' OR qb.account_name LIKE '%prepaid%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as prepaid_expenses,
        
        -- Other Current Assets
        SUM(CASE 
          WHEN (qb.account_type LIKE '%Current Asset%' 
                OR (qb.account_code LIKE '1%' AND qb.account_type NOT LIKE '%Fixed%' AND qb.account_type NOT LIKE '%Long%'))
               AND qb.account_type NOT IN ('Cash', 'Bank', 'Cash and Cash Equivalents')
               AND qb.account_type NOT LIKE '%Receivable%' 
               AND qb.account_type NOT LIKE '%Inventory%'
               AND qb.account_type NOT LIKE '%Prepaid%'
               AND qb.account_type NOT LIKE '%Marketable Securities%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as other_current_assets,
        
        -- Current Liabilities
        SUM(CASE 
          WHEN qb.account_type LIKE '%Current Liability%' 
               OR qb.account_type LIKE '%Payable%'
               OR qb.account_type LIKE '%Accrued%'
               OR (qb.account_code LIKE '2%' AND qb.account_type NOT LIKE '%Long%')
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as current_liabilities,
        
        -- Accounts Payable
        SUM(CASE 
          WHEN qb.account_type LIKE '%Accounts Payable%' OR qb.account_name LIKE '%accounts payable%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as accounts_payable,
        
        -- Short-term Debt
        SUM(CASE 
          WHEN qb.account_type LIKE '%Short-term Debt%' OR qb.account_name LIKE '%short%debt%'
               OR qb.account_name LIKE '%line of credit%' OR qb.account_name LIKE '%credit line%'
          THEN ABS(qb.ending_balance) ELSE 0 
        END) as short_term_debt
        
      FROM QuarterlyBalances qb
      WHERE qb.rn = 1
      GROUP BY qb.balance_year, qb.balance_quarter
    ),
    LiquidityRatios AS (
      SELECT 
        lc.*,
        
        -- Calculate total current assets
        lc.cash_and_equivalents + lc.marketable_securities + lc.accounts_receivable + 
        lc.inventory + lc.prepaid_expenses + lc.other_current_assets as total_current_assets,
        
        -- Calculate quick assets (current assets minus inventory and prepaid)
        lc.cash_and_equivalents + lc.marketable_securities + lc.accounts_receivable + 
        lc.other_current_assets as quick_assets,
        
        -- Calculate super liquid assets (cash and marketable securities)
        lc.cash_and_equivalents + lc.marketable_securities as super_liquid_assets,
        
        -- Liquidity Ratios
        CASE 
          WHEN lc.current_liabilities > 0 
          THEN (lc.cash_and_equivalents + lc.marketable_securities + lc.accounts_receivable + 
                lc.inventory + lc.prepaid_expenses + lc.other_current_assets) / lc.current_liabilities
          ELSE NULL 
        END as current_ratio,
        
        CASE 
          WHEN lc.current_liabilities > 0 
          THEN (lc.cash_and_equivalents + lc.marketable_securities + lc.accounts_receivable + 
                lc.other_current_assets) / lc.current_liabilities
          ELSE NULL 
        END as quick_ratio,
        
        CASE 
          WHEN lc.current_liabilities > 0 
          THEN (lc.cash_and_equivalents + lc.marketable_securities) / lc.current_liabilities
          ELSE NULL 
        END as cash_ratio,
        
        -- Working Capital
        (lc.cash_and_equivalents + lc.marketable_securities + lc.accounts_receivable + 
         lc.inventory + lc.prepaid_expenses + lc.other_current_assets) - lc.current_liabilities as working_capital
        
      FROM LiquidityComponents lc
    ),
    LiquidityTrends AS (
      SELECT 
        lr.*,
        
        -- Period-over-period changes
        LAG(lr.current_ratio, 1) OVER (ORDER BY lr.balance_year, lr.balance_quarter) as prior_current_ratio,
        LAG(lr.quick_ratio, 1) OVER (ORDER BY lr.balance_year, lr.balance_quarter) as prior_quick_ratio,
        LAG(lr.cash_ratio, 1) OVER (ORDER BY lr.balance_year, lr.balance_quarter) as prior_cash_ratio,
        LAG(lr.working_capital, 1) OVER (ORDER BY lr.balance_year, lr.balance_quarter) as prior_working_capital,
        
        -- Moving averages
        AVG(lr.current_ratio) OVER (ORDER BY lr.balance_year, lr.balance_quarter ROWS 2 PRECEDING) as current_ratio_3q_avg,
        AVG(lr.quick_ratio) OVER (ORDER BY lr.balance_year, lr.balance_quarter ROWS 2 PRECEDING) as quick_ratio_3q_avg,
        
        ROW_NUMBER() OVER (ORDER BY lr.balance_year DESC, lr.balance_quarter DESC) as period_rank
        
      FROM LiquidityRatios lr
    )
    SELECT 
      lt.balance_year,
      lt.balance_quarter,
      lt.period_end_date,
      lt.cash_and_equivalents,
      lt.marketable_securities,
      lt.accounts_receivable,
      lt.inventory,
      lt.total_current_assets,
      lt.quick_assets,
      lt.super_liquid_assets,
      lt.current_liabilities,
      lt.working_capital,
      
      -- Liquidity Ratios
      lt.current_ratio,
      lt.quick_ratio,
      lt.cash_ratio,
      
      -- Period-over-period changes
      lt.current_ratio - ISNULL(lt.prior_current_ratio, 0) as current_ratio_change,
      lt.quick_ratio - ISNULL(lt.prior_quick_ratio, 0) as quick_ratio_change,
      lt.cash_ratio - ISNULL(lt.prior_cash_ratio, 0) as cash_ratio_change,
      lt.working_capital - ISNULL(lt.prior_working_capital, 0) as working_capital_change,
      
      -- Trend indicators
      CASE 
        WHEN lt.current_ratio > lt.current_ratio_3q_avg THEN 'Improving'
        WHEN lt.current_ratio < lt.current_ratio_3q_avg * 0.95 THEN 'Deteriorating'
        ELSE 'Stable'
      END as current_ratio_trend,
      
      CASE 
        WHEN lt.quick_ratio > lt.quick_ratio_3q_avg THEN 'Improving'
        WHEN lt.quick_ratio < lt.quick_ratio_3q_avg * 0.95 THEN 'Deteriorating'
        ELSE 'Stable'
      END as quick_ratio_trend,
      
      -- Liquidity Assessment
      CASE 
        WHEN lt.current_ratio >= 2.0 THEN 'Excellent Liquidity'
        WHEN lt.current_ratio >= 1.5 THEN 'Good Liquidity'
        WHEN lt.current_ratio >= 1.2 THEN 'Adequate Liquidity'
        WHEN lt.current_ratio >= 1.0 THEN 'Marginal Liquidity'
        WHEN lt.current_ratio < 1.0 THEN 'Poor Liquidity'
        ELSE 'Unable to Calculate'
      END as liquidity_assessment,
      
      CASE 
        WHEN lt.quick_ratio >= 1.0 THEN 'Strong Short-term Liquidity'
        WHEN lt.quick_ratio >= 0.8 THEN 'Adequate Short-term Liquidity'
        WHEN lt.quick_ratio >= 0.5 THEN 'Marginal Short-term Liquidity'
        WHEN lt.quick_ratio < 0.5 THEN 'Weak Short-term Liquidity'
        ELSE 'Unable to Calculate'
      END as quick_liquidity_assessment,
      
      -- Risk Flags
      CASE 
        WHEN lt.working_capital < 0 THEN 'Negative Working Capital'
        WHEN lt.current_ratio < 1.0 THEN 'Current Ratio Below 1.0'
        WHEN lt.cash_ratio < 0.1 THEN 'Very Low Cash Position'
        WHEN lt.quick_ratio < 0.5 THEN 'Poor Quick Ratio'
        ELSE 'No Immediate Liquidity Concerns'
      END as liquidity_risk_flag
      
    FROM LiquidityTrends lt
    ORDER BY lt.balance_year DESC, lt.balance_quarter DESC
  `,
  estimatedRuntime: 8,
  complexity: 'high',
  tags: ['liquidity-analysis', 'current-ratio', 'quick-ratio', 'working-capital', 'cash-ratio']
};

export const cashConversionCycle: QueryTemplate = {
  id: 'lending-cash-conversion-cycle',
  name: 'Cash Conversion Cycle Analysis',
  description: 'Calculate and analyze the cash conversion cycle to assess working capital efficiency',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for calculation' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    AnnualizedMetrics AS (
      SELECT 
        -- Cost of Goods Sold (annualized)
        SUM(CASE 
          WHEN (t.account_name LIKE '%cost of goods%' OR t.account_name LIKE '%cogs%' 
                OR t.account_name LIKE '%cost of sales%')
               AND t.amount > 0 
          THEN t.amount 
          ELSE 0 
        END) * (12.0 / @monthsToAnalyze) as annual_cogs,
        
        -- Revenue (annualized)
        SUM(CASE 
          WHEN t.account_code LIKE '4%' AND t.amount < 0 
          THEN ABS(t.amount) 
          ELSE 0 
        END) * (12.0 / @monthsToAnalyze) as annual_revenue
        
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    AverageBalances AS (
      SELECT 
        -- Average Inventory
        AVG(CASE 
          WHEN ab.account_type LIKE '%Inventory%' OR ab.account_name LIKE '%inventory%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as avg_inventory,
        
        -- Average Accounts Receivable
        AVG(CASE 
          WHEN ab.account_type LIKE '%Receivable%' OR ab.account_name LIKE '%receivable%'
               AND ab.account_type NOT LIKE '%Long%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as avg_accounts_receivable,
        
        -- Average Accounts Payable
        AVG(CASE 
          WHEN ab.account_type LIKE '%Accounts Payable%' OR ab.account_name LIKE '%accounts payable%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as avg_accounts_payable,
        
        -- Latest balances for reference
        MAX(CASE 
          WHEN ab.account_type LIKE '%Inventory%' 
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as current_inventory,
        
        MAX(CASE 
          WHEN ab.account_type LIKE '%Receivable%' 
               AND ab.account_type NOT LIKE '%Long%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as current_accounts_receivable,
        
        MAX(CASE 
          WHEN ab.account_type LIKE '%Accounts Payable%' 
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as current_accounts_payable,
        
        MAX(ab.balance_date) as latest_balance_date
        
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    CashConversionCalculation AS (
      SELECT 
        am.annual_cogs,
        am.annual_revenue,
        ab.avg_inventory,
        ab.avg_accounts_receivable,
        ab.avg_accounts_payable,
        ab.current_inventory,
        ab.current_accounts_receivable,
        ab.current_accounts_payable,
        ab.latest_balance_date,
        
        -- Days Inventory Outstanding (DIO)
        CASE 
          WHEN am.annual_cogs > 0 
          THEN (ab.avg_inventory / am.annual_cogs) * 365 
          ELSE NULL 
        END as days_inventory_outstanding,
        
        -- Days Sales Outstanding (DSO)
        CASE 
          WHEN am.annual_revenue > 0 
          THEN (ab.avg_accounts_receivable / am.annual_revenue) * 365 
          ELSE NULL 
        END as days_sales_outstanding,
        
        -- Days Payable Outstanding (DPO)
        CASE 
          WHEN am.annual_cogs > 0 
          THEN (ab.avg_accounts_payable / am.annual_cogs) * 365 
          ELSE NULL 
        END as days_payable_outstanding,
        
        -- Current period calculations using latest balances
        CASE 
          WHEN am.annual_cogs > 0 
          THEN (ab.current_inventory / am.annual_cogs) * 365 
          ELSE NULL 
        END as current_dio,
        
        CASE 
          WHEN am.annual_revenue > 0 
          THEN (ab.current_accounts_receivable / am.annual_revenue) * 365 
          ELSE NULL 
        END as current_dso,
        
        CASE 
          WHEN am.annual_cogs > 0 
          THEN (ab.current_accounts_payable / am.annual_cogs) * 365 
          ELSE NULL 
        END as current_dpo
        
      FROM AnnualizedMetrics am
      CROSS JOIN AverageBalances ab
    ),
    CashConversionAnalysis AS (
      SELECT 
        ccc.*,
        
        -- Cash Conversion Cycle (CCC = DIO + DSO - DPO)
        ISNULL(ccc.days_inventory_outstanding, 0) + 
        ISNULL(ccc.days_sales_outstanding, 0) - 
        ISNULL(ccc.days_payable_outstanding, 0) as cash_conversion_cycle,
        
        -- Current period CCC
        ISNULL(ccc.current_dio, 0) + 
        ISNULL(ccc.current_dso, 0) - 
        ISNULL(ccc.current_dpo, 0) as current_cash_conversion_cycle,
        
        -- Working Capital Efficiency Metrics
        CASE 
          WHEN ccc.annual_revenue > 0 
          THEN ((ISNULL(ccc.avg_inventory, 0) + ISNULL(ccc.avg_accounts_receivable, 0) - ISNULL(ccc.avg_accounts_payable, 0)) / ccc.annual_revenue) * 365
          ELSE NULL 
        END as net_working_capital_days,
        
        -- Calculate daily cash requirement
        CASE 
          WHEN ccc.annual_cogs > 0 
          THEN ccc.annual_cogs / 365 
          ELSE NULL 
        END as daily_cogs,
        
        -- Working capital investment
        ISNULL(ccc.avg_inventory, 0) + ISNULL(ccc.avg_accounts_receivable, 0) - ISNULL(ccc.avg_accounts_payable, 0) as net_working_capital
        
      FROM CashConversionCalculation ccc
    )
    SELECT 
      cca.annual_revenue,
      cca.annual_cogs,
      cca.avg_inventory,
      cca.avg_accounts_receivable,
      cca.avg_accounts_payable,
      cca.net_working_capital,
      cca.latest_balance_date,
      
      -- Cash Conversion Cycle Components
      cca.days_inventory_outstanding,
      cca.days_sales_outstanding,
      cca.days_payable_outstanding,
      cca.cash_conversion_cycle,
      
      -- Current period metrics
      cca.current_dio,
      cca.current_dso,
      cca.current_dpo,
      cca.current_cash_conversion_cycle,
      
      -- Efficiency Assessment
      CASE 
        WHEN cca.cash_conversion_cycle <= 30 THEN 'Excellent Efficiency'
        WHEN cca.cash_conversion_cycle <= 60 THEN 'Good Efficiency'
        WHEN cca.cash_conversion_cycle <= 90 THEN 'Average Efficiency'
        WHEN cca.cash_conversion_cycle <= 120 THEN 'Below Average'
        WHEN cca.cash_conversion_cycle > 120 THEN 'Poor Efficiency'
        ELSE 'Unable to Calculate'
      END as ccc_efficiency_rating,
      
      -- Component Analysis
      CASE 
        WHEN cca.days_inventory_outstanding > 90 THEN 'Slow Inventory Turnover'
        WHEN cca.days_inventory_outstanding > 60 THEN 'Moderate Inventory Management'
        WHEN cca.days_inventory_outstanding <= 30 THEN 'Fast Inventory Turnover'
        ELSE 'No Inventory/Unable to Calculate'
      END as inventory_management_rating,
      
      CASE 
        WHEN cca.days_sales_outstanding > 60 THEN 'Slow Collections'
        WHEN cca.days_sales_outstanding > 45 THEN 'Average Collections'
        WHEN cca.days_sales_outstanding <= 30 THEN 'Fast Collections'
        ELSE 'Unable to Calculate'
      END as collection_efficiency_rating,
      
      CASE 
        WHEN cca.days_payable_outstanding > 45 THEN 'Extended Payment Terms'
        WHEN cca.days_payable_outstanding > 30 THEN 'Standard Payment Terms'
        WHEN cca.days_payable_outstanding <= 20 THEN 'Fast Payments'
        ELSE 'Unable to Calculate'
      END as payment_timing_rating,
      
      -- Working Capital Investment
      CASE 
        WHEN cca.daily_cogs > 0 
        THEN cca.net_working_capital / cca.daily_cogs 
        ELSE NULL 
      END as working_capital_in_days_of_cogs,
      
      CASE 
        WHEN cca.annual_revenue > 0 
        THEN (cca.net_working_capital / cca.annual_revenue) * 100 
        ELSE NULL 
      END as working_capital_as_pct_of_revenue,
      
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
      
    FROM CashConversionAnalysis cca
  `,
  estimatedRuntime: 9,
  complexity: 'high',
  tags: ['cash-conversion-cycle', 'working-capital-efficiency', 'dso', 'dio', 'dpo', 'operational-efficiency']
};