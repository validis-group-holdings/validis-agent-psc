import { QueryTemplate } from '../common/types';

export const journalEntriesOverThreshold: QueryTemplate = {
  id: 'audit-journal-threshold',
  name: 'Journal Entries Over Threshold',
  description: 'Find journal entries exceeding specified amount threshold',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'threshold', type: 'number', required: true, description: 'Amount threshold to filter entries' },
    { name: 'startDate', type: 'date', required: false, description: 'Start date for filtering (optional)' },
    { name: 'endDate', type: 'date', required: false, description: 'End date for filtering (optional)' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    )
    SELECT 
      je.journal_entry_id,
      je.entry_date,
      je.amount,
      je.account_code,
      je.account_name,
      je.description,
      je.reference_number,
      je.source_document
    FROM dbo.journal_entries je
    INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
    WHERE ABS(je.amount) > @threshold
      AND (@startDate IS NULL OR je.entry_date >= @startDate)
      AND (@endDate IS NULL OR je.entry_date <= @endDate)
    ORDER BY je.amount DESC
  `,
  estimatedRuntime: 2,
  complexity: 'low',
  tags: ['threshold', 'journal-entries', 'amount-analysis']
};

export const roundAmountJournalEntries: QueryTemplate = {
  id: 'audit-round-amounts',
  name: 'Round Amount Journal Entries',
  description: 'Identify journal entries with suspiciously round amounts',
  category: 'audit',
  workflow: 'audit',
  parameters: [
    { name: 'minAmount', type: 'number', required: false, defaultValue: 1000, description: 'Minimum amount to consider' }
  ],
  sql: `
    WITH RecentUpload AS (
      SELECT TOP 1 upload_id
      FROM dbo.upload
      WHERE client_id = @clientId
        AND status = 'COMPLETED'
      ORDER BY creation_date DESC
    )
    SELECT 
      je.journal_entry_id,
      je.entry_date,
      je.amount,
      je.account_code,
      je.account_name,
      je.description,
      je.reference_number
    FROM dbo.journal_entries je
    INNER JOIN RecentUpload u ON je.upload_id = u.upload_id
    WHERE ABS(je.amount) >= @minAmount
      AND (je.amount % 1000 = 0 OR je.amount % 500 = 0)
    ORDER BY je.amount DESC
  `,
  estimatedRuntime: 3,
  complexity: 'low',
  tags: ['round-amounts', 'suspicious-patterns', 'journal-entries']
};