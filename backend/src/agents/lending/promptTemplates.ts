/**
 * Lending-specific prompt templates for SQL generation
 */

import { DatabaseContext } from '../../services/database-context/contextBuilder';

export const LENDING_SYSTEM_PROMPT = `You are a specialized Lending Agent for generating SQL queries for portfolio-wide financial analysis.

Your expertise includes:
- Asset-based finance opportunities (factoring, ABL)
- Working capital analysis across portfolios
- Cash flow and liquidity assessment
- Revenue growth and profitability trends
- Credit quality and risk assessment
- Portfolio health metrics

Key requirements:
1. ALWAYS generate portfolio-wide queries (multiple companies)
2. Use the latest upload for each company from the last 3 months
3. Filter by client_id for multi-tenant isolation
4. Use uploadId as the primary filter (clustered index)
5. Apply appropriate aggregations for portfolio views
6. Include risk scoring and categorization where relevant

Performance rules:
- Start with upload table to get latest uploadIds
- Use CTEs for pre-aggregation
- Limit results to TOP 5000 or apply pagination
- Use WITH (NOLOCK) for read-only queries
- Avoid functions in WHERE clauses on indexed columns`;

export const LENDING_CHAIN_OF_THOUGHT = `Analyze the query step by step:

1. Identify the lending focus area:
   - Is this about asset finance opportunities?
   - Is this about working capital or cash flow?
   - Is this about growth or profitability?
   - Is this about credit quality or risk?

2. Determine portfolio scope:
   - All companies in the portfolio?
   - Companies meeting specific criteria?
   - Time window (default: last 3 months)?

3. Plan the query structure:
   - Which tables are needed?
   - What aggregations are required?
   - What risk categorizations apply?
   - What performance optimizations are needed?

4. Build the SQL:
   - Start with LatestUploads CTE
   - Add metric calculation CTEs
   - Apply filters and aggregations
   - Include risk scoring/categorization
   - Order by relevance

5. Validate the query:
   - Check for required filters (client_id, uploadId)
   - Verify aggregation logic
   - Ensure performance optimizations
   - Confirm result limiting`;

export function buildLendingPrompt(
  query: string,
  context: DatabaseContext,
  includeSchema: boolean = true
): string {
  let prompt = LENDING_SYSTEM_PROMPT + '\n\n';

  if (includeSchema) {
    prompt += 'DATABASE SCHEMA:\n';
    prompt += '================\n';

    // Include relevant tables for lending queries
    const lendingTables = [
      'upload',
      'saleHeader',
      'saleLine',
      'purchaseHeader',
      'purchaseLine',
      'transactionHeader',
      'transactionLine',
      'trialBalance',
      'saleAged',
      'purchaseAged'
    ];

    for (const tableName of lendingTables) {
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
      }
    }

    prompt += '\n';
  }

  prompt += 'CRITICAL PERFORMANCE NOTES:\n';
  prompt += '===========================\n';
  context.criticalPerformanceNotes.forEach(note => {
    prompt += `- ${note}\n`;
  });
  prompt += '\n';

  prompt += 'LENDING-SPECIFIC PATTERNS:\n';
  prompt += '==========================\n';
  prompt += `
1. Portfolio Analysis Pattern:
   WITH LatestUploads AS (
     SELECT sme_id, company_name, MAX(upload_id) as latest_upload_id
     FROM upload
     WHERE client_id = @clientId AND upload_date >= DATEADD(month, -3, GETDATE())
     GROUP BY sme_id, company_name
   )

2. Asset Finance Opportunity Pattern:
   - Calculate AR balances and quality metrics
   - Filter for minimum thresholds (e.g., £100k AR)
   - Include DSO, aging, customer concentration
   - Rank by opportunity size and quality

3. Working Capital Pattern:
   - Calculate current assets/liabilities
   - Compute working capital metrics (current ratio, quick ratio)
   - Identify cash conversion cycle
   - Flag companies with strain

4. Revenue Growth Pattern:
   - Compare current vs prior period revenues
   - Calculate growth rates and volatility
   - Identify high-growth opportunities
   - Consider seasonality

5. Risk Scoring Pattern:
   - Use CASE statements for categorization
   - Consider multiple risk factors
   - Apply weighted scoring where appropriate
   - Include both quantitative and qualitative factors
`;

  prompt += '\n\nCHAIN OF THOUGHT:\n';
  prompt += '=================\n';
  prompt += LENDING_CHAIN_OF_THOUGHT;

  prompt += '\n\nUSER QUERY:\n';
  prompt += '===========\n';
  prompt += query;

  prompt += '\n\nGenerate a SQL query that answers this lending/portfolio question. ';
  prompt += 'Include your reasoning process and explain the query logic.\n';

  return prompt;
}

export const LENDING_VALIDATION_PROMPT = `
Validate this SQL query for a lending/portfolio analysis:

Check for:
1. Multi-tenant isolation (client_id filter)
2. Portfolio scope (multiple companies, not single)
3. Use of latest uploads (3-month window)
4. Proper aggregation for portfolio view
5. Performance optimizations (uploadId filtering, CTEs)
6. Result limiting (TOP or pagination)
7. Risk categorization where applicable
8. Correct table joins and relationships

SQL Query:
{sql}

Respond with:
- isValid: boolean
- errors: array of critical issues
- warnings: array of potential improvements
- performanceScore: 1-10
`;

export const LENDING_EXPLANATION_TEMPLATE = `
This lending query analyzes {focusArea} across your portfolio of {companyCount} companies.

Key aspects:
- Scope: {scope}
- Time window: {timeWindow}
- Aggregation: {aggregationType}
- Risk factors: {riskFactors}

The query:
1. {step1}
2. {step2}
3. {step3}
4. {step4}

Performance optimizations:
- {optimization1}
- {optimization2}

Expected results: {expectedResults}
`;
