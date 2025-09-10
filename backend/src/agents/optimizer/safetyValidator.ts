/**
 * SQL Query Safety Validator
 * Validates queries for safety and compliance with security policies
 */

import {
  ParsedQuery,
  ValidationResult,
  Violation,
  QueryContext,
  OptimizationOptions
} from './types';

export class SafetyValidator {
  private dangerousOperations = [
    'DROP',
    'DELETE',
    'UPDATE',
    'TRUNCATE',
    'ALTER',
    'CREATE',
    'EXEC',
    'EXECUTE',
    'INSERT',
    'MERGE'
  ];

  private dangerousFunctions = [
    'xp_cmdshell',
    'sp_configure',
    'sp_addlogin',
    'sp_droplogin',
    'xp_regread',
    'xp_regwrite'
  ];

  private maxRowLimit = 5000;
  private maxJoinCount = 5;

  /**
   * Validate query for safety and compliance
   */
  validate(
    query: ParsedQuery,
    context?: QueryContext,
    options?: OptimizationOptions
  ): ValidationResult {
    const violations: Violation[] = [];

    // Check for dangerous operations
    if (this.isDangerousOperation(query)) {
      violations.push({
        type: 'dangerous_operation',
        severity: 'error',
        message: `Query contains dangerous operation: ${query.type.toUpperCase()}`,
        location: 'query type'
      });
    }

    // For SELECT queries, perform additional validations
    if (query.type === 'select') {
      // Check for missing required filters
      this.validateRequiredFilters(query, violations, options);

      // Check for missing or excessive row limit
      this.validateRowLimit(query, violations, options);

      // Check for missing WHERE clause
      this.validateWhereClause(query, violations);

      // Check for excessive JOINs
      this.validateJoinCount(query, violations);

      // Check for wildcard SELECT
      this.validateSelectColumns(query, violations);

      // Check for Cartesian products
      this.validateCartesianProduct(query, violations);

      // Check for dangerous functions in WHERE conditions
      this.validateDangerousFunctions(query, violations);

      // Check for SQL injection patterns
      this.validateSQLInjectionPatterns(query, violations);

      // Check time window for portfolio queries
      this.validateTimeWindow(query, violations, context);
    }

    // Determine overall validity
    const hasErrors = violations.some((v) => v.severity === 'error');
    const isSafe = !hasErrors && !this.containsSQLInjectionRisk(query);

    return {
      isValid: violations.length === 0,
      isSafe,
      violations
    };
  }

  /**
   * Check if query is a dangerous operation
   */
  private isDangerousOperation(query: ParsedQuery): boolean {
    return this.dangerousOperations.includes(query.type.toUpperCase());
  }

  /**
   * Validate required filters are present
   */
  private validateRequiredFilters(
    query: ParsedQuery,
    violations: Violation[],
    options?: OptimizationOptions
  ): void {
    // Check for uploadId
    if (options?.enforceUploadId !== false) {
      const hasUploadId = query.whereConditions.some(
        (c) => c.column.toLowerCase() === 'uploadid' || c.column.toLowerCase() === 'upload_id'
      );

      if (!hasUploadId) {
        violations.push({
          type: 'missing_upload_id',
          severity: 'error',
          message: 'Query must include uploadId filter for clustered index usage',
          location: 'WHERE clause'
        });
      }
    }

    // Check for client_id
    if (options?.enforceClientId !== false) {
      const hasClientId = query.whereConditions.some(
        (c) => c.column.toLowerCase() === 'clientid' || c.column.toLowerCase() === 'client_id'
      );

      if (!hasClientId) {
        violations.push({
          type: 'missing_client_id',
          severity: 'error',
          message: 'Query must include client_id filter for multi-tenant isolation',
          location: 'WHERE clause'
        });
      }
    }
  }

