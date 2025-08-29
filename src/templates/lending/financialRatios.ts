import { QueryTemplate } from '../common/types';

export const profitabilityRatios: QueryTemplate = {
  id: 'lending-profitability-ratios',
  name: 'Profitability Ratios',
  description: 'Calculate key profitability ratios including gross margin, operating margin, and net margin',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months for ratio calculation' }
  ],
  expectedColumns: ['TOP'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    IncomeStatement AS (
      SELECT 
        -- Revenue (typically negative in accounting systems)
        SUM(CASE 
          WHEN t.account_code LIKE '4%' AND t.amount < 0 THEN ABS(t.amount) 
          ELSE 0 
        END) as gross_revenue,
        
        -- Cost of Goods Sold (typically positive)
        SUM(CASE 
          WHEN (t.account_name LIKE '%cost of goods%' OR t.account_name LIKE '%cogs%' 
                OR t.account_name LIKE '%cost of sales%')
               AND t.amount > 0 
          THEN t.amount 
          ELSE 0 
        END) as cost_of_goods_sold,
        
        -- Operating Expenses
        SUM(CASE 
          WHEN (t.account_code LIKE '5%' OR t.account_code LIKE '6%') 
               AND t.account_name NOT LIKE '%cost of goods%'
               AND t.account_name NOT LIKE '%interest%'
               AND t.account_name NOT LIKE '%tax%'
          THEN ABS(t.amount) 
          ELSE 0 
        END) as operating_expenses,
        
        -- Interest Expense
        SUM(CASE 
          WHEN t.account_name LIKE '%interest%' AND t.amount > 0
          THEN t.amount 
          ELSE 0 
        END) as interest_expense,
        
        -- Tax Expense
        SUM(CASE 
          WHEN t.account_name LIKE '%tax%' AND t.amount > 0
          THEN t.amount 
          ELSE 0 
        END) as tax_expense,
        
        -- Depreciation and Amortization
        SUM(CASE 
          WHEN (t.account_name LIKE '%depreciation%' OR t.account_name LIKE '%amortization%')
               AND t.amount > 0
          THEN t.amount 
          ELSE 0 
        END) as depreciation_amortization
        
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    AssetBalances AS (
      SELECT 
        SUM(CASE 
          WHEN ab.account_type LIKE '%Asset%' OR ab.account_code LIKE '1%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as total_assets,
        
        SUM(CASE 
          WHEN ab.account_type IN ('Owner Equity', 'Retained Earnings', 'Common Stock', 'Paid-in Capital')
               OR ab.account_code LIKE '3%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as total_equity,
        
        MAX(ab.balance_date) as balance_date
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date = (
        SELECT MAX(ab2.balance_date) 
        FROM dbo.account_balances ab2 
        WHERE ab2.upload_id = u.upload_id
      )
    )
    SELECT 
      ins.gross_revenue,
      ins.cost_of_goods_sold,
      ins.operating_expenses,
      ins.interest_expense,
      ins.tax_expense,
      ins.depreciation_amortization,
      ab.total_assets,
      ab.total_equity,
      ab.balance_date,
      
      -- Calculated Metrics
      ins.gross_revenue - ins.cost_of_goods_sold as gross_profit,
      ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses as operating_income,
      ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense as ebit,
      ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses + ins.depreciation_amortization as ebitda,
      ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense as net_income,
      
      -- Profitability Ratios
      CASE 
        WHEN ins.gross_revenue > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold) / ins.gross_revenue) * 100
        ELSE NULL 
      END as gross_margin_pct,
      
      CASE 
        WHEN ins.gross_revenue > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses) / ins.gross_revenue) * 100
        ELSE NULL 
      END as operating_margin_pct,
      
      CASE 
        WHEN ins.gross_revenue > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / ins.gross_revenue) * 100
        ELSE NULL 
      END as net_margin_pct,
      
      CASE 
        WHEN ins.gross_revenue > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses + ins.depreciation_amortization) / ins.gross_revenue) * 100
        ELSE NULL 
      END as ebitda_margin_pct,
      
      -- Return Ratios
      CASE 
        WHEN ab.total_assets > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / ab.total_assets) * 100
        ELSE NULL 
      END as roa_pct,
      
      CASE 
        WHEN ab.total_equity > 0 
        THEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / ab.total_equity) * 100
        ELSE NULL 
      END as roe_pct,
      
      -- Performance Assessment
      CASE 
        WHEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / NULLIF(ins.gross_revenue, 0)) * 100 > 15 THEN 'Excellent Profitability'
        WHEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / NULLIF(ins.gross_revenue, 0)) * 100 > 10 THEN 'Good Profitability'
        WHEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / NULLIF(ins.gross_revenue, 0)) * 100 > 5 THEN 'Average Profitability'
        WHEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / NULLIF(ins.gross_revenue, 0)) * 100 > 0 THEN 'Low Profitability'
        WHEN ((ins.gross_revenue - ins.cost_of_goods_sold - ins.operating_expenses - ins.interest_expense - ins.tax_expense) / NULLIF(ins.gross_revenue, 0)) * 100 <= 0 THEN 'Unprofitable'
        ELSE 'Unable to Calculate'
      END as profitability_assessment,
      
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
      
    FROM IncomeStatement ins
    CROSS JOIN AssetBalances ab
  `,
  estimatedRuntime: 7,
  estimatedExecutionTime: 7000,
  complexity: 'high',
  tags: ['profitability', 'financial-ratios', 'margins', 'roa', 'roe']
};

export const efficiencyRatios: QueryTemplate = {
  id: 'lending-efficiency-ratios',
  name: 'Efficiency Ratios',
  description: 'Calculate asset utilization and efficiency ratios including asset turnover and inventory turnover',
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
    RevenueData AS (
      SELECT 
        SUM(ABS(t.amount)) as annual_revenue
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.account_code LIKE '4%' -- Revenue accounts
        AND t.amount < 0 -- Revenue typically shows as negative
        AND t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    AssetData AS (
      SELECT 
        SUM(CASE 
          WHEN ab.account_type LIKE '%Asset%' OR ab.account_code LIKE '1%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as total_assets,
        
        SUM(CASE 
          WHEN ab.account_type LIKE '%Fixed Asset%' OR ab.account_name LIKE '%equipment%' 
               OR ab.account_name LIKE '%property%' OR ab.account_name LIKE '%building%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as fixed_assets,
        
        SUM(CASE 
          WHEN ab.account_type LIKE '%Inventory%' OR ab.account_name LIKE '%inventory%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as inventory,
        
        SUM(CASE 
          WHEN ab.account_type LIKE '%Receivable%' OR ab.account_name LIKE '%receivable%'
          THEN ABS(ab.ending_balance) 
          ELSE 0 
        END) as accounts_receivable,
        
        MAX(ab.balance_date) as balance_date
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date = (
        SELECT MAX(ab2.balance_date) 
        FROM dbo.account_balances ab2 
        WHERE ab2.upload_id = u.upload_id
      )
    ),
    COGSData AS (
      SELECT 
        SUM(CASE 
          WHEN (t.account_name LIKE '%cost of goods%' OR t.account_name LIKE '%cogs%' 
                OR t.account_name LIKE '%cost of sales%')
               AND t.amount > 0 
          THEN t.amount 
          ELSE 0 
        END) as cost_of_goods_sold
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    )
    SELECT 
      rd.annual_revenue,
      ad.total_assets,
      ad.fixed_assets,
      ad.inventory,
      ad.accounts_receivable,
      cd.cost_of_goods_sold,
      ad.balance_date,
      
      -- Asset Turnover Ratios
      CASE 
        WHEN ad.total_assets > 0 
        THEN rd.annual_revenue / ad.total_assets 
        ELSE NULL 
      END as total_asset_turnover,
      
      CASE 
        WHEN ad.fixed_assets > 0 
        THEN rd.annual_revenue / ad.fixed_assets 
        ELSE NULL 
      END as fixed_asset_turnover,
      
      CASE 
        WHEN ad.accounts_receivable > 0 
        THEN rd.annual_revenue / ad.accounts_receivable 
        ELSE NULL 
      END as accounts_receivable_turnover,
      
      CASE 
        WHEN ad.inventory > 0 
        THEN cd.cost_of_goods_sold / ad.inventory 
        ELSE NULL 
      END as inventory_turnover,
      
      -- Days Ratios
      CASE 
        WHEN ad.accounts_receivable > 0 AND rd.annual_revenue > 0
        THEN (ad.accounts_receivable / rd.annual_revenue) * 365 
        ELSE NULL 
      END as days_sales_outstanding,
      
      CASE 
        WHEN ad.inventory > 0 AND cd.cost_of_goods_sold > 0
        THEN (ad.inventory / cd.cost_of_goods_sold) * 365 
        ELSE NULL 
      END as days_inventory_outstanding,
      
      -- Efficiency Assessment
      CASE 
        WHEN rd.annual_revenue / NULLIF(ad.total_assets, 0) >= 2.0 THEN 'High Efficiency'
        WHEN rd.annual_revenue / NULLIF(ad.total_assets, 0) >= 1.5 THEN 'Good Efficiency'
        WHEN rd.annual_revenue / NULLIF(ad.total_assets, 0) >= 1.0 THEN 'Average Efficiency'
        WHEN rd.annual_revenue / NULLIF(ad.total_assets, 0) >= 0.5 THEN 'Below Average'
        WHEN rd.annual_revenue / NULLIF(ad.total_assets, 0) < 0.5 THEN 'Poor Efficiency'
        ELSE 'Unable to Calculate'
      END as asset_efficiency_rating,
      
      CASE 
        WHEN cd.cost_of_goods_sold / NULLIF(ad.inventory, 0) >= 12 THEN 'Fast Moving Inventory'
        WHEN cd.cost_of_goods_sold / NULLIF(ad.inventory, 0) >= 6 THEN 'Good Inventory Management'
        WHEN cd.cost_of_goods_sold / NULLIF(ad.inventory, 0) >= 4 THEN 'Average Inventory Management'
        WHEN cd.cost_of_goods_sold / NULLIF(ad.inventory, 0) >= 2 THEN 'Slow Moving Inventory'
        WHEN cd.cost_of_goods_sold / NULLIF(ad.inventory, 0) < 2 THEN 'Very Slow Inventory'
        ELSE 'No Inventory or Unable to Calculate'
      END as inventory_management_rating,
      
      @monthsToAnalyze as analysis_period_months,
      GETDATE() as calculation_date
      
    FROM RevenueData rd
    CROSS JOIN AssetData ad
    CROSS JOIN COGSData cd
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'medium',
  tags: ['efficiency-ratios', 'asset-turnover', 'inventory-turnover', 'utilization']
};