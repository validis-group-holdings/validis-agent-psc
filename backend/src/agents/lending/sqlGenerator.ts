/**
 * SQL generation for portfolio-wide lending queries
 */

import {
  LendingQueryRequest,
  LendingQueryResponse,
  LendingContext,
  LendingFocusArea,
  SQLValidationResult,
  QueryTemplate
} from './types';
import { DatabaseContext } from '../../services/database-context/contextBuilder';
import { getSampleQueries } from '../../services/database-context/sampleQueries';

export class LendingSQLGenerator {
  private context: DatabaseContext;
  private templates: Map<string, QueryTemplate>;

  constructor(context: DatabaseContext) {
    this.context = context;
    this.templates = this.loadTemplates();
  }

  /**
   * Generate SQL from natural language query
   */
  async generateSQL(request: LendingQueryRequest): Promise<LendingQueryResponse> {
    // Analyze the query to determine context
    const lendingContext = this.analyzeQuery(request.naturalLanguageQuery);

    // Find matching template or build custom query
    const template = this.findBestTemplate(request.naturalLanguageQuery, lendingContext);

    let sql: string;
    let explanation: string = '';
    let confidence: number;

    if (template) {
      // Adapt template to specific request
      sql = this.adaptTemplate(template, request, lendingContext);
      confidence = 0.9; // High confidence when using template

      if (request.includeExplanation) {
        explanation = this.explainTemplateQuery(template, lendingContext);
      }
    } else {
      // Build custom query using patterns
      sql = this.buildCustomQuery(request, lendingContext);
      confidence = 0.75; // Moderate confidence for custom queries

      if (request.includeExplanation) {
        explanation = this.explainCustomQuery(lendingContext);
      }
    }

    // Validate the generated SQL
    const validation = await this.validateSQL(sql);

    if (!validation.isValid) {
      // Attempt to fix common issues
      sql = this.attemptAutoFix(sql, validation);
      confidence *= 0.8; // Reduce confidence after fixes
    }

    // Determine involved tables and expected columns
    const { tables, columns } = this.extractTableAndColumnInfo(sql);

    return {
      sql,
      explanation,
      confidence,
      queryType: lendingContext.isPortfolioQuery ? 'portfolio' : 'analysis',
      involvedTables: tables,
      expectedColumns: columns,
      performanceNotes: this.getPerformanceNotes(sql, lendingContext),
      warnings: validation.warnings
    };
  }

  /**
   * Analyze query to determine lending context
   */
  private analyzeQuery(query: string): LendingContext {
    const lowerQuery = query.toLowerCase();

    // Determine focus areas
    const focusAreas: LendingFocusArea[] = [];

    if (lowerQuery.includes('asset') || lowerQuery.includes('finance') ||
        lowerQuery.includes('factor') || lowerQuery.includes('abl')) {
      focusAreas.push('asset_finance');
    }

    if (lowerQuery.includes('working capital') || lowerQuery.includes('liquidity') ||
        lowerQuery.includes('current ratio')) {
      focusAreas.push('working_capital');
    }

    if (lowerQuery.includes('cash') || lowerQuery.includes('burn') ||
        lowerQuery.includes('runway')) {
      focusAreas.push('cash_flow');
    }

    if (lowerQuery.includes('revenue') || lowerQuery.includes('growth') ||
        lowerQuery.includes('sales')) {
      focusAreas.push('revenue_growth');
    }

    if (lowerQuery.includes('credit') || lowerQuery.includes('risk') ||
        lowerQuery.includes('quality')) {
      focusAreas.push('credit_quality');
    }

    if (lowerQuery.includes('portfolio') || lowerQuery.includes('all companies') ||
        lowerQuery.includes('across')) {
      focusAreas.push('portfolio_health');
    }

    // Determine timeframe
    let timeframe: 'current' | '3months' | '12months' | 'custom' = '3months';
    if (lowerQuery.includes('current') || lowerQuery.includes('latest')) {
      timeframe = 'current';
    } else if (lowerQuery.includes('year') || lowerQuery.includes('annual') ||
               lowerQuery.includes('12 month')) {
      timeframe = '12months';
    }

    // Check if it's truly a portfolio query
    const isPortfolioQuery = !lowerQuery.includes('single company') &&
                            !lowerQuery.includes('specific company');

    // Check if aggregation is needed
    const requiresAggregation = lowerQuery.includes('total') ||
                                lowerQuery.includes('average') ||
                                lowerQuery.includes('sum') ||
                                lowerQuery.includes('top') ||
                                lowerQuery.includes('rank');

    return {
      isPortfolioQuery,
      requiresAggregation,
      timeframe,
      focusAreas: focusAreas.length > 0 ? focusAreas : ['portfolio_health']
    };
  }

