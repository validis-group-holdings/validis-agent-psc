/**
 * SQL Query Optimization Rules
 * Defines and applies optimization rules to improve query performance and safety
 */

import { AST, Select } from 'node-sql-parser';
import {
  OptimizationRule,
  ParsedQuery,
  QueryContext,
  QueryModification,
  OptimizationOptions,
  OptimizationResult,
  OptimizationType
} from './types';

export class OptimizationEngine {
  private rules: OptimizationRule[];
  private defaultOptions: OptimizationOptions = {
    enforceUploadId: true,
    enforceClientId: true,
    maxRowLimit: 5000,
    blockDangerousOps: true,
    optimizeJoins: true,
    addCTEs: true,
    analyzePerformance: true
  };

  constructor() {
    this.rules = this.initializeRules();
  }

  /**
   * Apply all optimization rules to a query
   */
  applyOptimizations(
    query: ParsedQuery,
    clientId: string,
    uploadId?: string,
    context?: QueryContext,
    options?: OptimizationOptions
  ): {
    modifiedAst: AST | AST[];
    optimizations: OptimizationResult[];
  } {
    const opts = { ...this.defaultOptions, ...options };
    const optimizations: OptimizationResult[] = [];
    let modifiedAst = query.ast;

    // Sort rules by priority (higher priority first)
    const sortedRules = [...this.rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.condition(query, context)) {
        const action = rule.apply(query, context);

        if (action.type === 'modify' && action.modifications) {
          modifiedAst = this.applyModifications(
            modifiedAst,
            action.modifications,
            clientId,
            uploadId,
            opts
          );

          optimizations.push({
            type: this.getOptimizationType(rule.id),
            description: rule.description,
            impact: action.impact,
            applied: true,
            details: action.message
          });
        } else if (action.type === 'warning') {
          optimizations.push({
            type: this.getOptimizationType(rule.id),
            description: rule.description,
            impact: action.impact,
            applied: false,
            details: action.message
          });
        }
      }
    }

