/**
 * Audit-specific prompt templates for SQL generation
 */

import { DatabaseContext } from '../../services/database-context/contextBuilder';

export const AUDIT_SYSTEM_PROMPT = `You are a specialized Audit Agent for generating SQL queries for company-specific financial analysis and compliance testing.

Your expertise includes:
- Variance analysis and anomaly detection
- Transaction testing and sampling
- Accounts receivable/payable aging analysis
- Journal entry review and testing
- Cutoff testing and period-end procedures
- Duplicate payment detection
- Compliance and control testing
- Detailed transaction analysis

Key requirements:
1. ALWAYS generate company-specific queries (single company focus)
2. Use the latest uploadId for the specified company
3. Filter by client_id AND company_name for precise targeting
4. Use uploadId as the primary filter (clustered index)
5. Include detailed transaction-level information
6. Apply audit risk categorization where relevant
7. Consider materiality thresholds

Performance rules:
- First get the latest upload_id for the company
- Use uploadId for all transaction table joins
- Apply materiality filters early in the query
- Use EXISTS instead of IN for subqueries
- Include relevant audit trails (created_by, created_date)`;

export const AUDIT_CHAIN_OF_THOUGHT = `Analyze the audit query step by step:

1. Identify the audit focus area:
   - Is this variance analysis?
   - Is this transaction testing?
   - Is this aging analysis?
   - Is this control testing?
   - Is this compliance checking?

2. Determine company scope:
   - Which specific company?
   - Latest upload or specific period?
   - What materiality threshold applies?

3. Plan the query structure:
   - First CTE: Get latest upload for company
   - Additional CTEs: Calculate comparisons/metrics
   - Main query: Detailed results with risk flags
   - What audit evidence is needed?

4. Build the SQL:
   - Start with company upload identification
   - Join transaction tables via uploadId
   - Apply audit-specific filters
   - Include risk categorization
   - Add audit trail information

5. Validate the query:
   - Check for company-specific filtering
   - Verify uploadId usage
   - Ensure audit completeness
   - Confirm materiality application
   - Review risk categorization logic`;

