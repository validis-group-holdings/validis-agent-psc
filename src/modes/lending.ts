/**
 * Lending Mode Strategy Implementation
 * 
 * Enables portfolio-wide queries with drill-down capabilities, supports
 * cross-company analysis while maintaining client isolation, and applies
 * lending-specific validation rules and constraints.
 */

import { 
  ModeStrategy, 
  ModeContext, 
  ModeConstraints, 
  ModeValidation, 
  QueryModification, 
  SessionContext,
  UploadContextValidation
} from './types';
import { getUploadTableInfo } from '../db/uploadTableHelpers';

export class LendingModeStrategy implements ModeStrategy {
  
  getConstraints(): ModeConstraints {
    return {
      // Lending mode allows portfolio analysis
      requiresUploadId: false,
      allowsMultipleUploads: true,
      requiresClientIdFilter: true,
      allowsCrossClientQueries: false, // Still maintain client isolation
      
      // More permissive data access for portfolio analysis
      maxRowsPerQuery: 50000,
      allowedTablePatterns: [
        'upload_*',
        'client_*',
        'lending_*',
        'portfolio_*',
        'aggregated_*'
      ],
      restrictedOperations: [
        'DROP',
        'DELETE',
        'UPDATE',
        'INSERT',
        'CREATE',
        'ALTER',
        'TRUNCATE'
      ],
      
      // Time-based constraints
      allowsHistoricalData: true,
      maxHistoryDays: 1095, // Allow up to 3 years for trend analysis
      
      // Validation rules
      mandatoryFilters: ['client_id'],
      prohibitedColumns: [
        'password',
        'token',
        'secret',
        'key',
        'ssn',
        'personal_info'
      ]
    };
  }

  async validateQuery(query: string, context: ModeContext): Promise<ModeValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // In lending mode, upload_id is optional but if provided, validate it
      if (context.uploadId) {
        const uploadValidation = await this.validateUploadContext(context.uploadId, context);
        if (!uploadValidation.isValid) {
          errors.push(...uploadValidation.errors);
        }
        warnings.push(...uploadValidation.warnings);
      }

      // Check for prohibited operations
      const constraints = this.getConstraints();
      const queryUpper = query.toUpperCase();
      
      for (const operation of constraints.restrictedOperations) {
        if (queryUpper.includes(operation)) {
          errors.push(`Operation '${operation}' is not allowed in lending mode`);
        }
      }

      // Ensure client_id filter is present
      if (!this.hasClientIdFilter(query)) {
        warnings.push('Query will be automatically scoped to your client_id');
      }

      // Check for cross-client access attempts
      if (this.hasCrossClientAccess(query)) {
        errors.push('Cross-client access is not allowed even in lending mode');
      }

      // Validate table patterns
      const tableMentions = this.extractTableNames(query);
      for (const table of tableMentions) {
        if (!this.isTableAllowed(table, constraints.allowedTablePatterns)) {
          errors.push(`Table '${table}' is not accessible in lending mode`);
        }
      }

      // Check for prohibited columns
      for (const column of constraints.prohibitedColumns) {
        if (queryUpper.includes(column.toUpperCase())) {
          errors.push(`Column '${column}' contains sensitive data and is prohibited`);
        }
      }

      // Portfolio-specific validations
      if (this.isPortfolioQuery(query)) {
        if (!this.hasAggregationFunction(query)) {
          warnings.push('Portfolio queries typically benefit from aggregation functions');
        }
        
        if (!this.hasGroupByClause(query)) {
          warnings.push('Consider grouping portfolio data by company, time period, or other dimensions');
        }
      }

