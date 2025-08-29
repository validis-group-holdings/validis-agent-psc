import { QueryTemplate } from '../common/types';

export const expenseVarianceAnalysis: QueryTemplate = {
  id: 'audit-expense-variance',
  name: 'Expense Variance Analysis',
  description: 'Compare current period expenses to previous periods to identify significant variances',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'varianceThreshold', type: 'number', required: false, defaultValue: 20, description: 'Variance percentage threshold to flag' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum expense amount to consider' },
    { name: 'periodsToCompare', type: 'number', required: false, defaultValue: 3, description: 'Number of previous periods to compare' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    MonthlyExpenses AS (
      SELECT 
        t.account_code,
        t.account_name,
        YEAR(t.transaction_date) as expense_year,
        MONTH(t.transaction_date) as expense_month,
        SUM(ABS(t.amount)) as monthly_expense
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.account_code LIKE '4%' -- Expense accounts typically start with 4
        OR t.account_code LIKE '5%'   -- Some expense accounts start with 5
        OR t.account_code LIKE '6%'   -- Some expense accounts start with 6
      GROUP BY t.account_code, t.account_name, YEAR(t.transaction_date), MONTH(t.transaction_date)
      HAVING SUM(ABS(t.amount)) >= @minAmount
    ),
    ExpenseComparison AS (
      SELECT 
        me.account_code,
        me.account_name,
        me.expense_year,
        me.expense_month,
        me.monthly_expense as current_expense,
        AVG(me2.monthly_expense) as avg_prior_expense,
        CASE 
          WHEN AVG(me2.monthly_expense) > 0 
          THEN ((me.monthly_expense - AVG(me2.monthly_expense)) / AVG(me2.monthly_expense)) * 100
          ELSE 0
        END as variance_percentage
      FROM MonthlyExpenses me
      LEFT JOIN MonthlyExpenses me2 ON me.account_code = me2.account_code
        AND (
          (me2.expense_year = me.expense_year AND me2.expense_month < me.expense_month)
          OR (me2.expense_year < me.expense_year)
        )
        AND DATEDIFF(MONTH, DATEFROMPARTS(me2.expense_year, me2.expense_month, 1), 
                             DATEFROMPARTS(me.expense_year, me.expense_month, 1)) <= @periodsToCompare
      GROUP BY me.account_code, me.account_name, me.expense_year, me.expense_month, me.monthly_expense
    )
    SELECT 
      ec.account_code,
      ec.account_name,
      ec.expense_year,
      ec.expense_month,
      ec.current_expense,
      ec.avg_prior_expense,
      ec.variance_percentage,
      CASE 
        WHEN ABS(ec.variance_percentage) >= @varianceThreshold * 2 THEN 'High Variance'
        WHEN ABS(ec.variance_percentage) >= @varianceThreshold THEN 'Medium Variance'
        ELSE 'Low Variance'
      END as variance_level,
      CASE 
        WHEN ec.variance_percentage > 0 THEN 'Increase'
        WHEN ec.variance_percentage < 0 THEN 'Decrease'
        ELSE 'No Change'
      END as variance_direction
    FROM ExpenseComparison ec
    WHERE ABS(ec.variance_percentage) >= @varianceThreshold
      AND ec.avg_prior_expense IS NOT NULL
    ORDER BY ABS(ec.variance_percentage) DESC
  `,
  estimatedRuntime: 8,
  complexity: 'high',
  tags: ['expense-analysis', 'variance-analysis', 'period-comparison']
};

export const unusualExpensePatterns: QueryTemplate = {
  id: 'audit-unusual-expense-patterns',
  name: 'Unusual Expense Patterns',
  description: 'Identify expense transactions with unusual patterns or characteristics',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minAmount', type: 'number', required: false, defaultValue: 500, description: 'Minimum expense amount to analyze' },
    { name: 'daysToAnalyze', type: 'number', required: false, defaultValue: 180, description: 'Number of days to analyze' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    ExpenseAnalysis AS (
      SELECT 
        t.transaction_id,
        t.transaction_date,
        t.posting_date,
        t.amount,
        t.account_code,
        t.account_name,
        t.description,
        t.reference_number,
        t.created_by_user,
        DATEPART(HOUR, t.posting_date) as posting_hour,
        DATEPART(WEEKDAY, t.posting_date) as posting_weekday,
        CASE 
          WHEN t.amount % 1 = 0 AND ABS(t.amount) >= 1000 THEN 'Round Amount'
          ELSE 'Normal Amount'
        END as amount_pattern,
        CASE 
          WHEN DATEPART(WEEKDAY, t.posting_date) IN (1, 7) THEN 'Weekend'
          WHEN DATEPART(HOUR, t.posting_date) < 8 OR DATEPART(HOUR, t.posting_date) > 18 THEN 'After Hours'
          ELSE 'Business Hours'
        END as timing_pattern,
        CASE 
          WHEN LEN(t.description) < 5 THEN 'Short Description'
          WHEN t.description IS NULL OR t.description = '' THEN 'No Description'
          ELSE 'Adequate Description'
        END as description_quality
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE (t.account_code LIKE '4%' OR t.account_code LIKE '5%' OR t.account_code LIKE '6%')
        AND ABS(t.amount) >= @minAmount
        AND t.transaction_date >= DATEADD(DAY, -@daysToAnalyze, GETDATE())
    )
    SELECT 
      ea.*,
      CASE 
        WHEN ea.timing_pattern IN ('Weekend', 'After Hours') 
             AND ea.amount_pattern = 'Round Amount' 
             AND ea.description_quality IN ('Short Description', 'No Description') 
        THEN 'High Risk'
        WHEN (ea.timing_pattern IN ('Weekend', 'After Hours') AND ea.amount_pattern = 'Round Amount')
             OR (ea.amount_pattern = 'Round Amount' AND ea.description_quality IN ('Short Description', 'No Description'))
        THEN 'Medium Risk'
        WHEN ea.timing_pattern IN ('Weekend', 'After Hours') 
             OR ea.amount_pattern = 'Round Amount' 
             OR ea.description_quality IN ('Short Description', 'No Description')
        THEN 'Low Risk'
        ELSE 'Normal'
      END as overall_risk_level
    FROM ExpenseAnalysis ea
    WHERE ea.timing_pattern IN ('Weekend', 'After Hours')
       OR ea.amount_pattern = 'Round Amount'
       OR ea.description_quality IN ('Short Description', 'No Description')
    ORDER BY 
      CASE ea.overall_risk_level 
        WHEN 'High Risk' THEN 1 
        WHEN 'Medium Risk' THEN 2 
        WHEN 'Low Risk' THEN 3 
        ELSE 4 
      END,
      ea.amount DESC
  `,
  estimatedRuntime: 7,
  complexity: 'high',
  tags: ['expense-patterns', 'risk-analysis', 'behavioral-analysis']
};