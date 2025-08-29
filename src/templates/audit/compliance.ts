import { QueryTemplate } from '../common/types';

export const segregationOfDutiesCheck: QueryTemplate = {
  id: 'audit-segregation-duties',
  name: 'Segregation of Duties Check',
  description: 'Identify users who both create and approve transactions, violating segregation of duties',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum transaction amount to check' },
    { name: 'daysToAnalyze', type: 'number', required: false, defaultValue: 90, description: 'Number of days to analyze' }
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
    UserRoleAnalysis AS (
      SELECT 
        t.transaction_id,
        t.transaction_date,
        t.amount,
        t.account_code,
        t.description,
        t.created_by_user,
        t.approved_by_user,
        t.status,
        CASE 
          WHEN t.created_by_user = t.approved_by_user THEN 'Same User'
          WHEN t.approved_by_user IS NULL THEN 'Not Approved'
          ELSE 'Different Users'
        END as approval_segregation
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE ABS(t.amount) >= @minAmount
        AND t.transaction_date >= DATEADD(DAY, -@daysToAnalyze, GETDATE())
        AND t.created_by_user IS NOT NULL
    ),
    UserViolationSummary AS (
      SELECT 
        ura.created_by_user as user_id,
        COUNT(*) as violation_count,
        SUM(ABS(ura.amount)) as total_violation_amount,
        AVG(ABS(ura.amount)) as avg_violation_amount,
        MAX(ABS(ura.amount)) as max_violation_amount
      FROM UserRoleAnalysis ura
      WHERE ura.approval_segregation = 'Same User'
      GROUP BY ura.created_by_user
    )
    SELECT 
      ura.transaction_id,
      ura.transaction_date,
      ura.amount,
      ura.account_code,
      ura.description,
      ura.created_by_user,
      ura.approved_by_user,
      ura.approval_segregation,
      uvs.violation_count,
      uvs.total_violation_amount,
      CASE 
        WHEN ura.approval_segregation = 'Same User' AND ABS(ura.amount) > 10000 THEN 'Critical Violation'
        WHEN ura.approval_segregation = 'Same User' AND uvs.violation_count > 10 THEN 'Frequent Violator'
        WHEN ura.approval_segregation = 'Same User' THEN 'SOD Violation'
        WHEN ura.approval_segregation = 'Not Approved' AND ABS(ura.amount) > 5000 THEN 'Missing Approval'
        ELSE 'Compliant'
      END as compliance_status
    FROM UserRoleAnalysis ura
    LEFT JOIN UserViolationSummary uvs ON ura.created_by_user = uvs.user_id
    WHERE ura.approval_segregation IN ('Same User', 'Not Approved')
    ORDER BY 
      CASE ura.approval_segregation 
        WHEN 'Same User' THEN 1 
        ELSE 2 
      END,
      ABS(ura.amount) DESC
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'high',
  tags: ['segregation-of-duties', 'compliance', 'internal-controls']
};

export const authorizationLimitChecks: QueryTemplate = {
  id: 'audit-authorization-limits',
  name: 'Authorization Limit Checks',
  description: 'Identify transactions that exceed user authorization limits',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'defaultLimit', type: 'number', required: false, defaultValue: 5000, description: 'Default authorization limit for users without specific limits' },
    { name: 'daysToAnalyze', type: 'number', required: false, defaultValue: 60, description: 'Number of days to analyze' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    UserLimits AS (
      SELECT 
        ul.user_id,
        ul.authorization_limit,
        ul.effective_date,
        ul.expiry_date
      FROM dbo.user_limits ul
      WHERE ul.effective_date <= GETDATE()
        AND (ul.expiry_date IS NULL OR ul.expiry_date >= GETDATE())
    ),
    TransactionAnalysis AS (
      SELECT 
        t.transaction_id,
        t.transaction_date,
        t.amount,
        t.account_code,
        t.description,
        t.created_by_user,
        t.approved_by_user,
        ISNULL(ul.authorization_limit, @defaultLimit) as user_limit,
        CASE 
          WHEN ABS(t.amount) > ISNULL(ul.authorization_limit, @defaultLimit) THEN 'Exceeds Limit'
          ELSE 'Within Limit'
        END as limit_status
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      LEFT JOIN UserLimits ul ON t.created_by_user = ul.user_id
      WHERE t.transaction_date >= DATEADD(DAY, -@daysToAnalyze, GETDATE())
        AND t.created_by_user IS NOT NULL
    )
    SELECT 
      ta.transaction_id,
      ta.transaction_date,
      ta.amount,
      ta.account_code,
      ta.description,
      ta.created_by_user,
      ta.approved_by_user,
      ta.user_limit,
      ta.limit_status,
      ABS(ta.amount) - ta.user_limit as excess_amount,
      CASE 
        WHEN ta.limit_status = 'Exceeds Limit' AND ta.approved_by_user IS NULL THEN 'Unauthorized Excess'
        WHEN ta.limit_status = 'Exceeds Limit' AND ta.approved_by_user = ta.created_by_user THEN 'Self-Approved Excess'
        WHEN ta.limit_status = 'Exceeds Limit' THEN 'Approved Excess'
        ELSE 'Compliant'
      END as authorization_status,
      CASE 
        WHEN ta.limit_status = 'Exceeds Limit' AND ABS(ta.amount) > ta.user_limit * 2 THEN 'High Risk'
        WHEN ta.limit_status = 'Exceeds Limit' THEN 'Medium Risk'
        ELSE 'Low Risk'
      END as risk_level
    FROM TransactionAnalysis ta
    WHERE ta.limit_status = 'Exceeds Limit'
    ORDER BY ABS(ta.amount) DESC
  `,
  estimatedRuntime: 5,
  estimatedExecutionTime: 5000,
  complexity: 'medium',
  tags: ['authorization-limits', 'compliance', 'transaction-controls']
};