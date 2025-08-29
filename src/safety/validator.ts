import { QueryAnalysis, SafetyValidation } from '@/types';
import { QueryParser } from './parser';
import { validateUploadTable } from '@/db/uploadTableHelpers';
import { config } from '@/config';

/**
 * Query Validator - Ensures queries meet safety requirements
 */
export class QueryValidator {
  
  /**
   * Validate a query for safety and security compliance
   */
  static async validate(
    query: string, 
    clientId: string, 
    workflowMode: 'audit' | 'lending'
  ): Promise<SafetyValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // Parse the query first
      const analysis = QueryParser.parse(query);
      
      // Check for dangerous patterns
      const dangerousPatterns = QueryParser.hasDangerousPatterns(query);
      if (dangerousPatterns.length > 0) {
        errors.push(...dangerousPatterns);
      }
      
      // Validate query is SELECT only for read operations
      if (!analysis.isSelectOnly) {
        errors.push('Only SELECT queries are allowed for data analysis');
      }
      
      // Validate upload table usage
      const uploadTableValidation = await this.validateUploadTableUsage(analysis, clientId);
      if (!uploadTableValidation.isValid) {
        errors.push(...uploadTableValidation.errors);
        warnings.push(...uploadTableValidation.warnings);
      }
      
      // Validate client_id filtering for audit mode
      if (workflowMode === 'audit') {
        const clientIdValidation = this.validateClientIdFiltering(analysis, query);
        if (!clientIdValidation.isValid) {
          errors.push(...clientIdValidation.errors);
          warnings.push(...clientIdValidation.warnings);
        }
      }
      
      // Check for full table scans
      const tableScamValidation = this.validateNoFullTableScan(query, analysis);
      if (!tableScamValidation.isValid) {
        warnings.push(...tableScamValidation.warnings);
      }
      
