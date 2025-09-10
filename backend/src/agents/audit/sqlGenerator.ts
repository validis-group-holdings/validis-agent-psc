/**
 * SQL generation for company-specific audit queries
 */

import {
  AuditQueryRequest,
  AuditQueryResponse,
  AuditContext,
  AuditFocusArea,
  SQLValidationResult,
  AuditTemplate,
  AuditRisk,
  CompanyContext
} from './types';
import { DatabaseContext } from '../../services/database-context/contextBuilder';
import { getSampleQueries } from '../../services/database-context/sampleQueries';
import { AUDIT_RISK_PATTERNS } from './promptTemplates';

export class AuditSQLGenerator {
  private context: DatabaseContext;
  private templates: Map<string, AuditTemplate>;

  constructor(context: DatabaseContext) {
    this.context = context;
    this.templates = this.loadTemplates();
  }

  /**
   * Generate SQL from natural language query
   */
  async generateSQL(request: AuditQueryRequest): Promise<AuditQueryResponse> {
    // Analyze the query to determine context
    const auditContext = this.analyzeQuery(request.naturalLanguageQuery);

    // Get company context
    const companyContext = this.buildCompanyContext(request);

    // Find matching template or build custom query
    const template = this.findBestTemplate(request.naturalLanguageQuery, auditContext);

    let sql: string;
    let explanation: string = '';
    let confidence: number;
    let auditRisks: AuditRisk[] = [];

    if (template) {
      // Adapt template to specific request
      sql = this.adaptTemplate(template, request, auditContext, companyContext);
      confidence = 0.95; // High confidence when using template

      if (request.includeExplanation) {
        explanation = this.explainTemplateQuery(template, auditContext, request.companyName);
      }

      // Identify audit risks from template
      auditRisks = this.identifyRisks(template, auditContext);
    } else {
      // Build custom query using patterns
      sql = this.buildCustomQuery(request, auditContext, companyContext);
      confidence = 0.8; // Good confidence for custom queries

      if (request.includeExplanation) {
        explanation = this.explainCustomQuery(auditContext, request.companyName);
      }

      // Identify audit risks from context
      auditRisks = this.identifyRisksFromContext(auditContext);
    }

    // Validate the generated SQL
    const validation = await this.validateSQL(sql, request.companyName);

    if (!validation.isValid) {
      // Attempt to fix common issues
      sql = this.attemptAutoFix(sql, validation, request);
      confidence *= 0.85; // Reduce confidence after fixes
    }

    // Determine involved tables and expected columns
    const { tables, columns } = this.extractTableAndColumnInfo(sql);

    return {
      sql,
      explanation,
      confidence,
      queryType: auditContext.isDetailQuery ? 'detail' : 'analysis',
      involvedTables: tables,
      expectedColumns: columns,
      performanceNotes: this.getPerformanceNotes(sql, auditContext),
      auditRisks: auditRisks.length > 0 ? auditRisks : undefined,
      warnings: validation.warnings
    };
  }

