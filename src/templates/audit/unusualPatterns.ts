import { QueryTemplate } from '../common/types';

export const duplicateTransactions: QueryTemplate = {
  id: 'audit-duplicate-transactions',
  name: 'Duplicate Transactions',
  description: 'Identify potentially duplicate transactions based on amount, date, and account',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'dayRange', type: 'number', required: false, defaultValue: 1, description: 'Number of days within which to look for duplicates' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 100, description: 'Minimum amount to consider for duplicates' }
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
    PotentialDuplicates AS (
      SELECT 
        t1.transaction_id,
        t1.transaction_date,
        t1.amount,
        t1.account_code,
        t1.description,
        t1.reference_number,
        COUNT(*) OVER (PARTITION BY t1.amount, t1.account_code, CAST(t1.transaction_date AS DATE)) as duplicate_count
      FROM dbo.transactions t1
      INNER JOIN RecentUpload u ON t1.upload_id = u.upload_id
      WHERE ABS(t1.amount) >= @minAmount
    )
    SELECT 
      pd.transaction_id,
      pd.transaction_date,
      pd.amount,
      pd.account_code,
      pd.description,
      pd.reference_number,
      pd.duplicate_count,
      CASE 
        WHEN pd.duplicate_count > 5 THEN 'High Risk'
        WHEN pd.duplicate_count > 2 THEN 'Medium Risk'
        ELSE 'Low Risk'
      END as risk_level
    FROM PotentialDuplicates pd
    WHERE pd.duplicate_count > 1
    ORDER BY pd.duplicate_count DESC, pd.amount DESC
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'medium',
  tags: ['duplicates', 'data-quality', 'fraud-detection']
};

export const benfordsLawAnalysis: QueryTemplate = {
  id: 'audit-benfords-law',
  name: 'Benford\'s Law Analysis',
  description: 'Analyze first digit distribution of transaction amounts for potential manipulation',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minAmount', type: 'number', required: false, defaultValue: 100, description: 'Minimum amount to include in analysis' },
    { name: 'accountCodePattern', type: 'string', required: false, description: 'Account code pattern to filter (e.g., 4% for expense accounts)' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    FirstDigitAnalysis AS (
      SELECT 
        LEFT(CAST(ABS(t.amount) AS VARCHAR), 1) as first_digit,
        COUNT(*) as actual_count,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as actual_percentage
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE ABS(t.amount) >= @minAmount
        AND t.amount <> 0
        AND (@accountCodePattern IS NULL OR t.account_code LIKE @accountCodePattern)
      GROUP BY LEFT(CAST(ABS(t.amount) AS VARCHAR), 1)
    ),
    BenfordsExpected AS (
      SELECT '1' as digit, 30.1 as expected_percentage
      UNION SELECT '2', 17.6
      UNION SELECT '3', 12.5
      UNION SELECT '4', 9.7
      UNION SELECT '5', 7.9
      UNION SELECT '6', 6.7
      UNION SELECT '7', 5.8
      UNION SELECT '8', 5.1
      UNION SELECT '9', 4.6
    )
    SELECT 
      be.digit as first_digit,
      ISNULL(fda.actual_count, 0) as actual_count,
      ISNULL(fda.actual_percentage, 0) as actual_percentage,
      be.expected_percentage,
      ABS(ISNULL(fda.actual_percentage, 0) - be.expected_percentage) as variance,
      CASE 
        WHEN ABS(ISNULL(fda.actual_percentage, 0) - be.expected_percentage) > 5 THEN 'Significant Deviation'
        WHEN ABS(ISNULL(fda.actual_percentage, 0) - be.expected_percentage) > 2 THEN 'Moderate Deviation'
        ELSE 'Within Expected Range'
      END as deviation_level
    FROM BenfordsExpected be
    LEFT JOIN FirstDigitAnalysis fda ON be.digit = fda.first_digit
    ORDER BY be.digit
  `,
  estimatedRuntime: 8,
  estimatedExecutionTime: 8000,
  complexity: 'high',
  tags: ['benfords-law', 'statistical-analysis', 'fraud-detection', 'data-integrity']
};