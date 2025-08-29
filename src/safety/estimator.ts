import sql from 'mssql';
import { QueryAnalysis, QueryCostEstimate } from '@/types';
import { QueryParser } from './parser';
import { getDatabaseConnection } from '@/db/connection';

/**
 * Query Cost Estimator - Predicts query performance and resource usage
 */
export class QueryCostEstimator {
  
  /**
   * Estimate the cost and performance impact of a query
   */
  static async estimate(query: string): Promise<QueryCostEstimate> {
    try {
      const analysis = QueryParser.parse(query);
      
      // Get table statistics
      const tableStats = await this.getTableStatistics(analysis.tables);
      
      // Calculate base estimates
      const estimatedRows = this.estimateRows(analysis, tableStats);
      const estimatedTime = this.estimateExecutionTime(analysis, tableStats, estimatedRows);
      const riskLevel = this.calculateRiskLevel(analysis, estimatedRows, estimatedTime);
      const recommendations = this.generateRecommendations(analysis, tableStats, riskLevel);
      
      return {
        estimatedRows,
        estimatedTime,
        riskLevel,
        recommendations
      };
      
    } catch (error) {
      return {
        estimatedRows: 0,
        estimatedTime: 0,
        riskLevel: 'critical',
        recommendations: [`Failed to estimate query cost: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Get statistics for tables involved in the query
   */
  private static async getTableStatistics(tables: string[]): Promise<Map<string, any>> {
    const stats = new Map<string, any>();
    
    if (tables.length === 0) {
      return stats;
    }
    
    try {
      const pool = getDatabaseConnection();
      const request = pool.request();
      
      for (const tableName of tables) {
        try {
          // Get table row count and size estimates
          const tableStatsQuery = `
            SELECT 
              t.name as table_name,
              p.rows as row_count,
              SUM(a.total_pages) * 8 as size_kb,
              SUM(a.used_pages) * 8 as used_size_kb,
              COUNT(i.index_id) as index_count
            FROM sys.tables t
            INNER JOIN sys.indexes i ON t.object_id = i.object_id
            INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
            INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
            WHERE t.name = @tableName
            GROUP BY t.name, p.rows
          `;
          
          request.input('tableName', sql.VarChar, tableName);
          const result = await request.query(tableStatsQuery);
          
          if (result.recordset.length > 0) {
            stats.set(tableName, result.recordset[0]);
          } else {
            // Default estimates for unknown tables
            stats.set(tableName, {
              table_name: tableName,
              row_count: 1000,
              size_kb: 1024,
              used_size_kb: 1024,
              index_count: 1
            });
          }
          
          // Clear parameters for next iteration
          request.parameters = {};
          
        } catch (tableError) {
          console.warn(`Failed to get stats for table ${tableName}:`, tableError);
          // Use conservative estimates
          stats.set(tableName, {
            table_name: tableName,
            row_count: 10000,
            size_kb: 10240,
            used_size_kb: 10240,
            index_count: 0
          });
        }
      }
      
    } catch (error) {
      console.error('Error getting table statistics:', error);
      
      // Provide conservative estimates for all tables
      tables.forEach(tableName => {
        stats.set(tableName, {
          table_name: tableName,
          row_count: 10000,
          size_kb: 10240,
          used_size_kb: 10240,
          index_count: 0
        });
      });
    }
    
    return stats;
  }

  /**
   * Estimate number of rows the query will process
   */
  private static estimateRows(
    analysis: QueryAnalysis, 
    tableStats: Map<string, any>
  ): number {
    if (analysis.tables.length === 0) {
      return 0;
    }
    
    // Start with the largest table
    let estimatedRows = 0;
    
    analysis.tables.forEach(tableName => {
      const stats = tableStats.get(tableName);
      if (stats) {
        estimatedRows = Math.max(estimatedRows, stats.row_count || 1000);
      }
    });
    
    // Apply filters and operations
    let selectivity = 1.0; // 100% of rows
    
    // Client ID filter typically reduces to 1/100 of data
    if (analysis.hasClientIdFilter) {
      selectivity *= 0.01;
    }
    
    // WHERE clauses reduce selectivity
    if (analysis.operations.includes('WHERE')) {
      selectivity *= 0.1; // Assume WHERE reduces by 90%
    }
    
    // JOINs can multiply rows
    const joinCount = analysis.operations.filter(op => op === 'JOIN').length;
    if (joinCount > 0) {
      // Each JOIN potentially multiplies rows, but assume good join conditions
      selectivity *= Math.pow(0.5, joinCount); // Each join halves the result
    }
    
    // GROUP BY reduces rows significantly
    if (analysis.operations.includes('GROUP_BY')) {
      selectivity *= 0.1;
    }
    
    return Math.ceil(estimatedRows * selectivity);
  }

  /**
   * Estimate query execution time in milliseconds
   */
  private static estimateExecutionTime(
    analysis: QueryAnalysis,
    tableStats: Map<string, any>,
    estimatedRows: number
  ): number {
    let baseTime = 100; // Base 100ms for simple queries
    
    // Complexity multipliers
    const complexityMultipliers = {
      low: 1,
      medium: 2,
      high: 4
    };
    
    baseTime *= complexityMultipliers[analysis.estimatedComplexity];
    
    // Row count factor (logarithmic scale)
    if (estimatedRows > 1000) {
      baseTime += Math.log10(estimatedRows) * 50;
    }
    
    // Operation-specific costs
    const operationCosts = {
      JOIN: 200,
      UNION: 150,
      SUBQUERY: 300,
      GROUP_BY: 100,
      ORDER_BY: 100,
      HAVING: 50
    };
    
    analysis.operations.forEach(operation => {
      if (operationCosts[operation as keyof typeof operationCosts]) {
        baseTime += operationCosts[operation as keyof typeof operationCosts];
      }
    });
    
    // Table scan penalty for tables without good indexes
    analysis.tables.forEach(tableName => {
      const stats = tableStats.get(tableName);
      if (stats && stats.index_count === 0) {
        baseTime += (stats.row_count || 1000) * 0.01; // 0.01ms per row for scan
      }
    });
    
    // Multiple table penalty
    if (analysis.tables.length > 1) {
      baseTime *= analysis.tables.length * 0.5;
    }
    
    return Math.ceil(baseTime);
  }

  /**
   * Calculate risk level based on estimates
   */
  private static calculateRiskLevel(
    analysis: QueryAnalysis,
    estimatedRows: number,
    estimatedTime: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    
    // Critical risk factors
    if (estimatedTime > 30000 || estimatedRows > 1000000) {
      return 'critical';
    }
    
    // High risk factors
    if (
      estimatedTime > 10000 || 
      estimatedRows > 100000 ||
      analysis.estimatedComplexity === 'high' ||
      analysis.tables.length > 5
    ) {
      return 'high';
    }
    
    // Medium risk factors
    if (
      estimatedTime > 5000 ||
      estimatedRows > 10000 ||
      analysis.estimatedComplexity === 'medium' ||
      analysis.tables.length > 2
    ) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Generate performance recommendations
   */
  private static generateRecommendations(
    analysis: QueryAnalysis,
    tableStats: Map<string, any>,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): string[] {
    const recommendations: string[] = [];
    
    // Risk-based recommendations
    if (riskLevel === 'critical') {
      recommendations.push('Query may timeout or cause system impact - consider redesigning');
    }
    
    if (riskLevel === 'high') {
      recommendations.push('Query has high performance impact - add appropriate LIMIT clauses');
    }
    
    // Client ID filtering
    if (!analysis.hasClientIdFilter) {
      recommendations.push('Add CLIENT_ID filtering to improve performance and security');
    }
    
    // Index recommendations
    analysis.tables.forEach(tableName => {
      const stats = tableStats.get(tableName);
      if (stats && stats.index_count === 0) {
        recommendations.push(`Consider adding indexes to table ${tableName}`);
      }
    });
    
    // JOIN recommendations
    if (analysis.operations.includes('JOIN') && analysis.tables.length > 3) {
      recommendations.push('Consider breaking complex JOINs into smaller queries');
    }
    
    // Subquery recommendations
    if (analysis.operations.includes('SUBQUERY')) {
      recommendations.push('Consider converting subqueries to JOINs for better performance');
    }
    
    // ORDER BY without LIMIT
    if (analysis.operations.includes('ORDER_BY')) {
      recommendations.push('Use TOP or LIMIT with ORDER BY to improve performance');
    }
    
    // Large table recommendations
    const largeTables = analysis.tables.filter(tableName => {
      const stats = tableStats.get(tableName);
      return stats && stats.row_count > 100000;
    });
    
    if (largeTables.length > 0) {
      recommendations.push(`Large tables detected: ${largeTables.join(', ')} - ensure proper filtering`);
    }
    
    // Complexity recommendations
    if (analysis.estimatedComplexity === 'high') {
      recommendations.push('High complexity query - consider breaking into multiple simpler queries');
    }
    
    return recommendations;
  }

  /**
   * Quick cost check for immediate validation
   */
  static quickCostCheck(query: string): { 
    isAcceptable: boolean; 
    reason?: string; 
    estimatedComplexity: 'low' | 'medium' | 'high' 
  } {
    const analysis = QueryParser.parse(query);
    
    // Immediate rejections
    if (analysis.tables.length > 10) {
      return {
        isAcceptable: false,
        reason: 'Too many tables in query (maximum 10)',
        estimatedComplexity: 'high'
      };
    }
    
    if (query.length > 5000) {
      return {
        isAcceptable: false,
        reason: 'Query too long (maximum 5000 characters)',
        estimatedComplexity: 'high'
      };
    }
    
    // Check for expensive operations without filtering
    if (!analysis.hasClientIdFilter && analysis.tables.length > 1) {
      return {
        isAcceptable: false,
        reason: 'Multi-table queries require CLIENT_ID filtering',
        estimatedComplexity: analysis.estimatedComplexity
      };
    }
    
    return {
      isAcceptable: true,
      estimatedComplexity: analysis.estimatedComplexity
    };
  }
}