  /**
   * Analyze query to determine audit context
   */
  private analyzeQuery(query: string): AuditContext {
    const lowerQuery = query.toLowerCase();

    // Determine focus areas
    const focusAreas: AuditFocusArea[] = [];

    if (lowerQuery.includes('variance') || lowerQuery.includes('change') ||
        lowerQuery.includes('fluctuation')) {
      focusAreas.push('variance_analysis');
    }

    if (lowerQuery.includes('large') || lowerQuery.includes('significant') ||
        lowerQuery.includes('material')) {
      focusAreas.push('large_transactions');
    }

    if (lowerQuery.includes('aged') || lowerQuery.includes('aging') ||
        lowerQuery.includes('overdue') || lowerQuery.includes('outstanding')) {
      focusAreas.push('aged_receivables');
    }

    if (lowerQuery.includes('journal') || lowerQuery.includes('entry') ||
        lowerQuery.includes('manual') || lowerQuery.includes('adjustment')) {
      focusAreas.push('journal_entries');
    }

    if (lowerQuery.includes('round') || lowerQuery.includes('even amount')) {
      focusAreas.push('round_amounts');
    }

    if (lowerQuery.includes('duplicate') || lowerQuery.includes('double')) {
      focusAreas.push('duplicate_payments');
    }

    if (lowerQuery.includes('cutoff') || lowerQuery.includes('period end')) {
      focusAreas.push('revenue_cutoff');
    }

    // Determine timeframe
    let timeframe: 'current' | 'period' | 'historical' | 'custom' = 'current';
    if (lowerQuery.includes('historical') || lowerQuery.includes('trend') ||
        lowerQuery.includes('over time')) {
      timeframe = 'historical';
    } else if (lowerQuery.includes('period') || lowerQuery.includes('month')) {
      timeframe = 'period';
    }

    // Check if it's a detail query
    const isDetailQuery = lowerQuery.includes('detail') ||
                         lowerQuery.includes('transaction') ||
                         lowerQuery.includes('line item') ||
                         lowerQuery.includes('specific');

    // Determine if latest data is required
    const requiresLatestData = !lowerQuery.includes('historical') &&
                               !lowerQuery.includes('prior period') &&
                               !lowerQuery.includes('previous');

    // Assess risk level based on keywords
    let riskLevel: 'high' | 'medium' | 'low' | undefined;
    if (lowerQuery.includes('fraud') || lowerQuery.includes('suspicious') ||
        lowerQuery.includes('critical')) {
      riskLevel = 'high';
    } else if (lowerQuery.includes('risk') || lowerQuery.includes('concern')) {
      riskLevel = 'medium';
    }

    return {
      isDetailQuery,
      requiresLatestData,
      timeframe,
      focusAreas: focusAreas.length > 0 ? focusAreas : ['variance_analysis'],
      riskLevel
    };
  }

  /**
   * Build company context
   */
  private buildCompanyContext(request: AuditQueryRequest): CompanyContext {
    return {
      companyName: request.companyName,
      hasMultipleUploads: true, // Assume true for now
      // Other fields would be populated from database
    };
  }

  /**
   * Find best matching template
   */
  private findBestTemplate(query: string, context: AuditContext): any | null {
    const lowerQuery = query.toLowerCase();

    // Get audit templates from sample queries
    const auditQueries = getSampleQueries().audit;

    // Score each template
    let bestMatch: any = null;
    let bestScore = 0;

    for (const template of auditQueries) {
      let score = 0;

      // Check if natural language example matches
      const exampleWords = template.naturalLanguageExample.toLowerCase().split(' ');
      const queryWords = lowerQuery.split(' ');

      for (const word of queryWords) {
        if (exampleWords.includes(word) && word.length > 3) {
          score += 1;
        }
      }

      // Bonus for matching focus area
      if (context.focusAreas.some(area => {
        const templateArea = template.id.replace('audit-', '').replace(/-/g, '_');
        return area === templateArea || area.includes(templateArea);
      })) {
        score += 5;
      }

      // Bonus for specific pattern matches
      if (lowerQuery.includes('variance') && template.id.includes('variance')) {
        score += 4;
      }
      if (lowerQuery.includes('duplicate') && template.id.includes('duplicate')) {
        score += 4;
      }
      if (lowerQuery.includes('aged') && template.id.includes('aged')) {
        score += 4;
      }
      if (lowerQuery.includes('journal') && template.id.includes('weekend')) {
        score += 3;
      }
      if (lowerQuery.includes('round') && template.id.includes('round')) {
        score += 4;
      }
      if (lowerQuery.includes('cutoff') && template.id.includes('cutoff')) {
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
    request: AuditQueryRequest,
    context: AuditContext,
    companyContext: CompanyContext
  ): string {
    let sql = template.sqlTemplate;

    // Replace parameters
    sql = sql.replace(/@clientId/g, `'${request.clientId}'`);
    sql = sql.replace(/@companyName/g, `'${request.companyName}'`);

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
      // Find the main SELECT (not in CTEs)
      const mainSelectMatch = sql.match(/\)\s*SELECT\s+/i);
      if (mainSelectMatch) {
        sql = sql.replace(/(\)\s*SELECT)\s+/i, `$1 TOP ${request.maxResults} `);
      } else if (!sql.includes('WITH')) {
        sql = sql.replace(/SELECT\s+/i, `SELECT TOP ${request.maxResults} `);
      }
    }

