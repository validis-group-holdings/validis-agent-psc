import { QueryTemplate } from '../common/types';

export const unusualUserActivity: QueryTemplate = {
  id: 'audit-unusual-user-activity',
  name: 'Unusual User Activity',
  description: 'Identify users with unusual transaction patterns or high activity volumes',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'transactionThreshold', type: 'number', required: false, defaultValue: 100, description: 'Minimum transaction count to flag user' },
    { name: 'amountThreshold', type: 'number', required: false, defaultValue: 50000, description: 'Total amount threshold for flagging' },
    { name: 'days', type: 'number', required: false, defaultValue: 30, description: 'Number of days to analyze' }
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
    UserActivity AS (
      SELECT 
        t.created_by_user,
        COUNT(*) as transaction_count,
        SUM(ABS(t.amount)) as total_amount,
        MIN(t.transaction_date) as first_transaction,
        MAX(t.transaction_date) as last_transaction,
        COUNT(DISTINCT t.account_code) as unique_accounts,
        AVG(ABS(t.amount)) as avg_amount
      FROM dbo.transactions t
      INNER JOIN RecentUpload u ON t.upload_id = u.upload_id
      WHERE t.transaction_date >= DATEADD(DAY, -@days, GETDATE())
        AND t.created_by_user IS NOT NULL
      GROUP BY t.created_by_user
    )
    SELECT 
      ua.*,
      CASE 
        WHEN ua.transaction_count > @transactionThreshold THEN 'High Volume'
        WHEN ua.total_amount > @amountThreshold THEN 'High Value'
        ELSE 'Normal'
      END as risk_level
    FROM UserActivity ua
    WHERE ua.transaction_count > @transactionThreshold 
       OR ua.total_amount > @amountThreshold
    ORDER BY ua.total_amount DESC, ua.transaction_count DESC
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'medium',
  tags: ['user-activity', 'behavioral-analysis', 'volume-analysis']
};

export const userAccessPatterns: QueryTemplate = {
  id: 'audit-user-access-patterns',
  name: 'User Access Patterns',
  description: 'Analyze user login and system access patterns for anomalies',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'days', type: 'number', required: false, defaultValue: 7, description: 'Number of days to analyze' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    UserSessions AS (
      SELECT 
        al.user_id,
        al.login_time,
        al.logout_time,
        al.ip_address,
        al.session_duration_minutes,
        DATEPART(HOUR, al.login_time) as login_hour,
        DATENAME(WEEKDAY, al.login_time) as login_weekday
      FROM dbo.audit_log al
      INNER JOIN RecentUpload u ON al.client_id = @clientId
      WHERE al.login_time >= DATEADD(DAY, -@days, GETDATE())
        AND al.action_type = 'LOGIN'
    )
    SELECT 
      us.user_id,
      COUNT(*) as login_count,
      COUNT(DISTINCT us.ip_address) as unique_ip_count,
      MIN(us.login_hour) as earliest_login_hour,
      MAX(us.login_hour) as latest_login_hour,
      AVG(us.session_duration_minutes) as avg_session_minutes,
      COUNT(CASE WHEN DATEPART(WEEKDAY, us.login_time) IN (1, 7) THEN 1 END) as weekend_logins,
      STRING_AGG(DISTINCT us.ip_address, ', ') as ip_addresses
    FROM UserSessions us
    GROUP BY us.user_id
    HAVING COUNT(DISTINCT us.ip_address) > 1 
        OR COUNT(CASE WHEN DATEPART(WEEKDAY, us.login_time) IN (1, 7) THEN 1 END) > 0
        OR MIN(us.login_hour) < 6 
        OR MAX(us.login_hour) > 22
    ORDER BY unique_ip_count DESC, weekend_logins DESC
  `,
  estimatedRuntime: 4,
  estimatedExecutionTime: 4000,
  complexity: 'medium',
  tags: ['access-patterns', 'security', 'behavioral-analysis']
};