  /**
   * Validate row limit
   */
  private validateRowLimit(
    query: ParsedQuery,
    violations: Violation[],
    options?: OptimizationOptions
  ): void {
    const maxLimit = options?.maxRowLimit || this.maxRowLimit;

    if (!query.limit) {
      violations.push({
        type: 'missing_row_limit',
        severity: 'error',
        message: `Query must include TOP/LIMIT clause (max ${maxLimit} rows)`,
        location: 'LIMIT clause'
      });
    } else if (query.limit > maxLimit) {
      violations.push({
        type: 'excessive_row_limit',
        severity: 'error',
        message: `Row limit ${query.limit} exceeds maximum allowed ${maxLimit}`,
        location: 'LIMIT clause'
      });
    }
  }

  /**
   * Validate WHERE clause exists
   */
  private validateWhereClause(query: ParsedQuery, violations: Violation[]): void {
    if (query.whereConditions.length === 0 && !query.limit) {
      violations.push({
        type: 'missing_where_clause',
        severity: 'warning',
        message: 'Query has no WHERE clause - this could return excessive data',
        location: 'WHERE clause'
      });
    }
  }

  /**
   * Validate JOIN count
   */
  private validateJoinCount(query: ParsedQuery, violations: Violation[]): void {
    if (query.joins.length > this.maxJoinCount) {
      violations.push({
        type: 'inefficient_join',
        severity: 'warning',
        message: `Query has ${query.joins.length} JOINs (max recommended: ${this.maxJoinCount})`,
        location: 'JOIN clauses'
      });
    }

    // Check for JOINs without proper conditions
    query.joins.forEach((join, index) => {
      if (!join.condition) {
        violations.push({
          type: 'inefficient_join',
          severity: 'error',
          message: `JOIN #${index + 1} is missing ON condition`,
          location: `JOIN ${join.table.name}`
        });
      }

      // Check if JOIN uses indexed columns
      const usesIndexedColumn = join.columns.some(
        (col) =>
          col.toLowerCase().includes('id') ||
          col.toLowerCase().includes('key') ||
          col.toLowerCase().includes('code')
      );

      if (!usesIndexedColumn) {
        violations.push({
          type: 'missing_index',
          severity: 'warning',
          message: `JOIN on ${join.table.name} may not be using indexed columns`,
          location: `JOIN ${join.table.name}`
        });
      }
    });
  }

  /**
   * Validate SELECT columns
   */
  private validateSelectColumns(query: ParsedQuery, violations: Violation[]): void {
    if (query.columns.includes('*')) {
      violations.push({
        type: 'wildcard_select',
        severity: 'warning',
        message: 'SELECT * should be avoided - specify required columns explicitly',
        location: 'SELECT clause'
      });
    }
  }

  /**
   * Check for Cartesian products
   */
  private validateCartesianProduct(query: ParsedQuery, violations: Violation[]): void {
    const hasCrossJoin = query.joins.some((j) => j.type === 'cross');

    if (hasCrossJoin) {
      violations.push({
        type: 'cartesian_product',
        severity: 'error',
        message: 'Query contains CROSS JOIN which can produce Cartesian product',
        location: 'JOIN clause'
      });
    }

    // Check for implicit Cartesian product (multiple tables without JOIN)
    if (query.tables.length > 1 && query.joins.length === 0) {
      violations.push({
        type: 'cartesian_product',
        severity: 'error',
        message: 'Multiple tables without JOIN conditions can produce Cartesian product',
        location: 'FROM clause'
      });
    }
  }

  /**
   * Check for dangerous functions
   */
  private validateDangerousFunctions(query: ParsedQuery, violations: Violation[]): void {
    const queryStr = JSON.stringify(query).toLowerCase();

    for (const func of this.dangerousFunctions) {
      if (queryStr.includes(func.toLowerCase())) {
        violations.push({
          type: 'dangerous_operation',
          severity: 'error',
          message: `Query contains dangerous function: ${func}`,
          location: 'function call'
        });
      }
    }
  }