      // Validate query complexity
      const complexityValidation = this.validateComplexity(analysis);
      if (!complexityValidation.isValid) {
        warnings.push(...complexityValidation.warnings);
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
      
    } catch (error) {
      return {
        isValid: false,
        errors: [`Query validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: []
      };
    }
  }

  /**
   * Validate that query uses upload tables as entry point
   */
  private static async validateUploadTableUsage(
    analysis: QueryAnalysis, 
    clientId: string
  ): Promise<SafetyValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check if query has any upload table
    if (!analysis.hasUploadTable) {
      errors.push('Query must use upload tables as the primary entry point for data access');
      return { isValid: false, errors, warnings };
    }
    
    // Validate each table exists and is accessible
    const uploadTables = analysis.tables.filter(table => 
      this.isUploadTableName(table)
    );
    
    if (uploadTables.length === 0) {
      errors.push('No valid upload tables detected in query');
      return { isValid: false, errors, warnings };
    }
    
    // Validate each upload table exists and is accessible to client
    for (const tableName of uploadTables) {
      try {
        const isValid = await validateUploadTable(tableName, clientId);
        if (!isValid) {
          errors.push(`Upload table '${tableName}' not found or not accessible for client ${clientId}`);
        }
      } catch (error) {
        errors.push(`Failed to validate upload table '${tableName}': ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Check for non-upload tables
    const nonUploadTables = analysis.tables.filter(table => 
      !this.isUploadTableName(table)
    );
    
    if (nonUploadTables.length > 0) {
      warnings.push(`Query accesses non-upload tables: ${nonUploadTables.join(', ')}. Ensure this is intentional.`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate client_id filtering is present for audit mode
   */
  private static validateClientIdFiltering(
    analysis: QueryAnalysis, 
    query: string
  ): SafetyValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!analysis.hasClientIdFilter) {
      errors.push('Query must include CLIENT_ID filtering for audit workflow mode');
    }
    
    // Additional validation for client_id filter placement
    const normalizedQuery = query.toLowerCase();
    const hasWhereClause = normalizedQuery.includes('where');
    
    if (hasWhereClause && analysis.hasClientIdFilter) {
      // Check if client_id is in WHERE clause (good) vs only in SELECT or other places
      const whereClauseMatch = normalizedQuery.match(/where\s+(.*?)(?:\s+group\s+by|\s+order\s+by|\s+having|$)/s);
      if (whereClauseMatch) {
        const whereClause = whereClauseMatch[1];
        if (!whereClause.includes('client_id')) {
          warnings.push('CLIENT_ID filter should be in WHERE clause for optimal performance');
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate query doesn't perform full table scans
   */
  private static validateNoFullTableScan(
    query: string, 
    analysis: QueryAnalysis
  ): SafetyValidation {
    const warnings: string[] = [];
    
    const normalizedQuery = query.toLowerCase();
    
    // Check for WHERE clause
    if (!normalizedQuery.includes('where')) {
      warnings.push('Query lacks WHERE clause - may result in full table scan');
    }
    
    // Check for LIKE without leading wildcard
    const likeMatches = normalizedQuery.match(/like\s+['"]%.*?['"]/g);
    if (likeMatches) {
      warnings.push('LIKE with leading wildcard detected - may cause poor performance');
    }
    
    // Check for functions in WHERE clause
    const functionInWhereMatches = normalizedQuery.match(/where.*?\b(upper|lower|substring|convert)\s*\(/);
    if (functionInWhereMatches) {
      warnings.push('Functions in WHERE clause detected - may prevent index usage');
    }
    
    // Check for OR conditions (can prevent index usage)
    const orMatches = normalizedQuery.match(/\bor\b/g);
    if (orMatches && orMatches.length > 2) {
      warnings.push('Multiple OR conditions detected - consider UNION for better performance');
    }
    
    return {
      isValid: true, // warnings don't invalidate
      errors: [],
      warnings
    };
  }

  /**
   * Validate query complexity is within acceptable limits
   */
  private static validateComplexity(analysis: QueryAnalysis): SafetyValidation {
    const warnings: string[] = [];
    
    if (analysis.estimatedComplexity === 'high') {
      warnings.push('High complexity query detected - consider breaking into smaller queries');
    }
    
    if (analysis.tables.length > 5) {
      warnings.push(`Query joins ${analysis.tables.length} tables - consider reducing complexity`);
    }
    
    if (analysis.operations.includes('SUBQUERY')) {
      warnings.push('Subqueries detected - consider using JOINs for better performance');
    }
    
    return {
      isValid: true, // warnings don't invalidate
      errors: [],
      warnings
    };
  }

  /**
   * Check if table name follows upload table pattern
   */
  private static isUploadTableName(tableName: string): boolean {
    const uploadPatterns = [
      /^upload_table_/i,
      /_upload$/i,
      /^client_upload/i,
      /^temp_upload/i,
      /upload.*table/i
    ];
    
    return uploadPatterns.some(pattern => pattern.test(tableName));
  }

  /**
   * Sanitize query by removing potentially dangerous content
   */
  static sanitizeQuery(query: string): string {
    return query
      // Remove SQL comments
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove multiple semicolons
      .replace(/;+/g, ';')
      // Trim whitespace
      .trim();
  }

  /**
   * Quick validation for basic query safety
   */
  static quickValidate(query: string): { isValid: boolean; reason?: string } {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Check for dangerous operations
    const dangerousOperations = [
      'drop', 'delete', 'truncate', 'alter', 'create', 
      'insert', 'update', 'exec', 'execute'
    ];
    
    for (const operation of dangerousOperations) {
      if (new RegExp(`^\\s*${operation}\\b`, 'i').test(normalizedQuery)) {
        return { 
          isValid: false, 
          reason: `${operation.toUpperCase()} operations are not allowed` 
        };
      }
    }
    
    // Check for multiple statements
    const statements = query.split(';').filter(s => s.trim().length > 0);
    if (statements.length > 1) {
      return { 
        isValid: false, 
        reason: 'Multiple SQL statements are not allowed' 
      };
    }
    
    return { isValid: true };
  }
}