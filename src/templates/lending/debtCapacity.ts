import { QueryTemplate } from '../common/types';

export const debtToEquityAnalysis: QueryTemplate = {
  id: 'lending-debt-to-equity',
  name: 'Debt-to-Equity Analysis',
  description: 'Calculate debt-to-equity ratios and assess borrowing capacity',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'asOfDate', type: 'date', required: false, description: 'Date to calculate ratios (defaults to latest)' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    LatestBalances AS (
      SELECT 
        ab.account_code,
        ab.account_name,
        ab.account_type,
        ab.ending_balance,
        ab.balance_date,
        ROW_NUMBER() OVER (PARTITION BY ab.account_code ORDER BY ab.balance_date DESC) as rn
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE (@asOfDate IS NULL OR ab.balance_date <= @asOfDate)
    ),
    DebtEquityCalculation AS (
      SELECT 
        SUM(CASE 
          WHEN lb.account_type IN ('Long-term Debt', 'Short-term Debt', 'Notes Payable', 'Loans Payable') 
          THEN ABS(lb.ending_balance) 
          ELSE 0 
        END) as total_debt,
        SUM(CASE 
          WHEN lb.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock', 'Paid-in Capital') 
          THEN ABS(lb.ending_balance) 
          ELSE 0 
        END) as total_equity,
        SUM(CASE 
          WHEN lb.account_type LIKE '%Asset%' OR lb.account_code LIKE '1%' 
          THEN ABS(lb.ending_balance) 
          ELSE 0 
        END) as total_assets,
        SUM(CASE 
          WHEN lb.account_type LIKE '%Liability%' OR lb.account_code LIKE '2%'
          THEN ABS(lb.ending_balance) 
          ELSE 0 
        END) as total_liabilities,
        MAX(lb.balance_date) as calculation_date
      FROM LatestBalances lb
      WHERE lb.rn = 1
    ),
    DebtDetails AS (
      SELECT 
        lb.account_code,
        lb.account_name,
        lb.account_type,
        ABS(lb.ending_balance) as debt_amount,
        lb.balance_date
      FROM LatestBalances lb
      WHERE lb.rn = 1
        AND (lb.account_type IN ('Long-term Debt', 'Short-term Debt', 'Notes Payable', 'Loans Payable')
             OR lb.account_code LIKE '2%')
        AND lb.ending_balance != 0
    )
    SELECT 
      dec.total_debt,
      dec.total_equity,
      dec.total_assets,
      dec.total_liabilities,
      dec.calculation_date,
      CASE 
        WHEN dec.total_equity > 0 THEN dec.total_debt / dec.total_equity 
        ELSE NULL 
      END as debt_to_equity_ratio,
      CASE 
        WHEN dec.total_assets > 0 THEN dec.total_debt / dec.total_assets 
        ELSE NULL 
      END as debt_to_assets_ratio,
      CASE 
        WHEN dec.total_assets > 0 THEN dec.total_equity / dec.total_assets 
        ELSE NULL 
      END as equity_ratio,
      CASE 
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity < 0.3 THEN 'Low Leverage'
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity < 0.6 THEN 'Moderate Leverage'
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity < 1.0 THEN 'High Leverage'
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity >= 1.0 THEN 'Very High Leverage'
        ELSE 'Unable to Calculate'
      END as leverage_assessment,
      -- Borrowing capacity estimate (conservative approach)
      CASE 
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity < 0.5 
        THEN (dec.total_equity * 0.5) - dec.total_debt
        WHEN dec.total_equity > 0 AND dec.total_debt / dec.total_equity < 0.7 
        THEN (dec.total_equity * 0.7) - dec.total_debt
        ELSE 0
      END as estimated_additional_debt_capacity
    FROM DebtEquityCalculation dec
    
    UNION ALL
    
    SELECT 
      dd.debt_amount as total_debt,
      NULL as total_equity,
      NULL as total_assets,
      NULL as total_liabilities,
      dd.balance_date as calculation_date,
      NULL as debt_to_equity_ratio,
      NULL as debt_to_assets_ratio,
      NULL as equity_ratio,
      dd.account_name as leverage_assessment,
      dd.account_code as estimated_additional_debt_capacity
    FROM DebtDetails dd
    ORDER BY calculation_date DESC
  `,
  estimatedRuntime: 6,
  complexity: 'medium',
  tags: ['debt-capacity', 'leverage-analysis', 'borrowing-capacity']
};

export const debtServiceCoverageRatio: QueryTemplate = {
  id: 'lending-debt-service-coverage',
  name: 'Debt Service Coverage Ratio',
  description: 'Calculate debt service coverage ratio to assess ability to service debt',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for DSCR calculation' },
    { name: 'annualDebtService', type: 'number', required: false, description: 'Annual debt service amount (if known)' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CashFlowComponents AS (
      SELECT 
        -- Revenue (negative amounts in revenue accounts)
        SUM(CASE 
          WHEN t.account_code LIKE '4%' AND t.amount < 0 THEN ABS(t.amount) 
          ELSE 0 
        END) as total_revenue,
        
        -- Operating Expenses (positive amounts in expense accounts)
        SUM(CASE 
          WHEN t.account_code LIKE '5%' OR t.account_code LIKE '6%' THEN ABS(t.amount) 
          ELSE 0 
        END) as total_operating_expenses,
        
        -- Interest Expense
        SUM(CASE 
          WHEN t.account_name LIKE '%interest%' OR t.account_name LIKE '%Interest%' 
          THEN ABS(t.amount) 
          ELSE 0 
        END) as total_interest_expense,
        
        -- Debt Service Payments (estimated from expense accounts related to loans)
        SUM(CASE 
          WHEN t.account_name LIKE '%loan%' OR t.account_name LIKE '%debt%' 
            OR t.account_name LIKE '%principal%' OR t.account_name LIKE '%mortgage%'
          THEN ABS(t.amount) 
          ELSE 0 
        END) as estimated_debt_service,
        
        -- Depreciation (non-cash expense)
        SUM(CASE 
          WHEN t.account_name LIKE '%depreciation%' OR t.account_name LIKE '%amortization%'
          THEN ABS(t.amount) 
          ELSE 0 
        END) as total_depreciation
        
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    DSCRCalculation AS (
      SELECT 
        cfc.*,
        cfc.total_revenue - cfc.total_operating_expenses as ebitda_before_interest,
        cfc.total_revenue - cfc.total_operating_expenses - cfc.total_interest_expense as net_operating_income,
        (cfc.total_revenue - cfc.total_operating_expenses - cfc.total_interest_expense + cfc.total_depreciation) as cash_flow_available_for_debt,
        COALESCE(@annualDebtService, cfc.estimated_debt_service * (12.0 / @monthsToAnalyze)) as annual_debt_service_amount
      FROM CashFlowComponents cfc
    )
    SELECT 
      dc.total_revenue,
      dc.total_operating_expenses,
      dc.total_interest_expense,
      dc.total_depreciation,
      dc.ebitda_before_interest,
      dc.net_operating_income,
      dc.cash_flow_available_for_debt,
      dc.estimated_debt_service,
      dc.annual_debt_service_amount,
      CASE 
        WHEN dc.annual_debt_service_amount > 0 
        THEN dc.cash_flow_available_for_debt / dc.annual_debt_service_amount
        ELSE NULL 
      END as debt_service_coverage_ratio,
      CASE 
        WHEN dc.annual_debt_service_amount > 0 AND dc.cash_flow_available_for_debt / dc.annual_debt_service_amount >= 1.25 
        THEN 'Strong Coverage'
        WHEN dc.annual_debt_service_amount > 0 AND dc.cash_flow_available_for_debt / dc.annual_debt_service_amount >= 1.15 
        THEN 'Adequate Coverage'
        WHEN dc.annual_debt_service_amount > 0 AND dc.cash_flow_available_for_debt / dc.annual_debt_service_amount >= 1.0 
        THEN 'Marginal Coverage'
        WHEN dc.annual_debt_service_amount > 0 AND dc.cash_flow_available_for_debt / dc.annual_debt_service_amount < 1.0 
        THEN 'Insufficient Coverage'
        ELSE 'Unable to Calculate'
      END as coverage_assessment,
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
    FROM DSCRCalculation dc
  `,
  estimatedRuntime: 7,
  complexity: 'high',
  tags: ['debt-service', 'dscr', 'cash-flow-analysis', 'creditworthiness']
};