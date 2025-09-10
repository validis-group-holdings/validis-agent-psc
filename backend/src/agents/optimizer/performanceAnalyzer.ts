/**
 * SQL Query Performance Analyzer
 * Analyzes query performance characteristics and provides recommendations
 */

import {
  ParsedQuery,
  PerformanceAnalysis,
  TableStatistics,
  IndexInfo,
  QueryContext
} from './types';

export class PerformanceAnalyzer {
  // Estimated row counts for common tables (would be fetched from DB in production)
  private tableStats: Map<string, TableStatistics> = new Map([
    [
      'transactions',
      {
        tableName: 'transactions',
        rowCount: 1000000,
        sizeInMB: 500,
        lastUpdated: new Date(),
        indexes: [
          {
            tableName: 'transactions',
            indexName: 'PK_transactions',
            columns: ['id'],
            isUnique: true,
            isClustered: true,
            isPrimary: true
          },
          {
            tableName: 'transactions',
            indexName: 'IX_uploadId_client_id',
            columns: ['uploadId', 'client_id'],
            isUnique: false,
            isClustered: false,
            isPrimary: false
          },
          {
            tableName: 'transactions',
            indexName: 'IX_transaction_date',
            columns: ['transaction_date'],
            isUnique: false,
            isClustered: false,
            isPrimary: false
          }
        ]
      }
    ],
    [
      'accounts',
      {
        tableName: 'accounts',
        rowCount: 50000,
        sizeInMB: 25,
        lastUpdated: new Date(),
        indexes: [
          {
            tableName: 'accounts',
            indexName: 'PK_accounts',
            columns: ['account_id'],
            isUnique: true,
            isClustered: true,
            isPrimary: true
          },
          {
            tableName: 'accounts',
            indexName: 'IX_client_id',
            columns: ['client_id'],
            isUnique: false,
            isClustered: false,
            isPrimary: false
          }
        ]
      }
    ],
    [
      'journal_entries',
      {
        tableName: 'journal_entries',
        rowCount: 500000,
        sizeInMB: 250,
        lastUpdated: new Date(),
        indexes: [
          {
            tableName: 'journal_entries',
            indexName: 'PK_journal_entries',
            columns: ['entry_id'],
            isUnique: true,
            isClustered: true,
            isPrimary: true
          },
          {
            tableName: 'journal_entries',
            indexName: 'IX_uploadId',
            columns: ['uploadId'],
            isUnique: false,
            isClustered: false,
            isPrimary: false
          }
        ]
      }
    ],
    [
      'portfolio_positions',
      {
        tableName: 'portfolio_positions',
        rowCount: 200000,
        sizeInMB: 100,
        lastUpdated: new Date(),
        indexes: [
          {
            tableName: 'portfolio_positions',
            indexName: 'PK_positions',
            columns: ['position_id'],
            isUnique: true,
            isClustered: true,
            isPrimary: true
          },
          {
            tableName: 'portfolio_positions',
            indexName: 'IX_uploadId_date',
            columns: ['uploadId', 'position_date'],
            isUnique: false,
            isClustered: false,
            isPrimary: false
          }
        ]
      }
    ]
  ]);

  /**
   * Analyze query performance characteristics
   */
  analyze(query: ParsedQuery, _context?: QueryContext): PerformanceAnalysis {
    const indexesUsed = this.identifyUsedIndexes(query);
    const scanType = this.determineScanType(query, indexesUsed);
    const estimatedRows = this.estimateRowCount(query);
    const estimatedCost = this.estimateCost(query, estimatedRows, scanType);
    const warnings = this.generateWarnings(query, scanType, indexesUsed);
    const recommendations = this.generateRecommendations(query, scanType, indexesUsed);
    const score = this.calculatePerformanceScore(query, scanType, indexesUsed, estimatedRows);

    return {
      estimatedRows,
      estimatedCost,
      usesIndexes: indexesUsed.length > 0,
      indexesUsed,
      scanType,
      warnings,
      recommendations,
      score
    };
  }

