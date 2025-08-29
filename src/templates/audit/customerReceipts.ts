import { QueryTemplate } from '../common/types';

export const largeCustomerReceipts: QueryTemplate = {
  id: 'audit-large-customer-receipts',
  name: 'Large Customer Receipts',
  description: 'Identify unusually large receipts from customers',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'amountThreshold', type: 'number', required: true, description: 'Minimum receipt amount to flag' },
    { name: 'periodDays', type: 'number', required: false, defaultValue: 90, description: 'Number of days to analyze' },
    { name: 'customerPattern', type: 'string', required: false, description: 'Customer name pattern to filter' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CustomerReceiptStats AS (
      SELECT 
        cr.customer_id,
        cr.customer_name,
        COUNT(*) as receipt_count,
        SUM(cr.receipt_amount) as total_receipts,
        AVG(cr.receipt_amount) as avg_receipt,
        STDEV(cr.receipt_amount) as std_dev_receipt
      FROM dbo.customer_receipts cr
      INNER JOIN RecentUpload u ON cr.upload_id = u.upload_id
      WHERE cr.receipt_date >= DATEADD(DAY, -@periodDays, GETDATE())
        AND (@customerPattern IS NULL OR cr.customer_name LIKE @customerPattern)
      GROUP BY cr.customer_id, cr.customer_name
      HAVING COUNT(*) >= 3
    )
    SELECT 
      cr.receipt_id,
      cr.receipt_date,
      cr.customer_id,
      cr.customer_name,
      cr.receipt_amount,
      cr.payment_method,
      cr.invoice_number,
      cr.description,
      crs.avg_receipt,
      crs.std_dev_receipt,
      CASE 
        WHEN crs.std_dev_receipt > 0 
        THEN (cr.receipt_amount - crs.avg_receipt) / crs.std_dev_receipt 
        ELSE 0 
      END as z_score,
      CASE 
        WHEN cr.receipt_amount >= @amountThreshold THEN 'Exceeds Threshold'
        WHEN crs.std_dev_receipt > 0 AND ABS((cr.receipt_amount - crs.avg_receipt) / crs.std_dev_receipt) > 2 THEN 'Statistical Outlier'
        ELSE 'Normal'
      END as anomaly_type
    FROM dbo.customer_receipts cr
    INNER JOIN RecentUpload u ON cr.upload_id = u.upload_id
    INNER JOIN CustomerReceiptStats crs ON cr.customer_id = crs.customer_id
    WHERE cr.receipt_date >= DATEADD(DAY, -@periodDays, GETDATE())
      AND (cr.receipt_amount >= @amountThreshold 
           OR (crs.std_dev_receipt > 0 AND ABS((cr.receipt_amount - crs.avg_receipt) / crs.std_dev_receipt) > 2))
    ORDER BY cr.receipt_amount DESC
  `,
  estimatedRuntime: 6,
  complexity: 'high',
  tags: ['customer-receipts', 'large-amounts', 'outlier-detection']
};

export const creditBalanceCustomers: QueryTemplate = {
  id: 'audit-credit-balance-customers',
  name: 'Credit Balance Customers',
  description: 'Identify customers with unusual credit balances that may indicate overpayments',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minCreditAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum credit balance to flag' },
    { name: 'daysOld', type: 'number', required: false, defaultValue: 30, description: 'Minimum age of credit balance' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    ),
    CustomerBalances AS (
      SELECT 
        cb.customer_id,
        cb.customer_name,
        cb.balance_date,
        cb.current_balance,
        cb.credit_limit,
        DATEDIFF(DAY, cb.balance_date, GETDATE()) as days_outstanding,
        ROW_NUMBER() OVER (PARTITION BY cb.customer_id ORDER BY cb.balance_date DESC) as rn
      FROM dbo.customer_balances cb
      INNER JOIN RecentUpload u ON cb.upload_id = u.upload_id
      WHERE cb.current_balance < 0 -- Credit balances are negative
    ),
    RecentTransactions AS (
      SELECT 
        cr.customer_id,
        MAX(cr.receipt_date) as last_transaction_date,
        COUNT(*) as recent_transaction_count
      FROM dbo.customer_receipts cr
      INNER JOIN RecentUpload u ON cr.upload_id = u.upload_id
      WHERE cr.receipt_date >= DATEADD(DAY, -@daysOld, GETDATE())
      GROUP BY cr.customer_id
    )
    SELECT 
      cb.customer_id,
      cb.customer_name,
      cb.balance_date,
      cb.current_balance,
      ABS(cb.current_balance) as credit_amount,
      cb.credit_limit,
      cb.days_outstanding,
      ISNULL(rt.last_transaction_date, '1900-01-01') as last_transaction_date,
      ISNULL(rt.recent_transaction_count, 0) as recent_transaction_count,
      CASE 
        WHEN ABS(cb.current_balance) >= @minCreditAmount AND cb.days_outstanding >= @daysOld THEN 'High Priority'
        WHEN ABS(cb.current_balance) >= @minCreditAmount THEN 'Medium Priority'
        WHEN cb.days_outstanding >= @daysOld THEN 'Age Review'
        ELSE 'Normal'
      END as review_priority
    FROM CustomerBalances cb
    LEFT JOIN RecentTransactions rt ON cb.customer_id = rt.customer_id
    WHERE cb.rn = 1 -- Most recent balance
      AND ABS(cb.current_balance) >= @minCreditAmount
      AND cb.days_outstanding >= @daysOld
    ORDER BY ABS(cb.current_balance) DESC
  `,
  estimatedRuntime: 5,
  complexity: 'medium',
  tags: ['credit-balances', 'customer-analysis', 'overpayments']
};