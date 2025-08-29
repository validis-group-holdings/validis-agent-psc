import { QueryAnalysis } from '@/types';

/**
 * SQL Query Parser for security analysis
 * Parses SQL queries to extract tables, operations, and security-relevant patterns
 */

export class QueryParser {
  
  /**
   * Parse a SQL query and extract security-relevant information
   */
  static parse(query: string): QueryAnalysis {
    const normalizedQuery = query.toLowerCase().trim();
    
    return {
      tables: this.extractTables(normalizedQuery),
      operations: this.extractOperations(normalizedQuery),
      hasUploadTable: this.hasUploadTablePattern(normalizedQuery),
      hasClientIdFilter: this.hasClientIdFilter(normalizedQuery),
      isSelectOnly: this.isSelectOnlyQuery(normalizedQuery),
      estimatedComplexity: this.estimateComplexity(normalizedQuery)
    };
  }

  /**
   * Extract table names from SQL query
   */
  private static extractTables(query: string): string[] {
    const tables: Set<string> = new Set();
    
    // Match FROM clauses
    const fromMatches = query.match(/from\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g);
    if (fromMatches) {
      fromMatches.forEach(match => {
        const tableName = match.replace(/from\s+/i, '').trim();
        tables.add(tableName);
      });
    }
    
    // Match JOIN clauses
    const joinMatches = query.match(/(?:inner\s+join|left\s+join|right\s+join|full\s+join|join)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g);
    if (joinMatches) {
      joinMatches.forEach(match => {
        const tableName = match.replace(/(?:inner\s+join|left\s+join|right\s+join|full\s+join|join)\s+/i, '').trim();
        tables.add(tableName);
      });
    }
    
    // Match UPDATE statements
    const updateMatches = query.match(/update\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g);
    if (updateMatches) {
      updateMatches.forEach(match => {
        const tableName = match.replace(/update\s+/i, '').trim();
        tables.add(tableName);
      });
    }
    
    // Match INSERT INTO statements
    const insertMatches = query.match(/insert\s+into\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g);
    if (insertMatches) {
      insertMatches.forEach(match => {
        const tableName = match.replace(/insert\s+into\s+/i, '').trim();
        tables.add(tableName);
      });
    }
    
    // Match DELETE FROM statements
    const deleteMatches = query.match(/delete\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g);
    if (deleteMatches) {
      deleteMatches.forEach(match => {
        const tableName = match.replace(/delete\s+from\s+/i, '').trim();
        tables.add(tableName);
      });
    }
    
    return Array.from(tables);
  }