    return { modifiedAst, optimizations };
  }

  /**
   * Initialize optimization rules
   */
  private initializeRules(): OptimizationRule[] {
    return [
      // Rule 1: Enforce uploadId in WHERE clause
      {
        id: 'enforce_upload_id',
        name: 'Enforce Upload ID',
        description: 'Ensure query uses uploadId for clustered index',
        priority: 100,
        condition: (query: ParsedQuery) => {
          return (
            query.type === 'select' &&
            !query.whereConditions.some(
              (c) => c.column.toLowerCase() === 'uploadid' || c.column.toLowerCase() === 'upload_id'
            )
          );
        },
        apply: (_query: ParsedQuery, _context?: QueryContext) => ({
          type: 'modify',
          modifications: [
            {
              type: 'add_filter',
              target: 'where',
              value: 'uploadId',
              description: 'Add uploadId filter for clustered index usage'
            }
          ],
          impact: 'high'
        })
      },

      // Rule 2: Enforce row limit
      {
        id: 'enforce_row_limit',
        name: 'Enforce Row Limit',
        description: 'Add TOP/LIMIT clause if missing',
        priority: 90,
        condition: (query: ParsedQuery) => {
          return query.type === 'select' && !query.limit;
        },
        apply: (_query: ParsedQuery, context?: QueryContext) => ({
          type: 'modify',
          modifications: [
            {
              type: 'add_limit',
              target: 'limit',
              value: context?.maxResults || 5000,
              description: 'Add row limit to prevent excessive data retrieval'
            }
          ],
          impact: 'high'
        })
      },

      // Rule 3: Enforce client_id filter
      {
        id: 'enforce_client_id',
        name: 'Enforce Multi-tenant Filter',
        description: 'Add client_id filter for multi-tenancy',
        priority: 95,
        condition: (query: ParsedQuery) => {
          return (
            query.type === 'select' &&
            !query.whereConditions.some(
              (c) => c.column.toLowerCase() === 'clientid' || c.column.toLowerCase() === 'client_id'
            )
          );
        },
        apply: (_query: ParsedQuery) => ({
          type: 'modify',
          modifications: [
            {
              type: 'add_filter',
              target: 'where',
              value: 'client_id',
              description: 'Add client_id filter for multi-tenant isolation'
            }
          ],
          impact: 'high'
        })
      },

      // Rule 4: Optimize large time windows for portfolio queries
      {
        id: 'optimize_time_window',
        name: 'Optimize Time Window',
        description: 'Limit portfolio queries to 3-month window',
        priority: 80,
        condition: (query: ParsedQuery, _context?: QueryContext) => {
          // Check if this is a portfolio-related query
          const isPortfolioQuery = query.tables.some(
            (t) =>
              t.name.toLowerCase().includes('portfolio') ||
              t.name.toLowerCase().includes('investment') ||
              t.name.toLowerCase().includes('position')
          );

          // Check if there's a date filter
          const hasDateFilter = query.whereConditions.some(
            (c) =>
              c.column.toLowerCase().includes('date') || c.column.toLowerCase().includes('period')
          );

          return isPortfolioQuery && !hasDateFilter;
        },
        apply: (_query: ParsedQuery, _context?: QueryContext) => ({
          type: 'modify',
          modifications: [
            {
              type: 'add_filter',
              target: 'where',
              value: 'date_range_3months',
              description: 'Add 3-month time window for portfolio queries'
            }
          ],
          impact: 'medium'
        })
      },

      // Rule 5: Optimize JOIN operations
      {
        id: 'optimize_joins',
        name: 'Optimize JOINs',
        description: 'Ensure JOINs use indexed columns',
        priority: 70,
        condition: (query: ParsedQuery) => {
          return query.joins.length > 0;
        },
        apply: (query: ParsedQuery) => {
          const unindexedJoins = query.joins.filter(
            (j) =>
              !j.columns.some(
                (c) => c.toLowerCase().includes('id') || c.toLowerCase().includes('key')
              )
          );

          if (unindexedJoins.length > 0) {
            return {
              type: 'warning',
              message: `${unindexedJoins.length} JOIN(s) may not be using indexed columns`,
              impact: 'medium'
            };
          }

          return {
            type: 'modify',
            modifications: [
              {
                type: 'add_index_hint',
                target: 'join',
                value: 'use_index',
                description: 'Add index hints for JOIN operations'
              }
            ],
            impact: 'medium'
          };
        }
      },

      // Rule 6: Add CTEs for complex queries
      {
        id: 'add_ctes',
        name: 'Add CTEs for Performance',
        description: 'Convert complex subqueries to CTEs',
        priority: 60,
        condition: (query: ParsedQuery) => {
          // Check for complex subqueries in WHERE conditions
          const hasSubqueries = query.whereConditions.some((c) => c.type === 'subquery');

          return !!(
            query.type === 'select' &&
            hasSubqueries &&
            query.ctes &&
            query.ctes.length === 0
          );
        },
        apply: (_query: ParsedQuery) => ({
          type: 'modify',
          modifications: [
            {
              type: 'add_cte',
              target: 'with',
              value: 'optimize_subquery',
              description: 'Convert subquery to CTE for better performance'
            }
          ],
          impact: 'medium'
        })
      },

      // Rule 7: Avoid SELECT *
      {
        id: 'avoid_select_star',
        name: 'Avoid SELECT *',
        description: 'Discourage use of SELECT * for performance',
        priority: 50,
        condition: (query: ParsedQuery) => {
          return query.type === 'select' && query.columns.includes('*');
        },
        apply: (_query: ParsedQuery) => ({
          type: 'warning',
          message: 'SELECT * should be avoided. Specify required columns explicitly',
          impact: 'low'
        })
      },

      // Rule 8: Check for missing WHERE clause
      {
        id: 'check_missing_where',
        name: 'Check Missing WHERE',
        description: 'Warn about queries without WHERE clause',
        priority: 85,
        condition: (query: ParsedQuery) => {
          return query.type === 'select' && query.whereConditions.length === 0 && !query.limit;
        },
        apply: (_query: ParsedQuery) => ({
          type: 'warning',
          message: 'Query has no WHERE clause and no LIMIT - this could return excessive data',
          impact: 'high'
        })
      },

      // Rule 9: Optimize LIKE patterns
      {
        id: 'optimize_like_patterns',
        name: 'Optimize LIKE Patterns',
        description: 'Warn about non-sargable LIKE patterns',
        priority: 40,
        condition: (query: ParsedQuery) => {
          return query.whereConditions.some(
            (c) =>
              c.operator.toUpperCase() === 'LIKE' &&
              typeof c.value === 'string' &&
              c.value.startsWith('%')
          );
        },
        apply: (_query: ParsedQuery) => ({
          type: 'warning',
          message: 'LIKE pattern starting with % prevents index usage',
          impact: 'medium'
        })
      },

      // Rule 10: Check for Cartesian products
      {
        id: 'check_cartesian_product',
        name: 'Check Cartesian Product',
        description: 'Detect potential Cartesian products',
        priority: 75,
        condition: (query: ParsedQuery) => {
          // Check for CROSS JOIN or JOIN without ON condition
          return query.joins.some((j) => j.type === 'cross' || !j.condition);
        },
        apply: (_query: ParsedQuery) => ({
          type: 'warning',
          message:
            'Query contains potential Cartesian product - this could result in excessive rows',
          impact: 'high'
        })
      }
    ];
  }

  /**
   * Apply modifications to AST
   */
  private applyModifications(
    ast: AST | AST[],
    modifications: QueryModification[],
    clientId: string,
    uploadId?: string,
    options?: OptimizationOptions
  ): AST | AST[] {
    const primaryAst = Array.isArray(ast) ? ast[0] : ast;

    if (!this.isSelectStatement(primaryAst)) {
      return ast;
    }

    for (const mod of modifications) {
      switch (mod.type) {
        case 'add_filter':
          this.addWhereCondition(primaryAst, mod.value, clientId, uploadId);
          break;
        case 'add_limit':
          this.addLimit(primaryAst, mod.value, options?.maxRowLimit);
          break;
        case 'add_cte':
          this.addCTE(primaryAst, mod.value);
          break;
        case 'add_index_hint':
          this.addIndexHint(primaryAst);
          break;
      }
    }

    return Array.isArray(ast) ? [primaryAst, ...ast.slice(1)] : primaryAst;
  }

  /**
   * Add WHERE condition to AST
   */
  private addWhereCondition(
    ast: Select,
    filterType: string,
    clientId: string,
    uploadId?: string
  ): void {
    let newCondition: any;

    switch (filterType) {
      case 'uploadId':
        if (!uploadId) return;
        newCondition = {
          type: 'binary_expr',
          operator: '=',
          left: { type: 'column_ref', table: null, column: 'uploadId' },
          right: { type: 'string', value: uploadId }
        };
        break;

      case 'client_id':
        newCondition = {
          type: 'binary_expr',
          operator: '=',
          left: { type: 'column_ref', table: null, column: 'client_id' },
          right: { type: 'string', value: clientId }
        };
        break;

      case 'date_range_3months':
        newCondition = {
          type: 'binary_expr',
          operator: '>=',
          left: { type: 'column_ref', table: null, column: 'transaction_date' },
          right: {
            type: 'function',
            name: 'DATEADD',
            args: [
              { type: 'string', value: 'month' },
              { type: 'number', value: -3 },
              { type: 'function', name: 'GETDATE', args: [] }
            ]
          }
        };
        break;

      default:
        return;
    }

    if (ast.where) {
      // Combine with existing WHERE clause using AND
      ast.where = {
        type: 'binary_expr',
        operator: 'AND',
        left: ast.where,
        right: newCondition
      };
    } else {
      ast.where = newCondition;
    }
  }

  /**
   * Add LIMIT/TOP to query
   */
  private addLimit(ast: Select, limit: number, maxLimit?: number): void {
    const finalLimit = Math.min(limit, maxLimit || 5000);

    // For MSSQL, use TOP clause
    (ast as any).top = {
      value: finalLimit,
      percent: false
    };

    // Also set limit for compatibility
    ast.limit = {
      seperator: '',
      value: [{ type: 'number', value: finalLimit }]
    } as any;
  }

  /**
   * Add CTE to query
   */
  private addCTE(ast: Select, _cteName: string): void {
    // This is a placeholder - actual CTE generation would be more complex
    // and would need to analyze the specific subquery to convert
    if (!(ast as any).with) {
      (ast as any).with = [];
    }

    // Note: In a real implementation, we would analyze the subqueries
    // and convert them to appropriate CTEs
  }

  /**
   * Add index hints to query
   */
  private addIndexHint(ast: Select): void {
    // MSSQL-specific index hints would be added here
    // This would modify the FROM clause to include WITH (INDEX(...))
    if (ast.from) {
      const fromArray = Array.isArray(ast.from) ? ast.from : [ast.from];
      fromArray.forEach((table: any) => {
        if (table.table && !table.index) {
          // Add index hint based on table name
          // This is simplified - real implementation would look up actual indexes
          if (table.table.toLowerCase().includes('transaction')) {
            table.index = 'IX_uploadId_client_id';
          }
        }
      });
    }
  }

  /**
   * Type guard for SELECT statements
   */
  private isSelectStatement(ast: AST): ast is Select {
    return ast.type === 'select';
  }

  /**
   * Map rule ID to optimization type
   */
  private getOptimizationType(ruleId: string): OptimizationType {
    const mapping: Record<string, OptimizationType> = {
      enforce_upload_id: 'index_usage',
      enforce_row_limit: 'row_limit',
      enforce_client_id: 'multi_tenant_filter',
      optimize_time_window: 'time_window',
      optimize_joins: 'join_optimization',
      add_ctes: 'cte_addition',
      avoid_select_star: 'column_pruning',
      check_missing_where: 'predicate_pushdown',
      optimize_like_patterns: 'index_usage',
      check_cartesian_product: 'join_optimization'
    };

    return mapping[ruleId] || 'index_usage';
  }
}