  /**
   * Identify which indexes will be used by the query
   */
  private identifyUsedIndexes(query: ParsedQuery): string[] {
    const usedIndexes: string[] = [];

    // Check each table in the query
    for (const table of query.tables) {
      const tableStats = this.tableStats.get(table.name.toLowerCase());
      if (!tableStats) continue;

      // Check WHERE conditions against available indexes
      for (const index of tableStats.indexes) {
        if (this.canUseIndex(query, table.name, index)) {
          usedIndexes.push(`${table.name}.${index.indexName}`);
        }
      }
    }

    return usedIndexes;
  }

  /**
   * Check if a query can use a specific index
   */
  private canUseIndex(query: ParsedQuery, tableName: string, index: IndexInfo): boolean {
    // Check if WHERE conditions match index columns
    const indexColumns = index.columns.map((c) => c.toLowerCase());

    for (const condition of query.whereConditions) {
      const columnName = condition.column.toLowerCase();

      // Check if this condition uses an indexed column
      if (indexColumns.includes(columnName)) {
        // Check if the operator is index-friendly
        if (this.isIndexFriendlyOperator(condition.operator)) {
          return true;
        }
      }
    }

    // Check JOIN conditions
    for (const join of query.joins) {
      if (join.table.name.toLowerCase() === tableName.toLowerCase()) {
        for (const joinColumn of join.columns) {
          if (indexColumns.includes(joinColumn.toLowerCase())) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if an operator can use an index
   */
  private isIndexFriendlyOperator(operator: string): boolean {
    const friendlyOperators = ['=', '<', '>', '<=', '>=', 'IN', 'BETWEEN'];
    const unfriendlyOperators = ['LIKE', 'NOT IN', 'NOT BETWEEN', '!=', '<>'];

    const upperOp = operator.toUpperCase();

    // LIKE is only index-friendly if it doesn't start with %
    if (upperOp === 'LIKE') {
      // This would need to check the actual pattern
      return false; // Conservative assumption
    }

    return friendlyOperators.includes(upperOp) && !unfriendlyOperators.includes(upperOp);
  }

  /**
   * Determine the type of scan that will be performed
   */
  private determineScanType(
    query: ParsedQuery,
    indexesUsed: string[]
  ): PerformanceAnalysis['scanType'] {
    // Check if uploadId is used (clustered index)
    const hasUploadId = query.whereConditions.some(
      (c) => c.column.toLowerCase() === 'uploadid' && c.operator === '='
    );

    if (hasUploadId && indexesUsed.some((idx) => idx.includes('uploadId'))) {
      return 'index_seek'; // Best performance
    }

    if (indexesUsed.length > 0) {
      // Check if we're doing an equality search on indexed columns
      const hasEqualityOnIndex = query.whereConditions.some(
        (c) =>
          c.operator === '=' &&
          indexesUsed.some((idx) => idx.toLowerCase().includes(c.column.toLowerCase()))
      );

      if (hasEqualityOnIndex) {
        return 'index_seek';
      }
      return 'index_scan';
    }

    // Check if we have a clustered index scan
    const hasPrimaryKey = query.whereConditions.some(
      (c) => c.column.toLowerCase().includes('id') && c.operator === '='
    );

    if (hasPrimaryKey) {
      return 'clustered_index_scan';
    }

    // Worst case: full table scan
    return 'table_scan';
  }

  /**
   * Estimate the number of rows that will be returned
   */
  private estimateRowCount(query: ParsedQuery): number {
    let estimatedRows = 0;

    // Start with the base table row count
    for (const table of query.tables) {
      const stats = this.tableStats.get(table.name.toLowerCase());
      if (stats) {
        estimatedRows = Math.max(estimatedRows, stats.rowCount);
      }
    }

    // Apply selectivity estimates based on WHERE conditions
    let selectivity = 1.0;

    for (const condition of query.whereConditions) {
      switch (condition.operator.toUpperCase()) {
        case '=':
          selectivity *= 0.01; // Assume 1% selectivity for equality
          break;
        case 'IN':
          selectivity *= 0.05; // Assume 5% selectivity for IN
          break;
        case 'BETWEEN':
          selectivity *= 0.1; // Assume 10% selectivity for BETWEEN
          break;
        case '<':
        case '>':
        case '<=':
        case '>=':
          selectivity *= 0.3; // Assume 30% selectivity for range
          break;
        case 'LIKE':
          selectivity *= 0.2; // Assume 20% selectivity for LIKE
          break;
        default:
          selectivity *= 0.5; // Conservative estimate
      }
    }

    // Apply JOIN multiplier
    for (const join of query.joins) {
      if (join.type === 'inner') {
        selectivity *= 0.8; // Inner joins typically reduce rows
      } else if (join.type === 'left' || join.type === 'right') {
        selectivity *= 1.2; // Outer joins may increase rows
      } else if (join.type === 'cross') {
        // Cartesian product
        const joinTable = this.tableStats.get(join.table.name.toLowerCase());
        if (joinTable) {
          estimatedRows *= joinTable.rowCount;
        }
      }
    }

    estimatedRows = Math.floor(estimatedRows * selectivity);

    // Apply LIMIT if present
    if (query.limit) {
      estimatedRows = Math.min(estimatedRows, query.limit);
    }

    return Math.max(1, estimatedRows);
  }

  /**
   * Estimate query cost (arbitrary units)
   */
  private estimateCost(
    query: ParsedQuery,
    estimatedRows: number,
    scanType: PerformanceAnalysis['scanType']
  ): number {
    let baseCost = 0;

    // Base cost by scan type
    switch (scanType) {
      case 'index_seek':
        baseCost = 1;
        break;
      case 'index_scan':
        baseCost = 10;
        break;
      case 'clustered_index_scan':
        baseCost = 50;
        break;
      case 'table_scan':
        baseCost = 100;
        break;
    }

    // Add cost for rows processed
    baseCost += estimatedRows * 0.001;

    // Add cost for JOINs
    baseCost += query.joins.length * 20;

    // Add cost for sorting (ORDER BY)
    if (query.orderBy && query.orderBy.length > 0) {
      baseCost += Math.log10(estimatedRows) * 10;
    }

    // Add cost for grouping (GROUP BY)
    if (query.groupBy && query.groupBy.length > 0) {
      baseCost += Math.log10(estimatedRows) * 15;
    }

    // Add cost for subqueries
    const subqueryCount = query.whereConditions.filter((c) => c.type === 'subquery').length;
    baseCost += subqueryCount * 50;

    return Math.round(baseCost);
  }

  /**
   * Generate performance warnings
   */
  private generateWarnings(
    query: ParsedQuery,
    scanType: PerformanceAnalysis['scanType'],
    indexesUsed: string[]
  ): string[] {
    const warnings: string[] = [];

    // Warn about table scans
    if (scanType === 'table_scan') {
      warnings.push(
        'Query will perform a full table scan - consider adding WHERE conditions on indexed columns'
      );
    }

    // Warn about missing uploadId
    if (!query.whereConditions.some((c) => c.column.toLowerCase() === 'uploadid')) {
      warnings.push('Query does not filter by uploadId - this may impact performance');
    }

    // Warn about SELECT *
    if (query.columns.includes('*')) {
      warnings.push('SELECT * can impact performance - specify only required columns');
    }

    // Warn about too many JOINs
    if (query.joins.length > 3) {
      warnings.push(
        `Query has ${query.joins.length} JOINs - consider breaking into smaller queries or using CTEs`
      );
    }

    // Warn about LIKE with leading wildcard
    const hasLeadingWildcard = query.whereConditions.some(
      (c) =>
        c.operator.toUpperCase() === 'LIKE' &&
        typeof c.value === 'string' &&
        c.value.startsWith('%')
    );
    if (hasLeadingWildcard) {
      warnings.push('LIKE pattern with leading % prevents index usage');
    }

    // Warn about missing statistics
    if (indexesUsed.length === 0 && query.tables.length > 0) {
      warnings.push('No indexes identified for use - query may be slow');
    }

    // Warn about large result sets without limit
    if (!query.limit) {
      warnings.push('Query has no LIMIT/TOP clause - may return excessive rows');
    }

    return warnings;
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(
    query: ParsedQuery,
    scanType: PerformanceAnalysis['scanType'],
    indexesUsed: string[]
  ): string[] {
    const recommendations: string[] = [];

    // Recommend index usage
    if (scanType === 'table_scan') {
      recommendations.push('Add WHERE condition on uploadId to use clustered index');

      // Check which columns are filtered
      const filteredColumns = query.whereConditions.map((c) => c.column);
      if (filteredColumns.length > 0) {
        recommendations.push(`Consider creating index on columns: ${filteredColumns.join(', ')}`);
      }
    }

    // Recommend covering index for SELECT columns
    if (query.columns.length > 0 && !query.columns.includes('*')) {
      const selectColumns = query.columns.filter((c) => c !== '*');
      if (selectColumns.length <= 5) {
        recommendations.push(
          `Consider creating covering index with columns: ${selectColumns.join(', ')}`
        );
      }
    }

    // Recommend CTE for complex queries
    const hasSubqueries = query.whereConditions.some((c) => c.type === 'subquery');
    if (hasSubqueries && query.ctes && query.ctes.length === 0) {
      recommendations.push('Consider using CTEs instead of subqueries for better performance');
    }

    // Recommend partitioning for large tables
    const largeTables = query.tables.filter((t) => {
      const stats = this.tableStats.get(t.name.toLowerCase());
      return stats && stats.rowCount > 1000000;
    });
    if (largeTables.length > 0) {
      recommendations.push('Consider table partitioning for large tables');
    }

    // Recommend statistics update
    if (indexesUsed.length === 0) {
      recommendations.push('Ensure table statistics are up to date');
    }

    // Recommend query splitting for complex operations
    if (query.joins.length > 5) {
      recommendations.push('Consider breaking this query into multiple smaller queries');
    }

    // Recommend indexed views for common queries
    if (query.joins.length > 2 && query.groupBy && query.groupBy.length > 0) {
      recommendations.push('Consider creating an indexed view for this query pattern');
    }

    return recommendations;
  }

  /**
   * Calculate overall performance score (0-100)
   */
  private calculatePerformanceScore(
    query: ParsedQuery,
    scanType: PerformanceAnalysis['scanType'],
    indexesUsed: string[],
    estimatedRows: number
  ): number {
    let score = 100;

    // Deduct points based on scan type
    switch (scanType) {
      case 'index_seek':
        // Best case, no deduction
        break;
      case 'index_scan':
        score -= 10;
        break;
      case 'clustered_index_scan':
        score -= 20;
        break;
      case 'table_scan':
        score -= 40;
        break;
    }

    // Deduct points for missing critical filters
    if (!query.whereConditions.some((c) => c.column.toLowerCase() === 'uploadid')) {
      score -= 20;
    }
    if (!query.whereConditions.some((c) => c.column.toLowerCase() === 'client_id')) {
      score -= 15;
    }

    // Deduct points for SELECT *
    if (query.columns.includes('*')) {
      score -= 10;
    }

    // Deduct points for excessive JOINs
    if (query.joins.length > 3) {
      score -= Math.min(30, query.joins.length * 5);
    }

    // Deduct points for missing LIMIT on large result sets
    if (!query.limit && estimatedRows > 1000) {
      score -= 15;
    }

    // Deduct points for subqueries
    const subqueryCount = query.whereConditions.filter((c) => c.type === 'subquery').length;
    score -= Math.min(20, subqueryCount * 5);

    // Deduct points for no index usage
    if (indexesUsed.length === 0 && query.tables.length > 0) {
      score -= 25;
    }

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if query will use clustered index
   */
  willUseClusteredIndex(query: ParsedQuery): boolean {
    return query.whereConditions.some(
      (c) =>
        (c.column.toLowerCase() === 'uploadid' || c.column.toLowerCase() === 'upload_id') &&
        c.operator === '='
    );
  }

  /**
   * Get estimated execution time in milliseconds (rough estimate)
   */
  getEstimatedExecutionTime(analysis: PerformanceAnalysis): number {
    // Very rough estimates based on cost
    const costToMs = analysis.estimatedCost || 0;

    // Add base time for network and parsing
    const baseTime = 10;

    // Scale based on scan type
    let multiplier = 1;
    switch (analysis.scanType) {
      case 'index_seek':
        multiplier = 0.5;
        break;
      case 'index_scan':
        multiplier = 1;
        break;
      case 'clustered_index_scan':
        multiplier = 2;
        break;
      case 'table_scan':
        multiplier = 5;
        break;
    }

    return Math.round(baseTime + costToMs * multiplier);
  }
}