  /**
   * Extract SQL operations from query
   */
  private static extractOperations(query: string): string[] {
    const operations: Set<string> = new Set();
    
    const operationPatterns = [
      { pattern: /^\s*select\b/i, operation: 'SELECT' },
      { pattern: /^\s*insert\b/i, operation: 'INSERT' },
      { pattern: /^\s*update\b/i, operation: 'UPDATE' },
      { pattern: /^\s*delete\b/i, operation: 'DELETE' },
      { pattern: /^\s*create\b/i, operation: 'CREATE' },
      { pattern: /^\s*drop\b/i, operation: 'DROP' },
      { pattern: /^\s*alter\b/i, operation: 'ALTER' },
      { pattern: /^\s*truncate\b/i, operation: 'TRUNCATE' },
      { pattern: /\bjoin\b/i, operation: 'JOIN' },
      { pattern: /\bunion\b/i, operation: 'UNION' },
      { pattern: /\bexists\b|\(\s*select\b/i, operation: 'SUBQUERY' },
      { pattern: /\bgroup\s+by\b/i, operation: 'GROUP_BY' },
      { pattern: /\border\s+by\b/i, operation: 'ORDER_BY' },
      { pattern: /\bhaving\b/i, operation: 'HAVING' }
    ];
    
    operationPatterns.forEach(({ pattern, operation }) => {
      if (pattern.test(query)) {
        operations.add(operation);
      }
    });
    
    return Array.from(operations);
  }

  /**
   * Check if query uses upload table pattern
   */
  private static hasUploadTablePattern(query: string): boolean {
    const uploadTablePatterns = [
      /\bupload_table_\w+/i,
      /\bupload_\w+/i,  // matches upload_test_202401, upload_client_a_202401, etc.
      /\w+_upload\b/i,  // matches client_upload, data_upload_temp, etc.
      /\bupload\w*table\w*/i,
      /\bclient_upload/i,
      /\btemp_upload/i,
      /\b\w*upload\w*/i  // broad pattern for any word containing 'upload'
    ];
    
    return uploadTablePatterns.some(pattern => pattern.test(query));
  }

  /**
   * Check if query has client_id filtering
   */
  private static hasClientIdFilter(query: string): boolean {
    const clientIdPatterns = [
      /where.*client_id\s*[=]/,
      /and.*client_id\s*[=]/,
      /client_id\s*[=]\s*['"]?\w+['"]?/,
      /client_id\s+in\s*\(/
    ];
    
    return clientIdPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Check if query is SELECT only (no modifications)
   */
  private static isSelectOnlyQuery(query: string): boolean {
    const modifyingOperations = [
      /^\s*insert\b/i,
      /^\s*update\b/i,
      /^\s*delete\b/i,
      /^\s*create\b/i,
      /^\s*drop\b/i,
      /^\s*alter\b/i,
      /^\s*truncate\b/i
    ];
    
    return !modifyingOperations.some(pattern => pattern.test(query));
  }

  /**
   * Estimate query complexity based on patterns
   */
  private static estimateComplexity(query: string): 'low' | 'medium' | 'high' {
    let complexityScore = 0;
    
    // Count tables
    const tables = this.extractTables(query);
    complexityScore += tables.length;
    
    // Check for complex operations
    const complexPatterns = [
      { pattern: /\bjoin\b/gi, score: 2 },
      { pattern: /\bunion\b/gi, score: 2 },
      { pattern: /\bexists\b|\(\s*select\b/gi, score: 3 },
      { pattern: /\bgroup\s+by\b/gi, score: 1 },
      { pattern: /\border\s+by\b/gi, score: 1 },
      { pattern: /\bhaving\b/gi, score: 2 },
      { pattern: /\bcase\s+when\b/gi, score: 1 },
      { pattern: /\blike\b/gi, score: 1 },
      { pattern: /\bin\s*\(/gi, score: 1 },
      { pattern: /\bwith\b.*\bas\b/gi, score: 2 } // CTE
    ];
    
    complexPatterns.forEach(({ pattern, score }) => {
      const matches = query.match(pattern);
      if (matches) {
        complexityScore += matches.length * score;
      }
    });
    
    // Length-based complexity
    if (query.length > 1000) complexityScore += 2;
    else if (query.length > 500) complexityScore += 1;
    
    if (complexityScore <= 3) return 'low';
    if (complexityScore <= 8) return 'medium';
    return 'high';
  }

  /**
   * Extract column names from SELECT clause
   */
  static extractSelectColumns(query: string): string[] {
    const normalizedQuery = query.toLowerCase().trim();
    const selectMatch = normalizedQuery.match(/select\s+(.*?)\s+from/s);
    
    if (!selectMatch) return [];
    
    const selectClause = selectMatch[1];
    
    // Handle SELECT *
    if (selectClause.trim() === '*') {
      return ['*'];
    }
    
    // Split by comma and clean up
    const columns = selectClause.split(',').map(col => {
      // Remove AS aliases and whitespace
      return col.replace(/\s+as\s+\w+/gi, '').trim();
    });
    
    return columns;
  }

  /**
   * Check for potentially dangerous patterns
   */
  static hasDangerousPatterns(query: string): string[] {
    const dangerousPatterns = [
      { pattern: /;\s*(drop|delete|truncate|alter)\b/i, message: 'Multiple statements with dangerous operations' },
      { pattern: /union.*select.*from/i, message: 'Potential SQL injection via UNION' },
      { pattern: /\bor\s+['"]\d+['"]?\s*=\s*['"]\d+['"]?/i, message: 'Potential SQL injection pattern' },
      { pattern: /--[^\r\n]*|\/\*[\s\S]*?\*\//g, message: 'SQL comments detected' },
      { pattern: /exec\s*\(/i, message: 'Dynamic SQL execution' },
      { pattern: /xp_cmdshell/i, message: 'Command execution function' },
      { pattern: /sp_executesql/i, message: 'Dynamic SQL procedure' }
    ];
    
    const detected: string[] = [];
    
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(query)) {
        detected.push(message);
      }
    });
    
    return detected;
  }
}