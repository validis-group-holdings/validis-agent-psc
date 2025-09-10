/**
 * SQL Query Parser and Analyzer
 * Parses SQL queries and extracts structural information for optimization
 */

import { Parser, AST, Select } from 'node-sql-parser';
import {
  ParsedQuery,
  QueryType,
  TableReference,
  WhereCondition,
  JoinInfo,
  OrderByClause,
  CTEInfo
} from './types';

export class QueryParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Parse SQL query string into structured format
   */
  parse(sql: string): ParsedQuery {
    try {
      // Parse the SQL query - use TransactSQL for MSSQL compatibility
      const ast = this.parser.astify(sql, { database: 'TransactSQL' });

      // Handle single or multiple statements
      const primaryAst = Array.isArray(ast) ? ast[0] : ast;

      if (!primaryAst) {
        throw new Error('Failed to parse SQL query');
      }

      const queryType = this.getQueryType(primaryAst);

      // Extract components based on query type
      if (queryType === 'select' && this.isSelectStatement(primaryAst)) {
        return this.parseSelectQuery(primaryAst, ast);
      } else {
        // For non-SELECT queries, return basic info
        return {
          ast,
          type: queryType,
          tables: this.extractTables(primaryAst),
          columns: [],
          whereConditions: [],
          joins: [],
          ctes: []
        };
      }
    } catch (error) {
      throw new Error(
        `SQL parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Convert parsed query back to SQL string
   */
  toSQL(ast: AST | AST[]): string {
    try {
      return this.parser.sqlify(ast, { database: 'TransactSQL' });
    } catch (error) {
      throw new Error(
        `SQL generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Parse SELECT query and extract detailed information
   */
  private parseSelectQuery(ast: Select, fullAst: AST | AST[]): ParsedQuery {
    return {
      ast: fullAst,
      type: 'select',
      tables: this.extractTables(ast),
      columns: this.extractColumns(ast),
      whereConditions: this.extractWhereConditions(ast),
      joins: this.extractJoins(ast),
      limit: this.extractLimit(ast),
      orderBy: this.extractOrderBy(ast),
      groupBy: this.extractGroupBy(ast),
      having: ast.having,
      ctes: this.extractCTEs(ast)
    };
  }

  /**
   * Determine the type of SQL query
   */
  private getQueryType(ast: AST): QueryType {
    const queryType = ast.type as string;
    switch (queryType) {
      case 'select':
        return 'select';
      case 'insert':
        return 'insert';
      case 'update':
        return 'update';
      case 'delete':
        return 'delete';
      case 'drop':
        return 'drop';
      case 'alter':
        return 'alter';
      case 'create':
        return 'create';
      case 'truncate':
        return 'truncate';
      default:
        return 'other';
    }
  }

  /**
   * Type guard for SELECT statements
   */
  private isSelectStatement(ast: AST): ast is Select {
    return ast.type === 'select';
  }

  /**
   * Extract table references from query
   */
  private extractTables(ast: AST): TableReference[] {
    const tables: TableReference[] = [];

    // Handle FROM clause for SELECT statements
    if (this.isSelectStatement(ast) && ast.from) {
      const fromArray = Array.isArray(ast.from) ? ast.from : [ast.from];
      fromArray.forEach((fromItem: any) => {
        if ('table' in fromItem) {
          tables.push({
            name: fromItem.table as string,
            alias: fromItem.as || undefined,
            database: fromItem.db || undefined,
            schema: fromItem.schema || undefined
          });
        }
      });
    }

    // Handle other statement types
    if ('table' in ast && ast.table) {
      const tableInfo = ast.table as any;
      if (Array.isArray(tableInfo)) {
        tableInfo.forEach((t: any) => {
          if (typeof t === 'string') {
            tables.push({ name: t });
          } else if (t && t.table) {
            tables.push({
              name: t.table,
              database: t.db,
              schema: t.schema
            });
          }
        });
      } else if (typeof tableInfo === 'string') {
        tables.push({ name: tableInfo });
      } else if (tableInfo.table) {
        tables.push({
          name: tableInfo.table,
          database: tableInfo.db,
          schema: tableInfo.schema
        });
      }
    }

    return tables;
  }

  /**
   * Extract column references from SELECT query
   */
  private extractColumns(ast: Select): string[] {
    const columns: string[] = [];

    // Handle star selection
    if (typeof ast.columns === 'string' && ast.columns === '*') {
      columns.push('*');
    } else if (Array.isArray(ast.columns)) {
      ast.columns.forEach((col: any) => {
        if (typeof col === 'string') {
          columns.push(col);
        } else if (col.expr) {
          if (col.expr.type === 'column_ref') {
            columns.push(col.expr.column as string);
          } else if (col.as) {
            columns.push(col.as);
          }
        }
      });
    }

    return columns;
  }

  /**
   * Extract WHERE conditions from query
   */
  private extractWhereConditions(ast: Select): WhereCondition[] {
    const conditions: WhereCondition[] = [];

    if (!ast.where) {
      return conditions;
    }

    this.extractConditionsFromExpression(ast.where, conditions);
    return conditions;
  }

  /**
   * Recursively extract conditions from WHERE expression
   */
  private extractConditionsFromExpression(expr: any, conditions: WhereCondition[]): void {
    if (!expr) return;

    if (expr.type === 'binary_expr') {
      if (expr.operator === 'AND' || expr.operator === 'OR') {
        // Recursively process both sides
        this.extractConditionsFromExpression(expr.left, conditions);
        this.extractConditionsFromExpression(expr.right, conditions);
      } else {
        // This is a comparison
        if (expr.left && expr.left.type === 'column_ref') {
          conditions.push({
            column: expr.left.column as string,
            operator: expr.operator,
            value: this.extractValue(expr.right),
            type: 'simple'
          });
        }
      }
    } else if (expr.type === 'in' || expr.type === 'not_in') {
      if (expr.left && expr.left.type === 'column_ref') {
        conditions.push({
          column: expr.left.column as string,
          operator: expr.type,
          value: expr.right,
          type: expr.right.type === 'select' ? 'subquery' : 'simple'
        });
      }
    } else if (expr.type === 'between' || expr.type === 'not_between') {
      if (expr.left && expr.left.type === 'column_ref') {
        conditions.push({
          column: expr.left.column as string,
          operator: expr.type,
          value: expr.right,
          type: 'simple'
        });
      }
    } else if (expr.type === 'exists' || expr.type === 'not_exists') {
      conditions.push({
        column: '',
        operator: expr.type,
        value: expr.value,
        type: 'subquery'
      });
    }
  }

  /**
   * Extract value from expression
   */
  private extractValue(expr: any): any {
    if (!expr) return null;

    switch (expr.type) {
      case 'string':
      case 'number':
      case 'bool':
        return expr.value;
      case 'null':
        return null;
      case 'column_ref':
        return `column:${expr.column}`;
      case 'function':
        return `function:${expr.name}`;
      case 'select':
        return 'subquery';
      default:
        return expr.value || expr;
    }
  }

  /**
   * Extract JOIN information from query
   */
  private extractJoins(ast: Select): JoinInfo[] {
    const joins: JoinInfo[] = [];

    if (!ast.from) return joins;

    const fromArray = Array.isArray(ast.from) ? ast.from : [ast.from];
    fromArray.forEach((fromItem: any) => {
      if (fromItem.join) {
        joins.push({
          type: (fromItem.join || 'inner').toLowerCase() as JoinInfo['type'],
          table: {
            name: fromItem.table,
            alias: fromItem.as,
            database: fromItem.db,
            schema: fromItem.schema
          },
          condition: this.extractJoinCondition(fromItem.on),
          columns: this.extractJoinColumns(fromItem.on)
        });
      }
    });

    return joins;
  }

  /**
   * Extract JOIN condition as string
   */
  private extractJoinCondition(on: any): string {
    if (!on) return '';

    // Convert the ON condition back to string
    try {
      return this.expressionToString(on);
    } catch {
      return 'complex condition';
    }
  }

  /**
   * Convert expression to string representation
   */
  private expressionToString(expr: any): string {
    if (!expr) return '';

    if (expr.type === 'binary_expr') {
      const left = this.expressionToString(expr.left);
      const right = this.expressionToString(expr.right);
      return `${left} ${expr.operator} ${right}`;
    } else if (expr.type === 'column_ref') {
      const table = expr.table ? `${expr.table}.` : '';
      return `${table}${expr.column}`;
    } else if (expr.type === 'string') {
      return `'${expr.value}'`;
    } else if (expr.type === 'number') {
      return expr.value.toString();
    }

    return '';
  }

  /**
   * Extract columns used in JOIN condition
   */
  private extractJoinColumns(on: any): string[] {
    const columns: string[] = [];

    if (!on) return columns;

    this.extractColumnsFromExpression(on, columns);
    return [...new Set(columns)]; // Remove duplicates
  }

  /**
   * Recursively extract column references from expression
   */
  private extractColumnsFromExpression(expr: any, columns: string[]): void {
    if (!expr) return;

    if (expr.type === 'column_ref') {
      columns.push(expr.column as string);
    } else if (expr.type === 'binary_expr') {
      this.extractColumnsFromExpression(expr.left, columns);
      this.extractColumnsFromExpression(expr.right, columns);
    } else if (expr.left) {
      this.extractColumnsFromExpression(expr.left, columns);
    }
    if (expr.right) {
      this.extractColumnsFromExpression(expr.right, columns);
    }
  }

  /**
   * Extract LIMIT/TOP clause
   */
  private extractLimit(ast: Select): number | undefined {
    if (ast.limit) {
      if (Array.isArray(ast.limit)) {
        return ast.limit[0]?.value;
      } else if (typeof ast.limit === 'object' && 'value' in ast.limit) {
        const limitVal = (ast.limit as any).value;
        if (Array.isArray(limitVal)) {
          return limitVal[0]?.value;
        }
        return limitVal;
      }
    }

    // Check for TOP clause (MSSQL specific)
    if ((ast as any).top) {
      return (ast as any).top.value;
    }

    return undefined;
  }

  /**
   * Extract ORDER BY clause
   */
  private extractOrderBy(ast: Select): OrderByClause[] {
    const orderBy: OrderByClause[] = [];

    if (ast.orderby) {
      ast.orderby.forEach((item: any) => {
        if (item.expr && item.expr.type === 'column_ref') {
          orderBy.push({
            column: item.expr.column as string,
            direction: (item.type || 'asc').toLowerCase() as 'asc' | 'desc'
          });
        }
      });
    }

    return orderBy;
  }

  /**
   * Extract GROUP BY clause
   */
  private extractGroupBy(ast: Select): string[] {
    const groupBy: string[] = [];

    if (ast.groupby) {
      const groupByArray = Array.isArray(ast.groupby)
        ? ast.groupby
        : (ast.groupby as any).columns || [];
      groupByArray.forEach((item: any) => {
        if (item.type === 'column_ref') {
          groupBy.push(item.column as string);
        }
      });
    }

    return groupBy;
  }

  /**
   * Extract CTEs (Common Table Expressions)
   */
  private extractCTEs(ast: Select): CTEInfo[] {
    const ctes: CTEInfo[] = [];

    if ((ast as any).with) {
      (ast as any).with.forEach((cte: any) => {
        ctes.push({
          name: cte.name,
          columns: cte.columns || [],
          query: this.toSQL(cte.stmt),
          recursive: cte.recursive || false
        });
      });
    }

    return ctes;
  }

  /**
   * Check if query has a specific filter
   */
  hasFilter(query: ParsedQuery, column: string): boolean {
    return query.whereConditions.some(
      (condition) => condition.column.toLowerCase() === column.toLowerCase()
    );
  }

  /**
   * Check if query has a limit
   */
  hasLimit(query: ParsedQuery): boolean {
    return query.limit !== undefined && query.limit > 0;
  }

  /**
   * Get all referenced columns including joins
   */
  getAllColumns(query: ParsedQuery): string[] {
    const columns = new Set<string>();

    // Add SELECT columns
    query.columns.forEach((col) => columns.add(col));

    // Add WHERE columns
    query.whereConditions.forEach((cond) => {
      if (cond.column) columns.add(cond.column);
    });

    // Add JOIN columns
    query.joins.forEach((join) => {
      join.columns.forEach((col) => columns.add(col));
    });

    // Add ORDER BY columns
    query.orderBy?.forEach((ob) => columns.add(ob.column));

    // Add GROUP BY columns
    query.groupBy?.forEach((col) => columns.add(col));

    return Array.from(columns);
  }
}
