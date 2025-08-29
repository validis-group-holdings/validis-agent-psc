import { QueryTemplate } from '../common/types';

export const largeVendorPayments: QueryTemplate = {
  id: 'audit-large-vendor-payments',
  name: 'Large Vendor Payments',
  description: 'Identify unusually large payments to vendors',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'amountThreshold', type: 'number', required: true, description: 'Minimum payment amount to flag' },
    { name: 'periodDays', type: 'number', required: false, defaultValue: 90, description: 'Number of days to analyze' },
    { name: 'vendorPattern', type: 'string', required: false, description: 'Vendor name pattern to filter' }
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
    VendorPaymentStats AS (
      SELECT 
        vp.vendor_id,
        vp.vendor_name,
        COUNT(*) as payment_count,
        SUM(vp.payment_amount) as total_payments,
        AVG(vp.payment_amount) as avg_payment,
        MIN(vp.payment_amount) as min_payment,
        MAX(vp.payment_amount) as max_payment,
        STDEV(vp.payment_amount) as std_dev_payment
      FROM dbo.vendor_payments vp
      INNER JOIN RecentUpload u ON vp.upload_id = u.upload_id
      WHERE vp.payment_date >= DATEADD(DAY, -@periodDays, GETDATE())
        AND (@vendorPattern IS NULL OR vp.vendor_name LIKE @vendorPattern)
      GROUP BY vp.vendor_id, vp.vendor_name
      HAVING COUNT(*) >= 3 -- Need at least 3 payments for meaningful stats
    )
    SELECT 
      vp.payment_id,
      vp.payment_date,
      vp.vendor_id,
      vp.vendor_name,
      vp.payment_amount,
      vp.payment_method,
      vp.invoice_number,
      vp.description,
      vps.avg_payment,
      vps.std_dev_payment,
      CASE 
        WHEN vps.std_dev_payment > 0 
        THEN (vp.payment_amount - vps.avg_payment) / vps.std_dev_payment 
        ELSE 0 
      END as z_score,
      CASE 
        WHEN vp.payment_amount >= @amountThreshold THEN 'Exceeds Threshold'
        WHEN vps.std_dev_payment > 0 AND ABS((vp.payment_amount - vps.avg_payment) / vps.std_dev_payment) > 2 THEN 'Statistical Outlier'
        ELSE 'Normal'
      END as anomaly_type
    FROM dbo.vendor_payments vp
    INNER JOIN RecentUpload u ON vp.upload_id = u.upload_id
    INNER JOIN VendorPaymentStats vps ON vp.vendor_id = vps.vendor_id
    WHERE vp.payment_date >= DATEADD(DAY, -@periodDays, GETDATE())
      AND (vp.payment_amount >= @amountThreshold 
           OR (vps.std_dev_payment > 0 AND ABS((vp.payment_amount - vps.avg_payment) / vps.std_dev_payment) > 2))
    ORDER BY vp.payment_amount DESC
  `,
  estimatedRuntime: 7,
  estimatedExecutionTime: 7000,
  complexity: 'high',
  tags: ['vendor-payments', 'outlier-detection', 'large-amounts']
};

export const duplicateVendorPayments: QueryTemplate = {
  id: 'audit-duplicate-vendor-payments',
  name: 'Duplicate Vendor Payments',
  description: 'Find potential duplicate payments to the same vendor',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'dayWindow', type: 'number', required: false, defaultValue: 7, description: 'Days within which to look for duplicates' },
    { name: 'minAmount', type: 'number', required: false, defaultValue: 500, description: 'Minimum amount to consider' }
  ],
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
        vp1.payment_id,
        vp1.payment_date,
        vp1.vendor_id,
        vp1.vendor_name,
        vp1.payment_amount,
        vp1.invoice_number,
        vp1.description,
        COUNT(vp2.payment_id) as potential_duplicate_count
      FROM dbo.vendor_payments vp1
      INNER JOIN RecentUpload u ON vp1.upload_id = u.upload_id
      LEFT JOIN dbo.vendor_payments vp2 ON vp1.vendor_id = vp2.vendor_id
        AND vp1.payment_amount = vp2.payment_amount
        AND vp1.payment_id <> vp2.payment_id
        AND ABS(DATEDIFF(DAY, vp1.payment_date, vp2.payment_date)) <= @dayWindow
        AND vp2.upload_id = u.upload_id
      WHERE vp1.payment_amount >= @minAmount
      GROUP BY vp1.payment_id, vp1.payment_date, vp1.vendor_id, vp1.vendor_name, 
               vp1.payment_amount, vp1.invoice_number, vp1.description
    )
    SELECT 
      pd.*,
      CASE 
        WHEN pd.potential_duplicate_count > 2 THEN 'High Risk'
        WHEN pd.potential_duplicate_count > 0 THEN 'Medium Risk'
        ELSE 'Low Risk'
      END as duplicate_risk_level
    FROM PotentialDuplicates pd
    WHERE pd.potential_duplicate_count > 0
    ORDER BY pd.potential_duplicate_count DESC, pd.payment_amount DESC
  `,
  estimatedRuntime: 6,
  estimatedExecutionTime: 6000,
  complexity: 'medium',
  tags: ['duplicate-payments', 'vendor-analysis', 'data-quality']
};