  /**
   * Find best matching template
   */
  private findBestTemplate(query: string, context: LendingContext): QueryTemplate | null {
    const lowerQuery = query.toLowerCase();

    // Get lending templates from sample queries
    const lendingQueries = getSampleQueries().lending;

    // Score each template
    let bestMatch: any = null;
    let bestScore = 0;

    for (const template of lendingQueries) {
      let score = 0;

      // Check if natural language example matches
      const exampleWords = template.naturalLanguageExample.toLowerCase().split(' ');
      const queryWords = lowerQuery.split(' ');

      for (const word of queryWords) {
        if (exampleWords.includes(word)) {
          score += 1;
        }
      }

      // Bonus for matching focus area
      if (context.focusAreas.some(area => template.id.includes(area))) {
        score += 5;
      }

      // Bonus for exact phrase matches
      if (lowerQuery.includes('top') && template.id.includes('top')) {
        score += 3;
      }
      if (lowerQuery.includes('aging') && template.id.includes('aging')) {
        score += 3;
      }
      if (lowerQuery.includes('cash') && template.id.includes('cash')) {
        score += 3;
      }
      if (lowerQuery.includes('working capital') && template.id.includes('working-capital')) {
        score += 4;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }

    // Return template if score is high enough
    return bestScore >= 5 ? bestMatch : null;
  }

  /**
   * Adapt template to specific request
   */
  private adaptTemplate(
    template: any,
    request: LendingQueryRequest,
    context: LendingContext
  ): string {
    let sql = template.sqlTemplate;

    // Replace parameters
    sql = sql.replace(/@clientId/g, `'${request.clientId}'`);

    // Add any custom parameters
    if (request.parameters) {
      for (const [key, value] of Object.entries(request.parameters)) {
        const paramPattern = new RegExp(`@${key}`, 'g');
        if (typeof value === 'string') {
          sql = sql.replace(paramPattern, `'${value}'`);
        } else {
          sql = sql.replace(paramPattern, value.toString());
        }
      }
    }

    // Apply result limiting if specified
    if (request.maxResults && !sql.includes('TOP')) {
      sql = sql.replace(/SELECT(\s+)/i, `SELECT TOP ${request.maxResults}$1`);
    }

    // Adjust timeframe if needed
    if (context.timeframe === '12months' && sql.includes('-3, GETDATE()')) {
      sql = sql.replace(/-3, GETDATE\(\)/g, '-12, GETDATE()');
    }

    return sql;
  }

  /**
   * Build custom query when no template matches
   */
  private buildCustomQuery(request: LendingQueryRequest, context: LendingContext): string {
    const focusArea = context.focusAreas[0] || 'portfolio_health';

    // Start with base structure
    let sql = `-- Portfolio-wide ${focusArea} analysis\n`;
    sql += `WITH LatestUploads AS (\n`;
    sql += `  SELECT\n`;
    sql += `    sme_id,\n`;
    sql += `    company_name,\n`;
    sql += `    MAX(upload_id) as latest_upload_id\n`;
    sql += `  FROM upload\n`;
    sql += `  WHERE client_id = '${request.clientId}'\n`;

    // Add timeframe filter
    if (context.timeframe === '3months') {
      sql += `    AND upload_date >= DATEADD(month, -3, GETDATE())\n`;
    } else if (context.timeframe === '12months') {
      sql += `    AND upload_date >= DATEADD(month, -12, GETDATE())\n`;
    }

    sql += `  GROUP BY sme_id, company_name\n`;
    sql += `)\n`;

    // Add focus-specific CTEs
    switch (focusArea) {
      case 'asset_finance':
        sql += this.buildAssetFinanceCTE();
        break;
      case 'working_capital':
        sql += this.buildWorkingCapitalCTE();
        break;
      case 'cash_flow':
        sql += this.buildCashFlowCTE();
        break;
      case 'revenue_growth':
        sql += this.buildRevenueGrowthCTE();
        break;
      default:
        sql += this.buildGeneralMetricsCTE();
    }

    // Add final SELECT with limiting
    const maxResults = request.maxResults || 100;
    sql += `SELECT TOP ${maxResults}\n`;
    sql += this.buildSelectColumns(focusArea);
    sql += `FROM LatestUploads u\n`;
    sql += this.buildJoinClauses(focusArea);
    sql += this.buildWhereClause(focusArea);
    sql += this.buildOrderByClause(focusArea);

    return sql;
  }

  /**
   * Build Asset Finance CTE
   */
  private buildAssetFinanceCTE(): string {
    return `,
ARMetrics AS (
  SELECT
    u.sme_id,
    u.company_name,
    SUM(sh.outstanding_amount) as ar_balance,
    COUNT(DISTINCT sh.customer_id) as customer_count,
    AVG(DATEDIFF(day, sh.invoice_date, GETDATE())) as avg_days_outstanding
  FROM LatestUploads u
  INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
  WHERE sh.status = 'Open'
  GROUP BY u.sme_id, u.company_name
)
`;
  }

  /**
   * Build Working Capital CTE
   */
  private buildWorkingCapitalCTE(): string {
    return `,
WorkingCapitalMetrics AS (
  SELECT
    u.company_name,
    SUM(CASE WHEN tb.account_type = 'Current Asset' THEN tb.balance ELSE 0 END) as current_assets,
    SUM(CASE WHEN tb.account_type = 'Current Liability' THEN tb.balance ELSE 0 END) as current_liabilities
  FROM LatestUploads u
  INNER JOIN trialBalance tb ON tb.uploadId = u.latest_upload_id
  GROUP BY u.company_name
)
`;
  }

  /**
   * Build Cash Flow CTE
   */
  private buildCashFlowCTE(): string {
    return `,
CashMetrics AS (
  SELECT
    u.company_name,
    SUM(CASE WHEN tb.account_code LIKE 'CASH%' OR tb.account_code LIKE 'BANK%' THEN tb.balance ELSE 0 END) as cash_balance
  FROM LatestUploads u
  INNER JOIN trialBalance tb ON tb.uploadId = u.latest_upload_id
  GROUP BY u.company_name
)
`;
  }

  /**
   * Build Revenue Growth CTE
   */
  private buildRevenueGrowthCTE(): string {
    return `,
RevenueMetrics AS (
  SELECT
    u.company_name,
    SUM(sh.gross_amount) as total_revenue,
    COUNT(DISTINCT sh.invoice_number) as invoice_count
  FROM LatestUploads u
  INNER JOIN saleHeader sh ON sh.uploadId = u.latest_upload_id
  WHERE sh.invoice_date >= DATEADD(month, -12, GETDATE())
  GROUP BY u.company_name
)
`;
  }

  /**
   * Build General Metrics CTE
   */
  private buildGeneralMetricsCTE(): string {
    return `,
GeneralMetrics AS (
  SELECT
    u.company_name,
    COUNT(DISTINCT th.transaction_id) as transaction_count,
    SUM(ABS(tl.amount)) as total_activity
  FROM LatestUploads u
  INNER JOIN transactionHeader th ON th.uploadId = u.latest_upload_id
  INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
  GROUP BY u.company_name
)
`;
  }

  /**
   * Build SELECT columns based on focus area
   */
  private buildSelectColumns(focusArea: string): string {
    switch (focusArea) {
      case 'asset_finance':
        return `  arm.company_name,
  arm.ar_balance,
  arm.customer_count,
  arm.avg_days_outstanding\n`;
      case 'working_capital':
        return `  wcm.company_name,
  wcm.current_assets,
  wcm.current_liabilities,
  wcm.current_assets - wcm.current_liabilities as working_capital,
  wcm.current_assets / NULLIF(wcm.current_liabilities, 0) as current_ratio\n`;
      case 'cash_flow':
        return `  cm.company_name,
  cm.cash_balance\n`;
      case 'revenue_growth':
        return `  rm.company_name,
  rm.total_revenue,
  rm.invoice_count\n`;
      default:
        return `  gm.company_name,
  gm.transaction_count,
  gm.total_activity\n`;
    }
  }

  /**
   * Build JOIN clauses based on focus area
   */
  private buildJoinClauses(focusArea: string): string {
    switch (focusArea) {
      case 'asset_finance':
        return 'INNER JOIN ARMetrics arm ON u.company_name = arm.company_name\n';
      case 'working_capital':
        return 'INNER JOIN WorkingCapitalMetrics wcm ON u.company_name = wcm.company_name\n';
      case 'cash_flow':
        return 'INNER JOIN CashMetrics cm ON u.company_name = cm.company_name\n';
      case 'revenue_growth':
        return 'INNER JOIN RevenueMetrics rm ON u.company_name = rm.company_name\n';
      default:
        return 'INNER JOIN GeneralMetrics gm ON u.company_name = gm.company_name\n';
    }
  }

  /**
   * Build WHERE clause based on focus area
   */
  private buildWhereClause(focusArea: string): string {
    switch (focusArea) {
      case 'asset_finance':
        return 'WHERE arm.ar_balance > 100000  -- Minimum AR threshold\n';
      case 'working_capital':
        return 'WHERE wcm.current_assets > 0 AND wcm.current_liabilities > 0\n';
      default:
        return '';
    }
  }

  /**
   * Build ORDER BY clause based on focus area
   */
  private buildOrderByClause(focusArea: string): string {
    switch (focusArea) {
      case 'asset_finance':
        return 'ORDER BY arm.ar_balance DESC';
      case 'working_capital':
        return 'ORDER BY working_capital ASC';  // Show stressed companies first
      case 'cash_flow':
        return 'ORDER BY cm.cash_balance DESC';
      case 'revenue_growth':
        return 'ORDER BY rm.total_revenue DESC';
      default:
        return 'ORDER BY gm.total_activity DESC';
    }
  }

  /**
   * Validate generated SQL
   */
  private async validateSQL(sql: string): Promise<SQLValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required filters
    if (!sql.includes('client_id')) {
      errors.push('Missing client_id filter for multi-tenant isolation');
    }

    if (!sql.includes('uploadId') && !sql.includes('upload_id')) {
      warnings.push('Not using uploadId for optimal performance');
    }

    // Check for portfolio scope
    if (!sql.includes('LatestUploads') && !sql.includes('GROUP BY')) {
      warnings.push('Query may not be portfolio-wide');
    }

    // Check for result limiting
    if (!sql.includes('TOP') && !sql.includes('LIMIT')) {
      warnings.push('No result limiting - consider adding TOP clause');
    }

    // Check for performance hints
    if (sql.includes('transactionLine') && !sql.includes('WITH (NOLOCK)')) {
      warnings.push('Consider using WITH (NOLOCK) for large transaction tables');
    }

    // Estimate performance score
    let performanceScore = 10;
    if (!sql.includes('uploadId')) performanceScore -= 3;
    if (!sql.includes('TOP')) performanceScore -= 1;
    if (sql.includes('DISTINCT') && sql.includes('GROUP BY')) performanceScore -= 1;
    if (sql.includes('NOT IN')) performanceScore -= 2;

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      performanceScore
    };
  }

  /**
   * Attempt to fix common SQL issues
   */
  private attemptAutoFix(sql: string, validation: SQLValidationResult): string {
    let fixedSQL = sql;

    // Add client_id filter if missing
    if (validation.errors?.includes('Missing client_id filter')) {
      const whereMatch = fixedSQL.match(/WHERE\s+/i);
      if (whereMatch) {
        fixedSQL = fixedSQL.replace(/WHERE\s+/i, 'WHERE client_id = @clientId AND ');
      } else {
        fixedSQL = fixedSQL.replace(/FROM\s+(\w+)/i, 'FROM $1 WHERE client_id = @clientId');
      }
    }

    // Add TOP if missing
    if (validation.warnings?.includes('No result limiting')) {
      fixedSQL = fixedSQL.replace(/SELECT\s+/i, 'SELECT TOP 5000 ');
    }

    return fixedSQL;
  }

  /**
   * Extract table and column information from SQL
   */
  private extractTableAndColumnInfo(sql: string): { tables: string[], columns: string[] } {
    const tables: Set<string> = new Set();
    const columns: Set<string> = new Set();

    // Extract table names (simple regex approach)
    const tableMatches = sql.matchAll(/(?:FROM|JOIN)\s+(\w+\.\w+|\w+)/gi);
    for (const match of tableMatches) {
      tables.add(match[1]);
    }

    // Extract column names from SELECT
    const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/is);
    if (selectMatch) {
      const selectClause = selectMatch[1];
      const columnMatches = selectClause.matchAll(/(\w+)\s+as\s+(\w+)|\b(\w+\.\w+)|\b(\w+)\b/gi);
      for (const match of columnMatches) {
        const columnName = match[2] || match[3]?.split('.')[1] || match[4];
        if (columnName && !['TOP', 'DISTINCT', 'ALL'].includes(columnName.toUpperCase())) {
          columns.add(columnName);
        }
      }
    }

    return {
      tables: Array.from(tables),
      columns: Array.from(columns)
    };
  }

  /**
   * Get performance notes for the query
   */
  private getPerformanceNotes(sql: string, context: LendingContext): string[] {
    const notes: string[] = [];

    if (sql.includes('LatestUploads')) {
      notes.push('Uses latest upload per company for accurate portfolio view');
    }

    if (sql.includes('uploadId')) {
      notes.push('Filters by uploadId (clustered index) for optimal performance');
    }

    if (sql.includes('WITH')) {
      notes.push('Uses CTEs for efficient pre-aggregation');
    }

    if (context.timeframe === '3months') {
      notes.push('Limited to 3-month window for relevant data');
    }

    if (sql.includes('TOP')) {
      notes.push('Result set limited for performance');
    }

    return notes;
  }

  /**
   * Explain template-based query
   */
  private explainTemplateQuery(template: any, context: LendingContext): string {
    return `This query uses the "${template.name}" template to analyze ${context.focusAreas.join(', ')} across your portfolio.

The query:
1. Identifies the latest upload for each company in your portfolio
2. ${template.description}
3. Aggregates metrics at the portfolio level
4. Applies risk categorization and filtering
5. Returns the most relevant companies based on your criteria

Performance optimizations applied:
- Filters by uploadId for clustered index usage
- Uses CTEs to pre-aggregate data
- Limits results to manage data volume`;
  }

  /**
   * Explain custom-built query
   */
  private explainCustomQuery(context: LendingContext): string {
    const focusArea = context.focusAreas[0] || 'portfolio health';

    return `This custom query analyzes ${focusArea} across your portfolio.

The query:
1. Retrieves the latest upload for each company (${context.timeframe} window)
2. Calculates relevant metrics for ${focusArea}
3. Aggregates data at the portfolio level
4. Applies filtering based on materiality thresholds
5. Orders results by relevance

Key considerations:
- Multi-tenant isolation via client_id
- Portfolio-wide scope (${context.isPortfolioQuery ? 'multiple companies' : 'filtered companies'})
- ${context.requiresAggregation ? 'Aggregated metrics' : 'Detailed data'}
- Performance optimized for large datasets`;
  }

  /**
   * Load query templates
   */
  private loadTemplates(): Map<string, QueryTemplate> {
    const templates = new Map<string, QueryTemplate>();

    // This would normally load from a configuration file
    // For now, we'll use the sample queries as our base

    return templates;
  }
}
