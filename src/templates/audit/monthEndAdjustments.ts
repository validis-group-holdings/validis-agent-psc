import { QueryTemplate } from '../common/types';

export const monthEndAdjustments: QueryTemplate = {
  id: 'audit-month-end-adjustments',
  name: 'Month-End Adjustments',
  description: 'Identify journal entries made at month-end that may require review',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'monthsToAnalyze', type: 'number', required: false, defaultValue: 12, description: 'Number of months to analyze' },
    { name: 'daysFromMonthEnd', type: 'number', required: false, defaultValue: 3, description: 'Days from month-end to consider' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum adjustment amount' }
  ],
  expectedColumns: ['TOP'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    MonthEndDates AS (
      SELECT DISTINCT
        EOMONTH(je.entry_date) as month_end_date,
        YEAR(je.entry_date) as entry_year,
        MONTH(je.entry_date) as entry_month
      FROM dbo.journal_entries je
      INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
      WHERE je.entry_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    ),
    MonthEndAdjustments AS (
      SELECT 
        je.journal_entry_id,
        je.entry_date,
        je.amount,
        je.account_code,
        je.account_name,
        je.description,
        je.reference_number,
        je.created_by_user,
        je.created_date,
        med.month_end_date,
        DATEDIFF(DAY, je.entry_date, med.month_end_date) as days_from_month_end
      FROM dbo.journal_entries je
      INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
      INNER JOIN MonthEndDates med ON YEAR(je.entry_date) = med.entry_year 
                                   AND MONTH(je.entry_date) = med.entry_month
      WHERE ABS(DATEDIFF(DAY, je.entry_date, med.month_end_date)) <= @daysFromMonthEnd
        AND ABS(je.amount) >= @minAmount
        AND je.entry_date >= DATEADD(MONTH, -@monthsToAnalyze, GETDATE())
    )
    SELECT 
      mea.*,
      CASE 
        WHEN mea.days_from_month_end = 0 THEN 'Last Day of Month'
        WHEN mea.days_from_month_end > 0 THEN 'Before Month End'
        ELSE 'After Month End'
      END as timing_classification,
      CASE 
        WHEN mea.description LIKE '%accrual%' OR mea.description LIKE '%adjustment%' THEN 'Likely Adjustment'
        WHEN ABS(mea.amount) > 10000 THEN 'High Value'
        ELSE 'Review Required'
      END as risk_level
    FROM MonthEndAdjustments mea
    ORDER BY mea.entry_date DESC, ABS(mea.amount) DESC
  `,
  estimatedRuntime: 7,
  estimatedExecutionTime: 7000,
  complexity: 'high',
  tags: ['month-end', 'adjustments', 'timing-analysis', 'accruals']
};

export const quarterEndAdjustments: QueryTemplate = {
  id: 'audit-quarter-end-adjustments',
  name: 'Quarter-End Adjustments',
  description: 'Focus on significant adjustments made at quarter-end',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'quartersToAnalyze', type: 'number', required: false, defaultValue: 4, description: 'Number of quarters to analyze' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 5000, description: 'Minimum adjustment amount for quarter-end' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    QuarterEndDates AS (
      SELECT DISTINCT
        CASE 
          WHEN MONTH(je.entry_date) IN (1,2,3) THEN DATEFROMPARTS(YEAR(je.entry_date), 3, 31)
          WHEN MONTH(je.entry_date) IN (4,5,6) THEN DATEFROMPARTS(YEAR(je.entry_date), 6, 30)
          WHEN MONTH(je.entry_date) IN (7,8,9) THEN DATEFROMPARTS(YEAR(je.entry_date), 9, 30)
          ELSE DATEFROMPARTS(YEAR(je.entry_date), 12, 31)
        END as quarter_end_date,
        YEAR(je.entry_date) as entry_year,
        CEILING(MONTH(je.entry_date) / 3.0) as entry_quarter
      FROM dbo.journal_entries je
      INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
      WHERE je.entry_date >= DATEADD(QUARTER, -@quartersToAnalyze, GETDATE())
    )
    SELECT 
      je.journal_entry_id,
      je.entry_date,
      je.amount,
      je.account_code,
      je.account_name,
      je.description,
      je.reference_number,
      qed.quarter_end_date,
      qed.entry_year,
      qed.entry_quarter,
      DATEDIFF(DAY, je.entry_date, qed.quarter_end_date) as days_from_quarter_end
    FROM dbo.journal_entries je
    INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
    INNER JOIN QuarterEndDates qed ON YEAR(je.entry_date) = qed.entry_year 
                                   AND CEILING(MONTH(je.entry_date) / 3.0) = qed.entry_quarter
    WHERE ABS(DATEDIFF(DAY, je.entry_date, qed.quarter_end_date)) <= 5
      AND ABS(je.amount) >= @minAmount
      AND je.entry_date >= DATEADD(QUARTER, -@quartersToAnalyze, GETDATE())
    ORDER BY qed.quarter_end_date DESC, ABS(je.amount) DESC
  `,
  estimatedRuntime: 8,
  estimatedExecutionTime: 8000,
  complexity: 'high',
  tags: ['quarter-end', 'significant-adjustments', 'period-end-analysis']
};