export function buildAuditPrompt(
  query: string,
  companyName: string,
  context: DatabaseContext,
  includeSchema: boolean = true
): string {
  let prompt = AUDIT_SYSTEM_PROMPT + '\n\n';

  prompt += `COMPANY CONTEXT:\n`;
  prompt += `================\n`;
  prompt += `Company Name: ${companyName}\n`;
  prompt += `Query Focus: Company-specific audit analysis\n\n`;

  if (includeSchema) {
    prompt += 'DATABASE SCHEMA:\n';
    prompt += '================\n';

    // Include relevant tables for audit queries
    const auditTables = [
      'upload',
      'transactionHeader',
      'transactionLine',
      'saleHeader',
      'saleLine',
      'purchaseHeader',
      'purchaseLine',
      'trialBalance',
      'saleAged',
      'purchaseAged',
      'financialPeriod'
    ];

    for (const tableName of auditTables) {
      const fullTableName = Object.keys(context.tables).find(t =>
        t.toLowerCase().includes(tableName.toLowerCase())
      );

      if (fullTableName && context.tables[fullTableName]) {
        const table = context.tables[fullTableName];
        prompt += `\nTable: ${fullTableName}\n`;
        prompt += `Description: ${table.description}\n`;
        prompt += 'Columns:\n';

        for (const col of table.columns) {
          prompt += `  - ${col.name} (${col.type}${col.nullable ? ', nullable' : ''})`;
          if (col.description) prompt += `: ${col.description}`;
          prompt += '\n';
        }

        if (table.indexes && table.indexes.length > 0) {
          const clustered = table.indexes.find(idx => idx.isClustered);
          if (clustered) {
            prompt += `Clustered Index: ${clustered.columns.join(', ')}\n`;
          }
        }

        // Include audit-relevant columns
        const auditColumns = ['created_date', 'created_by', 'modified_date', 'modified_by', 'entry_type'];
        const hasAuditColumns = table.columns.filter(c =>
          auditColumns.includes(c.name.toLowerCase())
        );
        if (hasAuditColumns.length > 0) {
          prompt += `Audit Trail Columns: ${hasAuditColumns.map(c => c.name).join(', ')}\n`;
        }
      }
    }

    prompt += '\n';
  }

  prompt += 'CRITICAL AUDIT NOTES:\n';
  prompt += '=====================\n';
  prompt += `- ALWAYS filter by company_name = '${companyName}' (exact match)\n`;
  prompt += '- Use latest upload_id unless historical analysis requested\n';
  prompt += '- Include audit trail fields (created_by, created_date) for journal entries\n';
  prompt += '- Apply materiality thresholds based on company size\n';
  prompt += '- Flag high-risk transactions with clear categorization\n';
  prompt += '- Consider entry_type for manual vs system entries\n\n';

  prompt += 'AUDIT-SPECIFIC PATTERNS:\n';
  prompt += '========================\n';
  prompt += `
1. Company Upload Pattern:
   WITH CompanyUpload AS (
     SELECT TOP 1 upload_id, company_name
     FROM upload
     WHERE client_id = @clientId
       AND LOWER(company_name) = LOWER(@companyName)
     ORDER BY upload_date DESC
   )

2. Variance Analysis Pattern:
   - Compare current period to prior period averages
   - Calculate percentage and absolute variances
   - Flag items exceeding threshold (e.g., 10%)
   - Include transaction details for investigation

3. Aging Analysis Pattern:
   - Calculate days outstanding from due_date
   - Bucket into standard aging categories
   - Identify concentration risks
   - Calculate provision requirements

4. Journal Entry Testing Pattern:
   - Focus on manual and adjustment entries
   - Check for weekend/after-hours entries
   - Identify round amounts
   - Review high-value or unusual account combinations

5. Cutoff Testing Pattern:
   - Compare transaction date to period end
   - Check delivery/performance dates
   - Identify potential cutoff errors
   - Focus on days near period end

6. Duplicate Detection Pattern:
   - Group by key fields (supplier, amount, date)
   - Count occurrences
   - Calculate potential overpayment
   - Consider timing differences
`;

  prompt += '\n\nCHAIN OF THOUGHT:\n';
  prompt += '=================\n';
  prompt += AUDIT_CHAIN_OF_THOUGHT;

  prompt += '\n\nUSER QUERY:\n';
  prompt += '===========\n';
  prompt += query;

  prompt += '\n\nGenerate a SQL query for this audit analysis of ' + companyName + '. ';
  prompt += 'Include your reasoning process and explain the audit logic.\n';

  return prompt;
}

export const AUDIT_VALIDATION_PROMPT = `
Validate this SQL query for audit analysis:

Check for:
1. Company-specific filtering (company_name filter)
2. Multi-tenant isolation (client_id filter)
3. Use of latest upload_id or appropriate period
4. Inclusion of audit trail fields where relevant
5. Materiality thresholds applied
6. Risk categorization logic
7. Performance optimizations (uploadId filtering)
8. Appropriate detail level for audit evidence

SQL Query:
{sql}

Respond with:
- isValid: boolean
- errors: array of critical issues
- warnings: array of potential improvements
- auditCompleteness: assessment of audit coverage
- performanceScore: 1-10
`;

export const AUDIT_EXPLANATION_TEMPLATE = `
This audit query analyzes {focusArea} for {companyName}.

Audit objective:
{auditObjective}

Key aspects:
- Scope: {scope}
- Period: {period}
- Materiality: {materiality}
- Risk factors: {riskFactors}

The query:
1. {step1}
2. {step2}
3. {step3}
4. {step4}

Audit evidence provided:
- {evidence1}
- {evidence2}
- {evidence3}

Risk indicators:
{riskIndicators}

Expected findings: {expectedFindings}
`;

export const AUDIT_RISK_PATTERNS = {
  high: [
    'Manual journal entries near period end',
    'Round amounts over materiality threshold',
    'Weekend or after-hours entries',
    'Transactions with missing documentation',
    'Duplicate payments identified',
    'Receivables over 120 days',
    'Significant unexplained variances',
    'Related party transactions'
  ],
  medium: [
    'Variances between 10-25%',
    'Aging between 60-120 days',
    'Manual adjustments',
    'Concentration risk identified',
    'Near-cutoff transactions',
    'Unusual account combinations'
  ],
  low: [
    'System-generated entries',
    'Variances under 10%',
    'Current receivables',
    'Documented adjustments',
    'Standard recurring transactions'
  ]
};
