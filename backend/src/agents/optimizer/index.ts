/**
 * Query Optimizer Agent
 * Main entry point for SQL query optimization
 */

import { QueryParser } from './queryParser';
import { OptimizationEngine } from './optimizationRules';
import { SafetyValidator } from './safetyValidator';
import { PerformanceAnalyzer } from './performanceAnalyzer';
import {
  OptimizationRequest,
  OptimizationResponse,
  ParsedQuery,
  ValidationResult,
  PerformanceAnalysis,
  Warning,
  OptimizationResult
} from './types';

export class QueryOptimizer {
  private parser: QueryParser;
  private optimizer: OptimizationEngine;
  private validator: SafetyValidator;
  private analyzer: PerformanceAnalyzer;
  private debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.parser = new QueryParser();
    this.optimizer = new OptimizationEngine();
    this.validator = new SafetyValidator();
    this.analyzer = new PerformanceAnalyzer();
    this.debugMode = debugMode;
  }

  /**
   * Main optimization entry point
   */
  async optimize(request: OptimizationRequest): Promise<OptimizationResponse> {
    const startTime = Date.now();
    const warnings: Warning[] = [];
    const errors: string[] = [];

    try {
      this.log('Starting optimization', { sql: request.sql });

      // Step 1: Parse the SQL query
      let parsedQuery: ParsedQuery;
      try {
        parsedQuery = this.parser.parse(request.sql);
        this.log('Query parsed successfully', {
          type: parsedQuery.type,
          tables: parsedQuery.tables.map((t) => t.name)
        });
      } catch (error) {
        const errorMsg = `Failed to parse SQL: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        return this.createErrorResponse(request.sql, errorMsg);
      }

      // Step 2: Validate query safety
      const validationResult = this.validator.validate(
        parsedQuery,
        request.context,
        request.options
      );
      this.log('Validation completed', {
        isValid: validationResult.isValid,
        isSafe: validationResult.isSafe,
        violations: validationResult.violations.length
      });

      // Add validation violations as warnings or errors
      for (const violation of validationResult.violations) {
        if (violation.severity === 'error') {
          errors.push(violation.message);
        } else {
          warnings.push({
            level: violation.severity as 'warning' | 'info',
            code: `VALIDATION_${violation.type.toUpperCase()}`,
            message: violation.message,
            suggestion: this.getSuggestionForViolation(violation.type)
          });
        }
      }

      // If query is not safe, return early with errors
      if (!validationResult.isSafe) {
        return this.createErrorResponse(
          request.sql,
          'Query failed safety validation',
          errors,
          warnings
        );
      }

      // Step 3: Apply optimizations
      const { modifiedAst, optimizations } = this.optimizer.applyOptimizations(
        parsedQuery,
        request.clientId,
        request.uploadId,
        request.context,
        request.options
      );
      this.log('Optimizations applied', {
        count: optimizations.length,
        applied: optimizations.filter((o) => o.applied).length
      });

      // Step 4: Generate optimized SQL
      let optimizedSql: string;
      try {
        optimizedSql = this.parser.toSQL(modifiedAst);
        this.log('Optimized SQL generated');
      } catch (error) {
        const errorMsg = `Failed to generate optimized SQL: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        return this.createErrorResponse(request.sql, errorMsg, errors, warnings);
      }

      // Step 5: Re-parse and validate the optimized query
      const optimizedParsedQuery = this.parser.parse(optimizedSql);
      const optimizedValidation = this.validator.validate(
        optimizedParsedQuery,
        request.context,
        request.options
      );

      if (!optimizedValidation.isSafe) {
        errors.push('Optimized query failed safety validation');
        return this.createErrorResponse(
          request.sql,
          'Optimization resulted in unsafe query',
          errors,
          warnings
        );
      }

      // Step 6: Analyze performance
      const performanceAnalysis = this.analyzer.analyze(optimizedParsedQuery, request.context);
      this.log('Performance analysis completed', {
        scanType: performanceAnalysis.scanType,
        score: performanceAnalysis.score,
        estimatedRows: performanceAnalysis.estimatedRows
      });

      // Add performance warnings
      for (const warning of performanceAnalysis.warnings) {
        warnings.push({
          level: 'warning',
          code: 'PERFORMANCE',
          message: warning
        });
      }

      // Add performance recommendations as suggestions
      for (const recommendation of performanceAnalysis.recommendations) {
        warnings.push({
          level: 'info',
          code: 'RECOMMENDATION',
          message: recommendation
        });
      }

      // Step 7: Generate explanation
      const explanation = this.generateExplanation(
        parsedQuery,
        optimizedParsedQuery,
        optimizations,
        performanceAnalysis,
        validationResult
      );

      const executionTime = Date.now() - startTime;
      this.log('Optimization completed', { executionTime });

      // Return successful response
      return {
        originalSql: request.sql,
        optimizedSql,
        isValid: validationResult.isValid && errors.length === 0,
        isSafe: optimizedValidation.isSafe,
        optimizations,
        performanceAnalysis,
        warnings,
        errors: errors.length > 0 ? errors : undefined,
        explanation
      };
    } catch (error) {
      const errorMsg = `Unexpected error during optimization: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.log('Error during optimization', { error: errorMsg });
      return this.createErrorResponse(request.sql, errorMsg);
    }
  }

  /**
   * Validate a query without optimizing it
   */
  async validate(sql: string, _clientId: string, _uploadId?: string): Promise<ValidationResult> {
    try {
      const parsedQuery = this.parser.parse(sql);
      return this.validator.validate(parsedQuery);
    } catch (error) {
      return {
        isValid: false,
        isSafe: false,
        violations: [
          {
            type: 'dangerous_operation',
            severity: 'error',
            message: `Failed to validate query: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ]
      };
    }
  }

  /**
   * Analyze query performance without optimizing
   */
  async analyze(sql: string): Promise<PerformanceAnalysis | null> {
    try {
      const parsedQuery = this.parser.parse(sql);
      return this.analyzer.analyze(parsedQuery);
    } catch (error) {
      this.log('Failed to analyze query', { error });
      return null;
    }
  }

  /**
   * Generate human-readable explanation of optimizations
   */
  private generateExplanation(
    originalQuery: ParsedQuery,
    optimizedQuery: ParsedQuery,
    optimizations: OptimizationResult[],
    performanceAnalysis: PerformanceAnalysis,
    validationResult: ValidationResult
  ): string {
    const parts: string[] = [];

    // Summary
    const appliedOptimizations = optimizations.filter((o) => o.applied);
    if (appliedOptimizations.length > 0) {
      parts.push(
        `Applied ${appliedOptimizations.length} optimization(s) to improve query performance and safety.`
      );
      parts.push('');
      parts.push('Optimizations applied:');
      for (const opt of appliedOptimizations) {
        parts.push(`• ${opt.description}${opt.details ? ` - ${opt.details}` : ''}`);
      }
    } else {
      parts.push('Query is already optimized or no optimizations could be applied.');
    }

    // Performance characteristics
    parts.push('');
    parts.push('Performance characteristics:');
    parts.push(`• Scan type: ${performanceAnalysis.scanType}`);
    parts.push(
      `• Estimated rows: ${performanceAnalysis.estimatedRows?.toLocaleString() || 'Unknown'}`
    );
    parts.push(`• Performance score: ${performanceAnalysis.score}/100`);

    if (performanceAnalysis.usesIndexes) {
      parts.push(`• Indexes used: ${performanceAnalysis.indexesUsed.join(', ')}`);
    } else {
      parts.push('• Warning: No indexes identified for use');
    }

    // Key improvements
    if (!originalQuery.limit && optimizedQuery.limit) {
      parts.push('');
      parts.push(`Added row limit of ${optimizedQuery.limit} to prevent excessive data retrieval.`);
    }

    const originalHasUploadId = originalQuery.whereConditions.some(
      (c) => c.column.toLowerCase() === 'uploadid'
    );
    const optimizedHasUploadId = optimizedQuery.whereConditions.some(
      (c) => c.column.toLowerCase() === 'uploadid'
    );
    if (!originalHasUploadId && optimizedHasUploadId) {
      parts.push('Added uploadId filter to utilize clustered index for better performance.');
    }

    const originalHasClientId = originalQuery.whereConditions.some(
      (c) => c.column.toLowerCase() === 'client_id'
    );
    const optimizedHasClientId = optimizedQuery.whereConditions.some(
      (c) => c.column.toLowerCase() === 'client_id'
    );
    if (!originalHasClientId && optimizedHasClientId) {
      parts.push('Added client_id filter for multi-tenant data isolation.');
    }

    // Validation issues addressed
    if (validationResult.violations.length > 0) {
      const fixedViolations = validationResult.violations.filter((v) => v.severity === 'error');
      if (fixedViolations.length > 0) {
        parts.push('');
        parts.push('Security/safety issues addressed:');
        for (const violation of fixedViolations) {
          parts.push(`• ${violation.message}`);
        }
      }
    }

    // Recommendations
    if (performanceAnalysis.recommendations.length > 0) {
      parts.push('');
      parts.push('Additional recommendations:');
      for (const rec of performanceAnalysis.recommendations.slice(0, 3)) {
        parts.push(`• ${rec}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get suggestion for a specific violation type
   */
  private getSuggestionForViolation(violationType: string): string | undefined {
    const suggestions: Record<string, string> = {
      missing_upload_id: 'Add WHERE uploadId = ? to use clustered index',
      missing_client_id: 'Add WHERE client_id = ? for multi-tenant isolation',
      missing_row_limit: 'Add TOP 5000 or LIMIT 5000 to limit results',
      excessive_row_limit: 'Reduce row limit to 5000 or less',
      wildcard_select: 'Replace SELECT * with specific column names',
      missing_where_clause: 'Add WHERE conditions to filter results',
      cartesian_product: 'Add proper JOIN conditions or use INNER JOIN',
      inefficient_join: 'Ensure JOINs use indexed columns',
      missing_time_window: 'Add date range filter (e.g., last 3 months)',
      broad_time_range: 'Narrow time range to 3 months or less'
    };

    return suggestions[violationType];
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    originalSql: string,
    errorMessage: string,
    errors?: string[],
    warnings?: Warning[]
  ): OptimizationResponse {
    return {
      originalSql,
      optimizedSql: originalSql, // Return original if optimization failed
      isValid: false,
      isSafe: false,
      optimizations: [],
      performanceAnalysis: {
        usesIndexes: false,
        indexesUsed: [],
        scanType: 'table_scan',
        warnings: [],
        recommendations: [],
        score: 0
      },
      warnings: warnings || [],
      errors: errors || [errorMessage],
      explanation: `Optimization failed: ${errorMessage}`
    };
  }

  /**
   * Log debug information
   */
  private log(message: string, data?: any): void {
    if (this.debugMode) {
      console.log(`[QueryOptimizer] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }

  /**
   * Check if a query uses proper indexes
   */
  usesProperIndexes(sql: string): boolean {
    try {
      const parsedQuery = this.parser.parse(sql);
      return this.analyzer.willUseClusteredIndex(parsedQuery);
    } catch {
      return false;
    }
  }

  /**
   * Get optimization statistics
   */
  getOptimizationStats(requests: OptimizationRequest[]): {
    totalQueries: number;
    optimizedQueries: number;
    averagePerformanceScore: number;
    commonIssues: Map<string, number>;
  } {
    const stats = {
      totalQueries: requests.length,
      optimizedQueries: 0,
      totalScore: 0,
      commonIssues: new Map<string, number>()
    };

    for (const request of requests) {
      try {
        const result = this.optimize(request);
        result.then((response) => {
          if (response.isValid && response.optimizations.some((o) => o.applied)) {
            stats.optimizedQueries++;
          }
          stats.totalScore += response.performanceAnalysis.score;

          // Track common issues
          for (const warning of response.warnings) {
            const count = stats.commonIssues.get(warning.code) || 0;
            stats.commonIssues.set(warning.code, count + 1);
          }
        });
      } catch {
        // Skip failed optimizations
      }
    }

    return {
      totalQueries: stats.totalQueries,
      optimizedQueries: stats.optimizedQueries,
      averagePerformanceScore: stats.totalQueries > 0 ? stats.totalScore / stats.totalQueries : 0,
      commonIssues: stats.commonIssues
    };
  }
}

// Export types and classes for external use
export * from './types';
export { QueryParser } from './queryParser';
export { OptimizationEngine } from './optimizationRules';
export { SafetyValidator } from './safetyValidator';
export { PerformanceAnalyzer } from './performanceAnalyzer';