    // Ensure company name is properly escaped
    sql = sql.replace(/LOWER\(company_name\)/g, 'LOWER(company_name)');
    sql = sql.replace(/LOWER\('@companyName'\)/g, `LOWER('${request.companyName}')`);

    return sql;
  }

  /**
   * Build custom query when no template matches
   */
  private buildCustomQuery(
    request: AuditQueryRequest,
    context: AuditContext,
    companyContext: CompanyContext
  ): string {
    const focusArea = context.focusAreas[0] || 'variance_analysis';

    // Start with company upload CTE
    let sql = `-- Audit analysis for ${request.companyName}: ${focusArea.replace(/_/g, ' ')}\n`;
    sql += `WITH CompanyUpload AS (\n`;
    sql += `  SELECT TOP 1 upload_id, company_name, upload_date\n`;
    sql += `  FROM upload\n`;
    sql += `  WHERE client_id = '${request.clientId}'\n`;
    sql += `    AND LOWER(company_name) = LOWER('${request.companyName}')\n`;

    if (request.useLatestUpload !== false) {
      sql += `  ORDER BY upload_date DESC\n`;
    }

    sql += `)\n`;

    // Add focus-specific CTEs
    switch (focusArea) {
      case 'variance_analysis':
        sql += this.buildVarianceAnalysisCTE();
        break;
      case 'large_transactions':
        sql += this.buildLargeTransactionsCTE();
        break;
      case 'aged_receivables':
        sql += this.buildAgedReceivablesCTE();
        break;
      case 'journal_entries':
        sql += this.buildJournalEntriesCTE();
        break;
      case 'duplicate_payments':
        sql += this.buildDuplicatePaymentsCTE();
        break;
      case 'revenue_cutoff':
        sql += this.buildRevenueCutoffCTE();
        break;
      default:
        sql += this.buildGeneralAuditCTE();
    }

    // Add final SELECT with limiting
    const maxResults = request.maxResults || 1000;
    sql += `SELECT TOP ${maxResults}\n`;
    sql += this.buildSelectColumns(focusArea, context);
    sql += `FROM CompanyUpload cu\n`;
    sql += this.buildJoinClauses(focusArea);
    sql += this.buildWhereClause(focusArea, context);
    sql += this.buildOrderByClause(focusArea, context);

    return sql;
  }

  /**
   * Build Variance Analysis CTE
   */
  private buildVarianceAnalysisCTE(): string {
    return `,
CurrentPeriod AS (
  SELECT
    th.transaction_id,
    th.transaction_date,
    tl.account_code,
    tl.account_name,
    tl.amount
  FROM CompanyUpload cu
  INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
  INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
  WHERE th.transaction_date >= DATEADD(month, -1, GETDATE())
),
PriorPeriod AS (
  SELECT
    tl.account_code,
    AVG(tl.amount) as avg_amount,
    STDEV(tl.amount) as std_amount
  FROM CompanyUpload cu
  INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
  INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
  WHERE th.transaction_date >= DATEADD(month, -13, GETDATE())
    AND th.transaction_date < DATEADD(month, -1, GETDATE())
  GROUP BY tl.account_code
)
`;
  }

  /**
   * Build Large Transactions CTE
   */
  private buildLargeTransactionsCTE(): string {
    return `,
TransactionTotals AS (
  SELECT
    SUM(ABS(tl.amount)) as total_activity
  FROM CompanyUpload cu
  INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
  INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
)
`;
  }

  /**
   * Build Aged Receivables CTE
   */
  private buildAgedReceivablesCTE(): string {
    return `,
AgedItems AS (
  SELECT
    sh.invoice_number,
    sh.invoice_date,
    sh.due_date,
    sh.customer_name,
    sh.outstanding_amount,
    DATEDIFF(day, sh.due_date, GETDATE()) as days_overdue
  FROM CompanyUpload cu
  INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
  WHERE sh.status = 'Open'
    AND sh.outstanding_amount > 0
)
`;
  }

  /**
   * Build Journal Entries CTE
   */
  private buildJournalEntriesCTE(): string {
    return `,
JournalEntries AS (
  SELECT
    th.transaction_id,
    th.transaction_date,
    th.created_date,
    th.created_by,
    th.entry_type,
    th.description,
    SUM(ABS(tl.amount)) as total_amount,
    COUNT(tl.line_id) as line_count
  FROM CompanyUpload cu
  INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
  INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
  WHERE th.entry_type IN ('Manual', 'Adjustment')
  GROUP BY th.transaction_id, th.transaction_date, th.created_date,
           th.created_by, th.entry_type, th.description
)
`;
  }

  /**
   * Build Duplicate Payments CTE
   */
  private buildDuplicatePaymentsCTE(): string {
    return `,
PotentialDuplicates AS (
  SELECT
    ph.supplier_name,
    ph.gross_amount,
    ph.invoice_date,
    COUNT(*) as occurrence_count,
    STRING_AGG(ph.invoice_number, ', ') as invoice_numbers
  FROM CompanyUpload cu
  INNER JOIN purchaseHeader ph ON ph.uploadId = cu.upload_id
  GROUP BY ph.supplier_name, ph.gross_amount, ph.invoice_date
  HAVING COUNT(*) > 1
)
`;
  }

  /**
   * Build Revenue Cutoff CTE
   */
  private buildRevenueCutoffCTE(): string {
    return `,
PeriodEnd AS (
  SELECT TOP 1 fp.period_end_date
  FROM CompanyUpload cu
  LEFT JOIN financialPeriod fp ON cu.financial_period_id = fp.period_id
),
CutoffTransactions AS (
  SELECT
    sh.invoice_number,
    sh.invoice_date,
    sh.delivery_date,
    sh.customer_name,
    sh.gross_amount,
    pe.period_end_date,
    DATEDIFF(day, sh.invoice_date, pe.period_end_date) as days_from_cutoff
  FROM CompanyUpload cu
  CROSS JOIN PeriodEnd pe
  INNER JOIN saleHeader sh ON sh.uploadId = cu.upload_id
  WHERE ABS(DATEDIFF(day, sh.invoice_date, pe.period_end_date)) <= 7
)
`;
  }

  /**
   * Build General Audit CTE
   */
  private buildGeneralAuditCTE(): string {
    return `,
AuditMetrics AS (
  SELECT
    COUNT(DISTINCT th.transaction_id) as transaction_count,
    SUM(CASE WHEN th.entry_type = 'Manual' THEN 1 ELSE 0 END) as manual_count,
    SUM(CASE WHEN th.entry_type = 'Adjustment' THEN 1 ELSE 0 END) as adjustment_count
  FROM CompanyUpload cu
  INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
)
`;
  }

  /**
   * Build SELECT columns based on focus area
   */
  private buildSelectColumns(focusArea: string, context: AuditContext): string {
    switch (focusArea) {
      case 'variance_analysis':
        return `  cp.transaction_date,
  cp.account_code,
  cp.account_name,
  cp.amount as current_amount,
  pp.avg_amount as prior_avg_amount,
  ((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) * 100 as variance_percentage,
  CASE
    WHEN ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.25 THEN 'High'
    WHEN ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.1 THEN 'Medium'
    ELSE 'Low'
  END as variance_risk\n`;

      case 'large_transactions':
        return `  th.transaction_date,
  th.description,
  tl.account_code,
  tl.amount,
  (ABS(tl.amount) / tt.total_activity) * 100 as percentage_of_total,
  th.created_by,
  th.entry_type\n`;

      case 'aged_receivables':
        return `  ai.invoice_number,
  ai.invoice_date,
  ai.due_date,
  ai.customer_name,
  ai.outstanding_amount,
  ai.days_overdue,
  CASE
    WHEN ai.days_overdue > 120 THEN 'Critical'
    WHEN ai.days_overdue > 60 THEN 'High'
    WHEN ai.days_overdue > 30 THEN 'Medium'
    ELSE 'Low'
  END as aging_risk\n`;

      case 'journal_entries':
        return `  je.transaction_id,
  je.transaction_date,
  je.created_date,
  je.created_by,
  je.entry_type,
  je.total_amount,
  je.line_count,
  DATENAME(WEEKDAY, je.created_date) as day_of_week,
  DATEPART(HOUR, je.created_date) as hour_created,
  je.description\n`;

      case 'duplicate_payments':
        return `  pd.supplier_name,
  pd.gross_amount,
  pd.occurrence_count,
  pd.invoice_numbers,
  pd.gross_amount * (pd.occurrence_count - 1) as potential_overpayment\n`;

      case 'revenue_cutoff':
        return `  ct.invoice_number,
  ct.invoice_date,
  ct.period_end_date,
  ct.customer_name,
  ct.gross_amount,
  ct.days_from_cutoff,
  CASE
    WHEN ct.invoice_date > ct.period_end_date AND ct.delivery_date <= ct.period_end_date THEN 'Late Recognition'
    WHEN ct.invoice_date <= ct.period_end_date AND ct.delivery_date > ct.period_end_date THEN 'Early Recognition'
    ELSE 'Proper Cutoff'
  END as cutoff_assessment\n`;

      default:
        return `  am.transaction_count,
  am.manual_count,
  am.adjustment_count,
  (am.manual_count + am.adjustment_count) * 100.0 / NULLIF(am.transaction_count, 0) as manual_percentage\n`;
    }
  }

  /**
   * Build JOIN clauses based on focus area
   */
  private buildJoinClauses(focusArea: string): string {
    switch (focusArea) {
      case 'variance_analysis':
        return `INNER JOIN CurrentPeriod cp ON 1=1
INNER JOIN PriorPeriod pp ON cp.account_code = pp.account_code\n`;

      case 'large_transactions':
        return `INNER JOIN transactionHeader th ON th.uploadId = cu.upload_id
INNER JOIN transactionLine tl ON tl.transaction_id = th.transaction_id
CROSS JOIN TransactionTotals tt\n`;

      case 'aged_receivables':
        return `INNER JOIN AgedItems ai ON 1=1\n`;

      case 'journal_entries':
        return `INNER JOIN JournalEntries je ON 1=1\n`;

      case 'duplicate_payments':
        return `INNER JOIN PotentialDuplicates pd ON 1=1\n`;

      case 'revenue_cutoff':
        return `INNER JOIN CutoffTransactions ct ON 1=1\n`;

      default:
        return `INNER JOIN AuditMetrics am ON 1=1\n`;
    }
  }

  /**
   * Build WHERE clause based on focus area
   */
  private buildWhereClause(focusArea: string, context: AuditContext): string {
    let whereClause = '';

    switch (focusArea) {
      case 'variance_analysis':
        whereClause = 'WHERE ABS((cp.amount - pp.avg_amount) / NULLIF(pp.avg_amount, 0)) > 0.1\n';
        whereClause += '  AND ABS(cp.amount) > 1000  -- Materiality threshold\n';
        break;

      case 'large_transactions':
        whereClause = 'WHERE ABS(tl.amount) > 10000  -- Materiality threshold\n';
        if (context.riskLevel === 'high') {
          whereClause += '  AND th.entry_type IN (\'Manual\', \'Adjustment\')\n';
        }
        break;

      case 'aged_receivables':
        whereClause = 'WHERE ai.days_overdue > 30\n';
        break;

      case 'journal_entries':
        whereClause = 'WHERE je.total_amount > 5000  -- Materiality threshold\n';
        if (context.riskLevel === 'high') {
          whereClause += '  AND (DATEPART(WEEKDAY, je.created_date) IN (1, 7) OR DATEPART(HOUR, je.created_date) NOT BETWEEN 8 AND 17)\n';
        }
        break;

      case 'duplicate_payments':
        whereClause = 'WHERE pd.gross_amount > 1000  -- Materiality threshold\n';
        break;

      case 'revenue_cutoff':
        whereClause = 'WHERE ct.gross_amount > 5000  -- Materiality threshold\n';
        break;
    }

    return whereClause;
  }

  /**
   * Build ORDER BY clause based on focus area
   */
  private buildOrderByClause(focusArea: string, context: AuditContext): string {
    switch (focusArea) {
      case 'variance_analysis':
        return 'ORDER BY ABS(variance_percentage) DESC';

      case 'large_transactions':
        return 'ORDER BY ABS(tl.amount) DESC';

      case 'aged_receivables':
        return 'ORDER BY ai.days_overdue DESC, ai.outstanding_amount DESC';

      case 'journal_entries':
        return 'ORDER BY je.created_date DESC';

      case 'duplicate_payments':
        return 'ORDER BY potential_overpayment DESC';

      case 'revenue_cutoff':
        return 'ORDER BY ABS(ct.days_from_cutoff) ASC';

      default:
        return 'ORDER BY 1';
    }
  }

  /**
   * Validate generated SQL
   */
  private async validateSQL(sql: string, companyName: string): Promise<SQLValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required filters
    if (!sql.includes('client_id')) {
      errors.push('Missing client_id filter for multi-tenant isolation');
    }

    if (!sql.includes('company_name')) {
      errors.push(`Missing company_name filter for ${companyName}`);
    }

    if (!sql.includes('uploadId') && !sql.includes('upload_id')) {
      warnings.push('Not using uploadId for optimal performance');
    }

    // Check for audit completeness
    if (sql.includes('transactionHeader') && !sql.includes('transactionLine')) {
      warnings.push('Consider including transaction lines for complete audit trail');
    }

    // Check for materiality
    if (!sql.includes('> 1000') && !sql.includes('> 5000') && !sql.includes('> 10000')) {
      warnings.push('No materiality threshold applied - consider adding one');
    }

    // Check for result limiting
    if (!sql.includes('TOP') && !sql.includes('LIMIT')) {
      warnings.push('No result limiting - consider adding TOP clause');
    }

    // Estimate performance score
    let performanceScore = 10;
    if (!sql.includes('uploadId') && !sql.includes('upload_id')) performanceScore -= 2;
    if (!sql.includes('TOP')) performanceScore -= 1;
    if (sql.includes('DISTINCT') && sql.includes('GROUP BY')) performanceScore -= 1;
    if (sql.includes('NOT IN')) performanceScore -= 2;
    if (!sql.includes('CompanyUpload')) performanceScore -= 1;

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
  private attemptAutoFix(
    sql: string,
    validation: SQLValidationResult,
    request: AuditQueryRequest
  ): string {
    let fixedSQL = sql;

    // Add client_id filter if missing
    if (validation.errors?.includes('Missing client_id filter')) {
      const whereMatch = fixedSQL.match(/WHERE\s+/i);
      if (whereMatch) {
        fixedSQL = fixedSQL.replace(/WHERE\s+/i, `WHERE client_id = '${request.clientId}' AND `);
      }
    }

    // Add company_name filter if missing
    if (validation.errors?.some(e => e.includes('Missing company_name filter'))) {
      const whereMatch = fixedSQL.match(/WHERE\s+/i);
      if (whereMatch) {
        fixedSQL = fixedSQL.replace(/WHERE\s+/i, `WHERE LOWER(company_name) = LOWER('${request.companyName}') AND `);
      }
    }

    // Add TOP if missing
    if (validation.warnings?.includes('No result limiting')) {
      const maxResults = request.maxResults || 1000;
      fixedSQL = fixedSQL.replace(/SELECT\s+(?!TOP)/i, `SELECT TOP ${maxResults} `);
    }

    return fixedSQL;
  }

  /**
   * Extract table and column information from SQL
   */
  private extractTableAndColumnInfo(sql: string): { tables: string[], columns: string[] } {
    const tables: Set<string> = new Set();
    const columns: Set<string> = new Set();

    // Extract table names
    const tableMatches = sql.matchAll(/(?:FROM|JOIN)\s+(\w+(?:\.\w+)?)\s+(\w+)?/gi);
    for (const match of tableMatches) {
      const tableName = match[1];
      if (!tableName.toUpperCase().includes('AS') && tableName !== 'CompanyUpload') {
        tables.add(tableName);
      }
    }

    // Extract column names from SELECT
    const selectMatches = sql.matchAll(/SELECT\s+(.*?)(?:FROM|$)/gis);
    for (const selectMatch of selectMatches) {
      const selectClause = selectMatch[1];
      const columnMatches = selectClause.matchAll(/(\w+)\s+as\s+(\w+)|\b(\w+\.\w+)|\b(\w+)\b/gi);
      for (const match of columnMatches) {
        const columnName = match[2] || match[3]?.split('.')[1] || match[4];
        if (columnName &&
            !['TOP', 'DISTINCT', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS'].includes(columnName.toUpperCase())) {
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
  private getPerformanceNotes(sql: string, context: AuditContext): string[] {
    const notes: string[] = [];

    if (sql.includes('CompanyUpload')) {
      notes.push('Uses company-specific upload for targeted analysis');
    }

    if (sql.includes('uploadId') || sql.includes('upload_id')) {
      notes.push('Filters by uploadId (clustered index) for optimal performance');
    }

    if (sql.includes('WITH')) {
      notes.push('Uses CTEs for structured data preparation');
    }

    if (context.requiresLatestData) {
      notes.push('Uses latest upload for current data');
    }

    if (sql.includes('TOP')) {
      notes.push('Result set limited for performance and relevance');
    }

    if (sql.includes('entry_type')) {
      notes.push('Filters by entry type for audit focus');
    }

    return notes;
  }

  /**
   * Identify audit risks from template
   */
  private identifyRisks(template: any, context: AuditContext): AuditRisk[] {
    const risks: AuditRisk[] = [];

    // Map template patterns to risks
    if (template.id.includes('variance')) {
      risks.push({
        level: 'medium',
        category: 'Variance Analysis',
        description: 'Significant variances detected requiring investigation',
        recommendation: 'Review transactions exceeding 10% variance for business justification'
      });
    }

    if (template.id.includes('aged')) {
      risks.push({
        level: 'high',
        category: 'Credit Risk',
        description: 'Aged receivables may indicate collection issues',
        recommendation: 'Consider provisioning for items over 120 days'
      });
    }

    if (template.id.includes('weekend') || template.id.includes('journal')) {
      risks.push({
        level: 'high',
        category: 'Control Risk',
        description: 'Manual entries outside business hours require scrutiny',
        recommendation: 'Review authorization and supporting documentation'
      });
    }

    if (template.id.includes('duplicate')) {
      risks.push({
        level: 'high',
        category: 'Payment Control',
        description: 'Potential duplicate payments identified',
        recommendation: 'Verify with accounts payable and recover overpayments'
      });
    }

    if (template.id.includes('round')) {
      risks.push({
        level: 'medium',
        category: 'Estimation Risk',
        description: 'Round amounts may indicate estimates rather than actual values',
        recommendation: 'Verify supporting calculations and documentation'
      });
    }

    if (template.id.includes('cutoff')) {
      risks.push({
        level: 'medium',
        category: 'Period Accuracy',
        description: 'Revenue recognition timing issues identified',
        recommendation: 'Ensure proper cutoff procedures are followed'
      });
    }

    return risks;
  }

  /**
   * Identify audit risks from context
   */
  private identifyRisksFromContext(context: AuditContext): AuditRisk[] {
    const risks: AuditRisk[] = [];

    // Add risks based on focus areas
    for (const focusArea of context.focusAreas) {
      switch (focusArea) {
        case 'variance_analysis':
          risks.push({
            level: context.riskLevel || 'medium',
            category: 'Analytical Review',
            description: 'Variance analysis requires detailed investigation',
            recommendation: 'Document business reasons for significant variances'
          });
          break;

        case 'journal_entries':
          risks.push({
            level: 'high',
            category: 'Manual Entries',
            description: 'Manual journal entries carry inherent risk',
            recommendation: 'Review approval hierarchy and supporting documentation'
          });
          break;

        case 'aged_receivables':
          risks.push({
            level: 'high',
            category: 'Asset Quality',
            description: 'Aged items may require provision or write-off',
            recommendation: 'Assess collectibility and update provisions'
          });
          break;

        case 'large_transactions':
          risks.push({
            level: 'medium',
            category: 'Materiality',
            description: 'Large transactions have significant financial impact',
            recommendation: 'Perform detailed testing on material items'
          });
          break;
      }
    }

    return risks;
  }

  /**
   * Explain template-based query
   */
  private explainTemplateQuery(template: any, context: AuditContext, companyName: string): string {
    return `This query uses the "${template.name}" template to perform ${context.focusAreas.join(', ')} for ${companyName}.

Audit objective:
${template.description}

The query:
1. Identifies the latest upload for ${companyName}
2. ${this.getTemplateStep2(template)}
3. Applies materiality thresholds and risk categorization
4. Filters for audit-relevant items
5. Returns detailed evidence for investigation

Audit approach:
- Focus: Company-specific detailed analysis
- Scope: ${context.requiresLatestData ? 'Latest period data' : 'Historical comparison'}
- Risk level: ${context.riskLevel || 'Standard'}
- Evidence type: ${context.isDetailQuery ? 'Transaction detail' : 'Summary analysis'}

Expected output:
Items requiring audit attention based on defined risk criteria`;
  }

  /**
   * Get template-specific step 2 description
   */
  private getTemplateStep2(template: any): string {
    if (template.id.includes('variance')) {
      return 'Compares current period to historical averages';
    } else if (template.id.includes('aged')) {
      return 'Calculates aging buckets and overdue amounts';
    } else if (template.id.includes('journal')) {
      return 'Identifies manual and adjustment entries with timing analysis';
    } else if (template.id.includes('duplicate')) {
      return 'Groups transactions to identify potential duplicates';
    } else if (template.id.includes('cutoff')) {
      return 'Analyzes transactions near period end for proper cutoff';
    } else {
      return 'Analyzes transactions based on audit criteria';
    }
  }

  /**
   * Explain custom-built query
   */
  private explainCustomQuery(context: AuditContext, companyName: string): string {
    const focusArea = context.focusAreas[0] || 'general audit';

    return `This custom query performs ${focusArea.replace(/_/g, ' ')} for ${companyName}.

The query:
1. Retrieves the ${context.requiresLatestData ? 'latest' : 'relevant'} upload for ${companyName}
2. Filters transactions based on audit criteria
3. Calculates relevant metrics and risk indicators
4. Applies materiality thresholds
5. Returns items requiring audit attention

Key considerations:
- Company-specific scope (single entity)
- Multi-tenant isolation via client_id
- ${context.isDetailQuery ? 'Detailed transaction data' : 'Summary metrics'}
- Performance optimized using uploadId
- Audit trail information included where relevant

Risk assessment:
- Focus area risk: ${context.riskLevel || 'Standard review'}
- Materiality applied: Yes
- Evidence completeness: ${context.isDetailQuery ? 'Full detail' : 'Summary level'}`;
  }

  /**
   * Load audit templates
   */
  private loadTemplates(): Map<string, AuditTemplate> {
    const templates = new Map<string, AuditTemplate>();

    // This would normally load from a configuration file
    // For now, we'll use the sample queries as our base

    return templates;
  }
}