      // Check for potentially expensive operations
      if (this.hasJoinWithoutConstraints(query)) {
        warnings.push('Joins without proper constraints may be slow on large datasets');
      }

    } catch (error) {
      errors.push(`Query validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  async modifyQuery(query: string, context: ModeContext): Promise<QueryModification> {
    const appliedConstraints: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let modifiedQuery = query;

    try {
      // Apply client_id filter if missing
      if (!this.hasClientIdFilter(query)) {
        modifiedQuery = this.addClientIdFilter(modifiedQuery, context.clientId);
        appliedConstraints.push('Added client_id filter');
      }

      // If specific upload_id is provided in context, scope to it
      if (context.uploadId && !this.isPortfolioQuery(query)) {
        if (!this.hasUploadIdFilter(query, context.uploadId)) {
          modifiedQuery = this.addUploadIdFilter(modifiedQuery, context.uploadId);
          appliedConstraints.push('Added upload_id scoping for focused analysis');
        }
      }

      // Apply row limit if not present
      if (!this.hasLimitClause(query)) {
        const constraints = this.getConstraints();
        modifiedQuery = this.addLimitClause(modifiedQuery, constraints.maxRowsPerQuery);
        appliedConstraints.push(`Added LIMIT ${constraints.maxRowsPerQuery}`);
        warnings.push('Large result sets may impact performance');
      }

      // Optimize portfolio queries
      if (this.isPortfolioQuery(query) && !this.hasOptimizationHints(query)) {
        modifiedQuery = this.addOptimizationHints(modifiedQuery);
        appliedConstraints.push('Added portfolio query optimization hints');
      }

      // Validate the modified query
      const validation = await this.validateQuery(modifiedQuery, context);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);

    } catch (error) {
      errors.push(`Query modification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      originalQuery: query,
      modifiedQuery,
      appliedConstraints,
      warnings,
      errors
    };
  }

  async initializeSession(clientId: string, uploadId?: string): Promise<Partial<SessionContext>> {
    const context: Partial<SessionContext> = {
      clientId,
      currentUploadId: uploadId,
      availableUploadIds: [],
    };

    try {
      // Get available uploads for the client
      const uploadInfo = await getUploadTableInfo();
      const clientUploads = uploadInfo.filter(upload => 
        upload.clientId === clientId && upload.status === 'active'
      );
      
      context.availableUploadIds = clientUploads.map(upload => upload.tableName);

      // Set portfolio context for lending mode
      context.portfolioContext = {
        totalCompanies: clientUploads.length,
        activeUploadIds: context.availableUploadIds
      };

      // Set company context if specific uploadId provided
      if (uploadId) {
        const currentUpload = clientUploads.find(upload => upload.tableName === uploadId);
        if (currentUpload) {
          context.companyContext = {
            name: `Client-${clientId}-Company`, // Could be enhanced with actual company names
            uploadId: uploadId,
            period: currentUpload.uploadDate.toISOString().split('T')[0]
          };
        }
      }

    } catch (error) {
      console.error('Error initializing lending mode session:', error);
    }

    return context;
  }

  validateSession(context: SessionContext): ModeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if there are any active uploads available
    if (context.availableUploadIds.length === 0) {
      errors.push('No active uploads available for lending analysis');
    }

    // Check portfolio context
    if (!context.portfolioContext || context.portfolioContext.totalCompanies === 0) {
      errors.push('Portfolio context is required for lending mode');
    }

    // Warn if portfolio is very small
    if (context.portfolioContext && context.portfolioContext.totalCompanies < 3) {
      warnings.push('Small portfolio size may limit the effectiveness of comparative analysis');
    }

    // Check session age
    const sessionAge = Date.now() - context.createdAt.getTime();
    const maxAge = 12 * 60 * 60 * 1000; // 12 hours for lending mode
    if (sessionAge > maxAge) {
      warnings.push('Session is getting old, consider refreshing portfolio context');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  getAvailableActions(): string[] {
    return [
      'financial_ratios',
      'liquidity_analysis',
      'debt_capacity',
      'revenue_trends',
      'working_capital',
      'portfolio_cash',
      'risk_scoring',
      'covenant_compliance'
    ];
  }

  applyScoping(query: string, context: ModeContext): string {
    let scopedQuery = query;

    // Always add client_id scoping
    if (!this.hasClientIdFilter(query)) {
      scopedQuery = this.addClientIdFilter(scopedQuery, context.clientId);
    }

    // For focused analysis, add upload_id scoping
    if (context.uploadId && !this.isPortfolioQuery(query)) {
      if (!this.hasUploadIdFilter(query, context.uploadId)) {
        scopedQuery = this.addUploadIdFilter(scopedQuery, context.uploadId);
      }
    }

    return scopedQuery;
  }

  async validateUploadContext(uploadId: string | undefined, context: ModeContext): Promise<UploadContextValidation> {
    const result: UploadContextValidation = {
      isValid: true, // Optional in lending mode
      uploadExists: false,
      belongsToClient: false,
      isActive: false,
      errors: [],
      warnings: []
    };

    if (!uploadId) {
      // Upload ID is optional in lending mode
      result.warnings.push('No specific upload context - portfolio-wide analysis available');
      return result;
    }

    try {
      const uploadInfo = await getUploadTableInfo();
      const upload = uploadInfo.find(info => info.tableName === uploadId);

      if (!upload) {
        result.errors.push(`Upload '${uploadId}' not found`);
        result.isValid = false;
        return result;
      }

      result.uploadExists = true;

      // Check client ownership
      if (upload.clientId !== context.clientId) {
        result.errors.push(`Upload '${uploadId}' does not belong to client '${context.clientId}'`);
        result.isValid = false;
        return result;
      }

      result.belongsToClient = true;

      // Check if active
      if (upload.status !== 'active') {
        result.warnings.push(`Upload '${uploadId}' is not active (status: ${upload.status}) but can still be analyzed`);
      } else {
        result.isActive = true;
      }

      result.companyName = `Client-${upload.clientId}-Company`;
      result.period = upload.uploadDate.toISOString().split('T')[0];

      // Add informational warnings
      if (upload.recordCount < 100) {
        result.warnings.push('This upload has relatively few records, analysis may be limited');
      }

      const uploadAge = Date.now() - upload.uploadDate.getTime();
      if (uploadAge > 180 * 24 * 60 * 60 * 1000) { // 180 days
        result.warnings.push('This upload is more than 6 months old - consider data freshness for lending decisions');
      }

    } catch (error) {
      result.errors.push(`Error validating upload context: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.isValid = false;
    }

    return result;
  }

  // Private helper methods

  private hasClientIdFilter(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('client_id') || lowerQuery.includes('clientid');
  }

  private hasUploadIdFilter(query: string, uploadId: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes(uploadId.toLowerCase()) || 
           lowerQuery.includes('upload_id') ||
           lowerQuery.includes('from upload_');
  }

  private hasLimitClause(query: string): boolean {
    return query.toLowerCase().includes('limit ') || query.toLowerCase().includes('top ');
  }

  private isPortfolioQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('portfolio') ||
           lowerQuery.includes('aggregate') ||
           lowerQuery.includes('sum(') ||
           lowerQuery.includes('avg(') ||
           lowerQuery.includes('group by') ||
           lowerQuery.includes('union') ||
           lowerQuery.includes('multiple');
  }

  private hasAggregationFunction(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('sum(') ||
           lowerQuery.includes('avg(') ||
           lowerQuery.includes('count(') ||
           lowerQuery.includes('max(') ||
           lowerQuery.includes('min(');
  }

  private hasGroupByClause(query: string): boolean {
    return query.toLowerCase().includes('group by');
  }

  private hasJoinWithoutConstraints(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const hasJoin = lowerQuery.includes('join');
    const hasOnClause = lowerQuery.includes(' on ');
    const hasWhereClause = lowerQuery.includes('where');
    
    return hasJoin && !hasOnClause && !hasWhereClause;
  }

  private hasOptimizationHints(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('index') || 
           lowerQuery.includes('hint') ||
           lowerQuery.includes('/*+');
  }

  private hasCrossClientAccess(query: string): boolean {
    // Look for patterns that might indicate cross-client access attempts
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes('client_id !=') ||
           lowerQuery.includes('client_id <>') ||
           lowerQuery.includes('not client_id') ||
           (lowerQuery.includes('client_id') && lowerQuery.includes('in ('));
  }

  private addClientIdFilter(query: string, clientId: string): string {
    // Simple implementation - add WHERE clause or extend existing WHERE
    if (query.toLowerCase().includes('where')) {
      return query.replace(/where/i, `WHERE client_id = '${clientId}' AND`);
    } else {
      // Find the FROM clause and add WHERE after it
      const fromMatch = query.match(/from\s+[\w\s,]+/i);
      if (fromMatch) {
        const insertPos = query.indexOf(fromMatch[0]) + fromMatch[0].length;
        return query.slice(0, insertPos) + ` WHERE client_id = '${clientId}'` + query.slice(insertPos);
      }
    }
    return query;
  }

  private addUploadIdFilter(query: string, uploadId: string): string {
    // For focused analysis, ensure the query uses the specific upload table
    if (query.toLowerCase().includes('from upload_')) {
      return query;
    }
    
    // Replace generic table references with specific upload table
    return query.replace(/from\s+(\w+)/i, `FROM ${uploadId}`);
  }

  private addLimitClause(query: string, maxRows: number): string {
    if (this.hasLimitClause(query)) {
      return query;
    }
    
    return `${query.trim()} LIMIT ${maxRows}`;
  }

  private addOptimizationHints(query: string): string {
    // Add basic optimization hints for portfolio queries
    if (this.isPortfolioQuery(query)) {
      return `/* Portfolio query optimization */ ${query}`;
    }
    return query;
  }

  private extractTableNames(query: string): string[] {
    const tables: string[] = [];
    const fromMatches = query.match(/from\s+(\w+)/gi);
    const joinMatches = query.match(/join\s+(\w+)/gi);
    
    if (fromMatches) {
      fromMatches.forEach(match => {
        const tableName = match.split(/\s+/)[1];
        if (tableName) tables.push(tableName);
      });
    }
    
    if (joinMatches) {
      joinMatches.forEach(match => {
        const tableName = match.split(/\s+/)[1];
        if (tableName) tables.push(tableName);
      });
    }
    
    return [...new Set(tables)]; // Remove duplicates
  }

  private isTableAllowed(tableName: string, allowedPatterns: string[]): boolean {
    return allowedPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace('*', '.*'), 'i');
      return regex.test(tableName);
    });
  }
}