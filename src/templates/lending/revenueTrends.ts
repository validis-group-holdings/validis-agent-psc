import { QueryTemplate } from '../common/types';

export const revenueGrowthAnalysis: QueryTemplate = {
  id: 'lending-revenue-growth',
  name: 'Revenue Growth Analysis',
  description: 'Analyze revenue growth trends over time to assess business performance and lending capacity',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 24, description: 'Number of months to analyze' },
    { name: 'revenueAccountPattern', type: 'string', required: false, defaultValue: '4%', description: 'Account pattern for revenue accounts' }
  ],
  expectedColumns: ['TOP'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    MonthlyRevenue AS (
      SELECT 
        YEAR(t.transaction_date) as revenue_year,
        MONTH(t.transaction_date) as revenue_month,
        t.account_code,
        t.account_name,
        SUM(ABS(t.amount)) as monthly_revenue
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE (t.account_code LIKE @revenueAccountPattern)
        AND t.transaction_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
        AND t.amount < 0 -- Revenue accounts typically have negative balances
      GROUP BY YEAR(t.transaction_date), MONTH(t.transaction_date), t.account_code, t.account_name
    ),
    RevenueWithTrends AS (
      SELECT 
        mr.*,
        LAG(mr.monthly_revenue, 1) OVER (PARTITION BY mr.account_code ORDER BY mr.revenue_year, mr.revenue_month) as prior_month_revenue,
        LAG(mr.monthly_revenue, 12) OVER (PARTITION BY mr.account_code ORDER BY mr.revenue_year, mr.revenue_month) as year_ago_revenue,
        AVG(mr.monthly_revenue) OVER (
          PARTITION BY mr.account_code 
          ORDER BY mr.revenue_year, mr.revenue_month 
          ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
        ) as three_month_avg
      FROM MonthlyRevenue mr
    ),
    RevenueAnalysis AS (
      SELECT 
        rwt.*,
        CASE 
          WHEN rwt.prior_month_revenue > 0 
          THEN ((rwt.monthly_revenue - rwt.prior_month_revenue) / rwt.prior_month_revenue) * 100
          ELSE 0
        END as month_over_month_growth,
        CASE 
          WHEN rwt.year_ago_revenue > 0 
          THEN ((rwt.monthly_revenue - rwt.year_ago_revenue) / rwt.year_ago_revenue) * 100
          ELSE 0
        END as year_over_year_growth,
        CASE 
          WHEN rwt.three_month_avg > 0 
          THEN ((rwt.monthly_revenue - rwt.three_month_avg) / rwt.three_month_avg) * 100
          ELSE 0
        END as trend_variance
      FROM RevenueWithTrends rwt
    )
    SELECT 
      ra.revenue_year,
      ra.revenue_month,
      ra.account_code,
      ra.account_name,
      ra.monthly_revenue,
      ra.prior_month_revenue,
      ra.year_ago_revenue,
      ra.three_month_avg,
      ra.month_over_month_growth,
      ra.year_over_year_growth,
      ra.trend_variance,
      CASE 
        WHEN ra.year_over_year_growth > 20 THEN 'High Growth'
        WHEN ra.year_over_year_growth > 5 THEN 'Moderate Growth'
        WHEN ra.year_over_year_growth > -5 THEN 'Stable'
        WHEN ra.year_over_year_growth > -20 THEN 'Declining'
        ELSE 'Significant Decline'
      END as growth_classification,
      CASE 
        WHEN ra.month_over_month_growth < -30 THEN 'Volatile Decline'
        WHEN ra.month_over_month_growth > 30 THEN 'Volatile Growth'
        ELSE 'Normal'
      END as volatility_flag
    FROM RevenueAnalysis ra
    WHERE ra.prior_month_revenue IS NOT NULL
    ORDER BY ra.revenue_year DESC, ra.revenue_month DESC, ra.monthly_revenue DESC
  `,
  estimatedRuntime: 7,
  estimatedExecutionTime: 7000,
  complexity: 'high',
  tags: ['revenue-growth', 'trend-analysis', 'business-performance']
};

export const seasonalityAnalysis: QueryTemplate = {
  id: 'lending-seasonality-analysis',
  name: 'Revenue Seasonality Analysis',
  description: 'Identify seasonal patterns in revenue to better understand business cycles',
  category: 'lending',
  workflow: 'lending',
  parameters: [
    { name: 'yearsToAnalyze', type: 'number', required: false, defaultValue: 3, description: 'Number of years to analyze for seasonality' },
    { name: 'revenueAccountPattern', type: 'string', required: false, defaultValue: '4%', description: 'Account pattern for revenue accounts' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    MonthlyRevenueTotals AS (
      SELECT 
        YEAR(t.transaction_date) as revenue_year,
        MONTH(t.transaction_date) as revenue_month,
        SUM(ABS(t.amount)) as total_monthly_revenue
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.account_code LIKE @revenueAccountPattern
        AND t.transaction_date >= DATEADD(YEAR, -@yearsToAnalyze, GETDATE())
        AND t.amount < 0 -- Revenue accounts typically have negative balances
      GROUP BY YEAR(t.transaction_date), MONTH(t.transaction_date)
    ),
    SeasonalAnalysis AS (
      SELECT 
        mrt.revenue_month,
        AVG(mrt.total_monthly_revenue) as avg_monthly_revenue,
        STDEV(mrt.total_monthly_revenue) as std_dev_revenue,
        COUNT(*) as year_count,
        MIN(mrt.total_monthly_revenue) as min_revenue,
        MAX(mrt.total_monthly_revenue) as max_revenue
      FROM MonthlyRevenueTotals mrt
      GROUP BY mrt.revenue_month
      HAVING COUNT(*) >= 2 -- At least 2 years of data
    ),
    OverallAverage AS (
      SELECT AVG(avg_monthly_revenue) as overall_avg_revenue
      FROM SeasonalAnalysis
    )
    SELECT 
      sa.revenue_month,
      DATENAME(MONTH, DATEFROMPARTS(2023, sa.revenue_month, 1)) as month_name,
      sa.avg_monthly_revenue,
      sa.std_dev_revenue,
      sa.year_count,
      sa.min_revenue,
      sa.max_revenue,
      oa.overall_avg_revenue,
      CASE 
        WHEN oa.overall_avg_revenue > 0 
        THEN ((sa.avg_monthly_revenue - oa.overall_avg_revenue) / oa.overall_avg_revenue) * 100
        ELSE 0
      END as seasonal_variance_pct,
      CASE 
        WHEN sa.std_dev_revenue > 0 
        THEN (sa.max_revenue - sa.min_revenue) / sa.avg_monthly_revenue * 100
        ELSE 0
      END as volatility_coefficient,
      CASE 
        WHEN sa.avg_monthly_revenue > oa.overall_avg_revenue * 1.15 THEN 'Peak Season'
        WHEN sa.avg_monthly_revenue > oa.overall_avg_revenue * 1.05 THEN 'Above Average'
        WHEN sa.avg_monthly_revenue < oa.overall_avg_revenue * 0.85 THEN 'Low Season'
        WHEN sa.avg_monthly_revenue < oa.overall_avg_revenue * 0.95 THEN 'Below Average'
        ELSE 'Average'
      END as seasonal_classification
    FROM SeasonalAnalysis sa
    CROSS JOIN OverallAverage oa
    ORDER BY sa.revenue_month
  `,
  estimatedRuntime: 8,
  estimatedExecutionTime: 8000,
  complexity: 'high',
  tags: ['seasonality', 'revenue-patterns', 'business-cycles']
};