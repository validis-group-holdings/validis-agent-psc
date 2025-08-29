import { QueryTemplate } from '../common/types';

export const accountBalanceReconciliation: QueryTemplate = {
  id: 'audit-balance-reconciliation',
  name: 'Account Balance Reconciliation',
  description: 'Compare account balances between periods to identify discrepancies',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'asOfDate', type: 'date', required: true, description: 'Date to calculate balances as of' },
    { name: 'varianceThreshold', type: 'number', required: false, defaultValue: 1000, description: 'Minimum variance to report' },
    { name: 'accountType', type: 'string', required: false, description: 'Filter by account type (optional)' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    AccountBalances AS (
      SELECT 
        ab.account_code,
        ab.account_name,
        ab.account_type,
        ab.balance_date,
        ab.ending_balance,
        LAG(ab.ending_balance, 1) OVER (PARTITION BY ab.account_code ORDER BY ab.balance_date) as prior_balance,
        ab.ending_balance - LAG(ab.ending_balance, 1) OVER (PARTITION BY ab.account_code ORDER BY ab.balance_date) as balance_change
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE ab.balance_date <= @asOfDate
        AND (@accountType IS NULL OR ab.account_type = @accountType)
    )
    SELECT 
      ab.account_code,
      ab.account_name,
      ab.account_type,
      ab.balance_date,
      ab.ending_balance,
      ab.prior_balance,
      ab.balance_change,
      CASE 
        WHEN ABS(ab.balance_change) > @varianceThreshold THEN 'Significant Change'
        WHEN ab.prior_balance IS NULL THEN 'New Account'
        ELSE 'Normal'
      END as variance_flag
    FROM AccountBalances ab
    WHERE ab.prior_balance IS NOT NULL
      AND ABS(ab.balance_change) > @varianceThreshold
    ORDER BY ABS(ab.balance_change) DESC
  `,
  estimatedRuntime: 5,
  complexity: 'medium',
  tags: ['balance-reconciliation', 'variance-analysis', 'period-comparison']
};

export const negativeBalanceAccounts: QueryTemplate = {
  id: 'audit-negative-balances',
  name: 'Negative Balance Accounts',
  description: 'Identify accounts with unexpected negative balances',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'asOfDate', type: 'date', required: false, description: 'Date to check balances (defaults to latest)' },
    { name: 'excludeAccountTypes', type: 'string', required: false, description: 'Comma-separated account types to exclude' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    LatestBalances AS (
      SELECT 
        ab.account_code,
        ab.account_name,
        ab.account_type,
        ab.balance_date,
        ab.ending_balance,
        ROW_NUMBER() OVER (PARTITION BY ab.account_code ORDER BY ab.balance_date DESC) as rn
      FROM dbo.account_balances ab
      INNER JOIN RecentUpload u ON ab.upload_id = u.upload_id
      WHERE (@asOfDate IS NULL OR ab.balance_date <= @asOfDate)
    )
    SELECT 
      lb.account_code,
      lb.account_name,
      lb.account_type,
      lb.balance_date,
      lb.ending_balance,
      CASE 
        WHEN lb.account_type IN ('Asset', 'Expense') AND lb.ending_balance < 0 THEN 'Unusual Negative'
        WHEN lb.account_type IN ('Liability', 'Equity', 'Revenue') AND lb.ending_balance < 0 THEN 'Review Required'
        ELSE 'Expected Negative'
      END as balance_classification
    FROM LatestBalances lb
    WHERE lb.rn = 1
      AND lb.ending_balance < 0
      AND (@excludeAccountTypes IS NULL OR lb.account_type NOT IN (SELECT TRIM(value) FROM STRING_SPLIT(@excludeAccountTypes, ',')))
    ORDER BY lb.ending_balance ASC
  `,
  estimatedRuntime: 3,
  complexity: 'low',
  tags: ['negative-balances', 'account-analysis', 'balance-validation']
};