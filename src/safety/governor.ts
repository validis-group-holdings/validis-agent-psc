import { QueryAnalysis, SafetyValidation } from '@/types';
import { QueryParser } from './parser';
import { config } from '@/config';

/**
 * Query Governor - Enforces safety policies and modifies queries for protection
 */
export class QueryGovernor {
  private static readonly MAX_ROWS_DEFAULT = 100;
  private static readonly MAX_ROWS_AUDIT = 1000;
  
  /**
   * Apply safety governance to a query - modify as needed for safety
   */
  static govern(
    query: string, 
    clientId: string, 
    workflowMode: 'audit' | 'lending',
    maxRows?: number
  ): SafetyValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    let modifiedQuery = query.trim();
    
    try {
      const analysis = QueryParser.parse(modifiedQuery);
      
      // Apply TOP clause injection
      const topInjection = this.injectTopClause(
        modifiedQuery, 
        analysis, 
        maxRows || (workflowMode === 'audit' ? this.MAX_ROWS_AUDIT : this.MAX_ROWS_DEFAULT)
      );
      
      if (topInjection.modified) {
        modifiedQuery = topInjection.query;
        warnings.push(`Added TOP clause to limit results to ${topInjection.maxRows} rows`);
      }
      
      // Apply client_id filter injection for audit mode
      if (workflowMode === 'audit') {
        const clientIdInjection = this.injectClientIdFilter(modifiedQuery, clientId, analysis);
        if (clientIdInjection.modified) {
          modifiedQuery = clientIdInjection.query;
          warnings.push('Added CLIENT_ID filtering for audit mode');
        }
      }
      
      // Apply query timeout hints
      const timeoutInjection = this.injectQueryTimeoutHints(modifiedQuery);
      if (timeoutInjection.modified) {
        modifiedQuery = timeoutInjection.query;
        warnings.push('Added query timeout hints for safety');
      }
      
      // Apply index hints for performance
      const indexHints = this.suggestIndexHints(modifiedQuery, analysis);
      if (indexHints.suggestions.length > 0) {
        warnings.push(...indexHints.suggestions.map(s => `Performance: ${s}`));
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        modifiedQuery: modifiedQuery !== query ? modifiedQuery : undefined
      };
      
    } catch (error) {
      return {
        isValid: false,
        errors: [`Query governance failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: []
      };
    }
  }

  /**
   * Inject TOP clause to limit result set size
   */
  private static injectTopClause(
    query: string, 
    analysis: QueryAnalysis, 
    maxRows: number
  ): { query: string; modified: boolean; maxRows: number } {
    
    const normalizedQuery = query.toLowerCase().trim();
    
    // Check if TOP or LIMIT already exists
    if (normalizedQuery.includes(' top ') || normalizedQuery.includes(' limit ')) {
      return { query, modified: false, maxRows };
    }
    
    // Only apply to SELECT queries
    if (!normalizedQuery.startsWith('select')) {
      return { query, modified: false, maxRows };
    }
    
    // Find the SELECT keyword and inject TOP
    const selectMatch = query.match(/(select)\s+/i);
    if (!selectMatch) {
      return { query, modified: false, maxRows };
    }
    
    const beforeSelect = query.substring(0, selectMatch.index! + selectMatch[0].length);
    const afterSelect = query.substring(selectMatch.index! + selectMatch[0].length);
    
    const modifiedQuery = `${beforeSelect}TOP ${maxRows} ${afterSelect}`;
    
    return { 
      query: modifiedQuery, 
      modified: true, 
      maxRows 
    };
  }

  /**
   * Inject CLIENT_ID filtering for audit mode
   */
  private static injectClientIdFilter(
    query: string, 
    clientId: string, 
    analysis: QueryAnalysis
  ): { query: string; modified: boolean } {
    
    // Skip if client_id filter already exists
    if (analysis.hasClientIdFilter) {
      return { query, modified: false };
    }
    
    const normalizedQuery = query.toLowerCase();
    
    // Find WHERE clause or add one
    const whereIndex = normalizedQuery.indexOf(' where ');
    
    if (whereIndex !== -1) {
      // Add to existing WHERE clause
      const beforeWhere = query.substring(0, whereIndex + 7); // Include ' WHERE '
      const afterWhere = query.substring(whereIndex + 7);
      
      const modifiedQuery = `${beforeWhere}client_id = '${clientId}' AND (${afterWhere})`;
      return { query: modifiedQuery, modified: true };
      
    } else {
      // Add WHERE clause before ORDER BY, GROUP BY, or HAVING
      const clausesToCheck = [
        { keyword: ' group by ', position: 0 },
        { keyword: ' order by ', position: 0 },
        { keyword: ' having ', position: 0 }
      ];
      
      let insertPosition = query.length;
      
      for (const clause of clausesToCheck) {
        clause.position = normalizedQuery.indexOf(clause.keyword);
        if (clause.position !== -1) {
          insertPosition = Math.min(insertPosition, clause.position);
        }
      }
      
      const beforeClause = query.substring(0, insertPosition);
      const afterClause = query.substring(insertPosition);
      
      const modifiedQuery = `${beforeClause} WHERE client_id = '${clientId}'${afterClause}`;
      return { query: modifiedQuery, modified: true };
    }
  }

  /**
   * Inject query timeout hints
   */
  private static injectQueryTimeoutHints(query: string): { query: string; modified: boolean } {
    const normalizedQuery = query.toLowerCase();
    
    // Skip if OPTION clause already exists
    if (normalizedQuery.includes('option (')) {
      return { query, modified: false };
    }
    
    // Add query timeout option
    const timeoutMs = config.queryLimits.timeoutMs;
    const modifiedQuery = `${query} OPTION (QUERY_GOVERNOR_COST_LIMIT ${Math.floor(timeoutMs / 1000)})`;
    
    return { query: modifiedQuery, modified: true };
  }

  /**
   * Suggest index hints for better performance
   */
  private static suggestIndexHints(
    query: string, 
    analysis: QueryAnalysis
  ): { suggestions: string[] } {
    const suggestions: string[] = [];
    
    // Suggest index on client_id if filtering by it
    if (analysis.hasClientIdFilter) {
      analysis.tables.forEach(table => {
        suggestions.push(`Consider index on ${table}(client_id) for filtering performance`);
      });
    }
    
    // Suggest covering indexes for SELECT columns
    if (analysis.operations.includes('SELECT')) {
      const columns = QueryParser.extractSelectColumns(query);
      if (columns.length > 1 && columns.length < 10 && !columns.includes('*')) {
        suggestions.push('Consider covering indexes for selected columns');
      }
    }
    
    // Suggest indexes for JOIN conditions
    if (analysis.operations.includes('JOIN')) {
      suggestions.push('Ensure JOIN conditions have appropriate indexes');
    }
    
    // Suggest indexes for ORDER BY
    if (analysis.operations.includes('ORDER_BY')) {
      suggestions.push('Consider indexes on ORDER BY columns');
    }
    
    return { suggestions };
  }

  /**
   * Force query limits for high-risk queries
   */
  static enforceEmergencyLimits(query: string): string {
    let modifiedQuery = query;
    
    // Emergency TOP clause (very restrictive)
    if (!query.toLowerCase().includes(' top ')) {
      const selectMatch = modifiedQuery.match(/(select)\s+/i);
      if (selectMatch) {
        const beforeSelect = modifiedQuery.substring(0, selectMatch.index! + selectMatch[0].length);
        const afterSelect = modifiedQuery.substring(selectMatch.index! + selectMatch[0].length);
        modifiedQuery = `${beforeSelect}TOP 10 ${afterSelect}`;
      }
    }
    
    // Emergency timeout (very short)
    if (!modifiedQuery.toLowerCase().includes('option (')) {
      modifiedQuery += ' OPTION (QUERY_GOVERNOR_COST_LIMIT 5)';
    }
    
    return modifiedQuery;
  }

  /**
   * Remove potentially dangerous elements from query
   */
  static sanitizeForSafety(query: string): string {
    return query
      // Remove SQL comments
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove multiple semicolons
      .replace(/;+/g, ';')
      // Remove trailing semicolon
      .replace(/;\s*$/, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if query needs governance intervention
   */
  static needsGovernance(query: string): { 
    needs: boolean; 
    reasons: string[];
    interventions: string[];
  } {
    const reasons: string[] = [];
    const interventions: string[] = [];
    const analysis = QueryParser.parse(query);
    
    // Check for missing TOP clause
    if (!query.toLowerCase().includes(' top ') && !query.toLowerCase().includes(' limit ')) {
      reasons.push('No result limit specified');
      interventions.push('Add TOP clause');
    }
    
    // Check for missing client_id filter in audit mode
    if (!analysis.hasClientIdFilter) {
      reasons.push('Missing CLIENT_ID filtering');
      interventions.push('Add CLIENT_ID filter');
    }
    
    // Check for high complexity
    if (analysis.estimatedComplexity === 'high') {
      reasons.push('High query complexity');
      interventions.push('Add performance hints');
    }
    
    // Check for multiple tables without proper filtering
    if (analysis.tables.length > 2 && !analysis.hasClientIdFilter) {
      reasons.push('Multi-table query without proper filtering');
      interventions.push('Add filtering and index hints');
    }
    
    return {
      needs: reasons.length > 0,
      reasons,
      interventions
    };
  }

  /**
   * Apply progressive governance based on system load
   */
  static adaptiveGovernance(
    query: string,
    systemLoad: 'low' | 'medium' | 'high' | 'critical',
    clientId: string,
    workflowMode: 'audit' | 'lending'
  ): SafetyValidation {
    
    // Adjust limits based on system load
    const loadLimits = {
      low: { maxRows: 1000, allowComplexQueries: true },
      medium: { maxRows: 500, allowComplexQueries: true },
      high: { maxRows: 100, allowComplexQueries: false },
      critical: { maxRows: 10, allowComplexQueries: false }
    };
    
    const limits = loadLimits[systemLoad];
    
    // Block complex queries under high load
    if (!limits.allowComplexQueries) {
      const analysis = QueryParser.parse(query);
      if (analysis.estimatedComplexity === 'high' || analysis.tables.length > 3) {
        return {
          isValid: false,
          errors: [`Query blocked due to ${systemLoad} system load`],
          warnings: []
        };
      }
    }
    
    // Apply governance with adjusted limits
    return this.govern(query, clientId, workflowMode, limits.maxRows);
  }
}