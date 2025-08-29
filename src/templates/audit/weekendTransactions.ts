import { QueryTemplate } from '../common/types';

export const weekendTransactions: QueryTemplate = {
  id: 'audit-weekend-transactions',
  name: 'Weekend Transactions',
  description: 'Find transactions posted on weekends or holidays',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minAmount', type: 'number', required: false, defaultValue: 0, description: 'Minimum transaction amount' },
    { name: 'startDate', type: 'date', required: false, description: 'Start date for analysis' },
    { name: 'endDate', type: 'date', required: false, description: 'End date for analysis' }
  ],
  expectedColumns: ['transaction_id', 'transaction_date', 'posting_date', 'amount', 'account_code', 'account_name', 'description', 'reference_number', 'posting_weekday', 'day_type'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    )
    SELECT 
      t.transaction_id,
      t.transaction_date,
      t.posting_date,
      t.amount,
      t.account_code,
      t.account_name,
      t.description,
      t.reference_number,
      DATENAME(WEEKDAY, t.posting_date) as posting_weekday,
      CASE 
        WHEN DATEPART(WEEKDAY, t.posting_date) IN (1, 7) THEN 'Weekend'
        ELSE 'Weekday'
      END as day_type
    FROM dbo.transactions t
    INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
    WHERE DATEPART(WEEKDAY, t.posting_date) IN (1, 7) -- Sunday = 1, Saturday = 7
      AND ABS(t.amount) >= @minAmount
      AND (@startDate IS NULL OR t.transaction_date >= @startDate)
      AND (@endDate IS NULL OR t.transaction_date <= @endDate)
    ORDER BY t.posting_date DESC, t.amount DESC
  `,
  estimatedRuntime: 4,
  estimatedExecutionTime: 4000,
  complexity: 'medium',
  tags: ['weekend', 'unusual-timing', 'risk-indicators']
};

export const afterHoursTransactions: QueryTemplate = {
  id: 'audit-after-hours',
  name: 'After Hours Transactions',
  description: 'Find transactions posted outside normal business hours',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'startHour', type: 'number', required: false, defaultValue: 18, description: 'Hour after which transactions are suspicious' },
    { name: 'endHour', type: 'number', required: false, defaultValue: 8, description: 'Hour before which transactions are suspicious' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum amount threshold' }
  ],
  expectedColumns: ['transaction_id', 'transaction_date', 'posting_date', 'amount', 'account_code', 'description', 'posting_hour', 'time_classification'],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    )
    SELECT 
      t.transaction_id,
      t.transaction_date,
      t.posting_date,
      t.amount,
      t.account_code,
      t.description,
      DATEPART(HOUR, t.posting_date) as posting_hour,
      CASE 
        WHEN DATEPART(HOUR, t.posting_date) >= @startHour OR DATEPART(HOUR, t.posting_date) <= @endHour 
        THEN 'After Hours'
        ELSE 'Business Hours'
      END as time_classification
    FROM dbo.transactions t
    INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
    WHERE (DATEPART(HOUR, t.posting_date) >= @startHour OR DATEPART(HOUR, t.posting_date) <= @endHour)
      AND ABS(t.amount) >= @minAmount
      AND DATEPART(WEEKDAY, t.posting_date) NOT IN (1, 7) -- Exclude weekends
    ORDER BY t.posting_date DESC
  `,
  estimatedRuntime: 5,
  estimatedExecutionTime: 5000,
  complexity: 'medium',
  tags: ['after-hours', 'timing-analysis', 'fraud-indicators']
};