  /**
   * Check for SQL injection patterns
   */
  private validateSQLInjectionPatterns(query: ParsedQuery, violations: Violation[]): void {
    const suspiciousPatterns = [
      /;\s*(DROP|DELETE|UPDATE|INSERT|EXEC)/i,
      /--\s*$/,
      /\/\*.*\*\//,
      /\bUNION\s+SELECT\b/i,
      /\bOR\s+1\s*=\s*1\b/i,
      /\bOR\s+'[^']*'\s*=\s*'[^']*'/i,
      /\bSLEEP\s*\(/i,
      /\bWAITFOR\s+DELAY/i,
      /\bBENCHMARK\s*\(/i
    ];

    const queryStr = JSON.stringify(query);

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(queryStr)) {
        violations.push({
          type: 'dangerous_operation',
          severity: 'error',
          message: 'Query contains potential SQL injection pattern',
          location: 'query structure'
        });
        break;
      }
    }
  }

  /**
   * Validate time window for specific query types
   */
  private validateTimeWindow(
    query: ParsedQuery,
    violations: Violation[],
    _context?: QueryContext
  ): void {
    // Check if this is a portfolio-related query
    const isPortfolioQuery = query.tables.some(
      (t) =>
        t.name.toLowerCase().includes('portfolio') ||
        t.name.toLowerCase().includes('investment') ||
        t.name.toLowerCase().includes('position')
    );

    if (isPortfolioQuery) {
      const hasDateFilter = query.whereConditions.some(
        (c) => c.column.toLowerCase().includes('date') || c.column.toLowerCase().includes('period')
      );

      if (!hasDateFilter) {
        violations.push({
          type: 'missing_time_window',
          severity: 'warning',
          message: 'Portfolio queries should include a time window (recommended: 3 months)',
          location: 'WHERE clause'
        });
      } else {
        // Check if the time window is too broad
        const hasBroadDateRange = query.whereConditions.some((c) => {
          if (c.column.toLowerCase().includes('date')) {
            // This is simplified - real implementation would parse date values
            return c.operator === '>=' && !c.value?.toString().includes('DATEADD');
          }
          return false;
        });

        if (hasBroadDateRange) {
          violations.push({
            type: 'broad_time_range',
            severity: 'warning',
            message: 'Portfolio query time range may be too broad (recommended: limit to 3 months)',
            location: 'WHERE clause date filter'
          });
        }
      }
    }
  }

  /**
   * Deep check for SQL injection risk
   */
  private containsSQLInjectionRisk(query: ParsedQuery): boolean {
    // Check for string concatenation in values
    const hasStringConcat = query.whereConditions.some((c) => {
      const valueStr = String(c.value);
      return valueStr.includes('+') || valueStr.includes('||') || valueStr.includes('CONCAT');
    });

    // Check for suspicious comment patterns
    const queryStr = JSON.stringify(query);
    const hasComments =
      queryStr.includes('--') || queryStr.includes('/*') || queryStr.includes('*/');

    // Check for multiple statements
    const hasMultipleStatements =
      queryStr.includes(';') && queryStr.indexOf(';') < queryStr.length - 10;

    return hasStringConcat || hasComments || hasMultipleStatements;
  }

  /**
   * Check if a specific column is properly filtered
   */
  isColumnFiltered(query: ParsedQuery, column: string): boolean {
    return query.whereConditions.some((c) => c.column.toLowerCase() === column.toLowerCase());
  }

  /**
   * Get security score for the query (0-100)
   */
  getSecurityScore(result: ValidationResult): number {
    if (!result.isSafe) return 0;

    const errorCount = result.violations.filter((v) => v.severity === 'error').length;
    const warningCount = result.violations.filter((v) => v.severity === 'warning').length;

    let score = 100;
    score -= errorCount * 30;
    score -= warningCount * 10;

    return Math.max(0, score);
  }
}
