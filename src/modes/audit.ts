/**
 * Audit Mode Strategy Implementation
 * 
 * Enforces single company context, restricts queries to specific upload_id,
 * and applies audit-specific validation rules and constraints.
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

export class AuditModeStrategy implements ModeStrategy {
  
  getConstraints(): ModeConstraints {
    return {
      // Audit mode requires single upload context
      requiresUploadId: true,
      allowsMultipleUploads: false,
      requiresClientIdFilter: true,
      allowsCrossClientQueries: false,
      
      // Conservative data access
      maxRowsPerQuery: 5000,
      allowedTablePatterns: [
        'upload_*',
        'client_*',
        'audit_*'
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
      maxHistoryDays: 365, // Allow up to 1 year of historical data within company
      
      // Validation rules
      mandatoryFilters: ['client_id'],
      prohibitedColumns: [
        'password',
        'token',
        'secret',
        'key'
      ]
    };
  }

  async validateQuery(query: string, context: ModeContext): Promise<ModeValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // Check for required upload context
      if (!context.uploadId) {
        errors.push('Audit mode requires a specific company context (upload_id)');
        return {
          isValid: false,
          errors,
          warnings,
          requiredContext: { uploadId: 'required' }
        };
      }

      // Validate upload exists and belongs to client
      const uploadValidation = await this.validateUploadContext(context.uploadId, context);
      if (!uploadValidation.isValid) {
        errors.push(...uploadValidation.errors);
      }
      warnings.push(...uploadValidation.warnings);

      // Check for prohibited operations
      const constraints = this.getConstraints();
      const queryUpper = query.toUpperCase();
      
      for (const operation of constraints.restrictedOperations) {
        if (queryUpper.includes(operation)) {
          errors.push(`Operation '${operation}' is not allowed in audit mode`);
        }
      }

      // Ensure client_id filter is present
      if (!this.hasClientIdFilter(query)) {
        warnings.push('Query will be automatically scoped to your client_id');
      }

      // Check for upload_id scoping
      if (!this.hasUploadIdFilter(query, context.uploadId)) {
        warnings.push('Query will be automatically scoped to the current company context');
      }

      // Validate table patterns
      const tableMentions = this.extractTableNames(query);
      for (const table of tableMentions) {
        if (!this.isTableAllowed(table, constraints.allowedTablePatterns)) {
          errors.push(`Table '${table}' is not accessible in audit mode`);
        }
      }

      // Check for prohibited columns
      for (const column of constraints.prohibitedColumns) {
        if (queryUpper.includes(column.toUpperCase())) {
          warnings.push(`Column '${column}' may contain sensitive data and should be avoided`);
        }
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

      // Apply upload_id filter if missing and context available
      if (context.uploadId && !this.hasUploadIdFilter(query, context.uploadId)) {
        modifiedQuery = this.addUploadIdFilter(modifiedQuery, context.uploadId);
        appliedConstraints.push('Added upload_id scoping');
      }

      // Apply row limit if not present
      if (!this.hasLimitClause(query)) {
        const constraints = this.getConstraints();
        modifiedQuery = this.addLimitClause(modifiedQuery, constraints.maxRowsPerQuery);
        appliedConstraints.push(`Added LIMIT ${constraints.maxRowsPerQuery}`);
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
      const clientUploads = uploadInfo.filter(upload => upload.clientId === clientId);
      
      context.availableUploadIds = clientUploads.map(upload => upload.tableName);

      // Set company context if uploadId provided
      if (uploadId) {
        const currentUpload = clientUploads.find(upload => upload.tableName === uploadId);
        if (currentUpload) {
          context.companyContext = {
            name: `Client-${clientId}`, // Could be enhanced with actual company names
            uploadId: uploadId,
            period: currentUpload.uploadDate.toISOString().split('T')[0]
          };
        }
      }

    } catch (error) {
      console.error('Error initializing audit mode session:', error);
    }

    return context;
  }

  validateSession(context: SessionContext): ModeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Audit mode must have upload context
    if (!context.currentUploadId) {
      errors.push('Audit mode requires a specific company context to be selected');
    }

    // Check if upload is still valid/available
    if (context.currentUploadId && !context.availableUploadIds.includes(context.currentUploadId)) {
      errors.push('Selected company context is no longer available');
    }

    // Check session age
    const sessionAge = Date.now() - context.createdAt.getTime();
    const maxAge = 8 * 60 * 60 * 1000; // 8 hours
    if (sessionAge > maxAge) {
      warnings.push('Session is getting old, consider refreshing company context');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  getAvailableActions(): string[] {
    return [
      'journal_entries',
      'vendor_payments',
      'expense_analysis',
      'unusual_patterns',
      'weekend_transactions',
      'account_balance',
      'customer_receipts',
      'user_activity',
      'compliance',
      'month_end_adjustments'
    ];
  }

  applyScoping(query: string, context: ModeContext): string {
    let scopedQuery = query;

    // Add client_id scoping
    if (!this.hasClientIdFilter(query)) {
      scopedQuery = this.addClientIdFilter(scopedQuery, context.clientId);
    }

    // Add upload_id scoping for audit mode
    if (context.uploadId && !this.hasUploadIdFilter(query, context.uploadId)) {
      scopedQuery = this.addUploadIdFilter(scopedQuery, context.uploadId);
    }

    return scopedQuery;
  }

  async validateUploadContext(uploadId: string | undefined, context: ModeContext): Promise<UploadContextValidation> {
    const result: UploadContextValidation = {
      isValid: false,
      uploadExists: false,
      belongsToClient: false,
      isActive: false,
      errors: [],
      warnings: []
    };

    if (!uploadId) {
      result.errors.push('Upload ID is required for audit mode');
      return result;
    }

    try {
      const uploadInfo = await getUploadTableInfo();
      const upload = uploadInfo.find(info => info.tableName === uploadId);

      if (!upload) {
        result.errors.push(`Upload '${uploadId}' not found`);
        return result;
      }

      result.uploadExists = true;

      // Check client ownership
      if (upload.clientId !== context.clientId) {
        result.errors.push(`Upload '${uploadId}' does not belong to client '${context.clientId}'`);
        return result;
      }

      result.belongsToClient = true;

      // Check if active
      if (upload.status !== 'active') {
        result.errors.push(`Upload '${uploadId}' is not active (status: ${upload.status})`);
        return result;
      }

      result.isActive = true;
      result.companyName = `Client-${upload.clientId}`;
      result.period = upload.uploadDate.toISOString().split('T')[0];
      result.isValid = true;

      // Add informational warnings
      if (upload.recordCount < 100) {
        result.warnings.push('This upload has relatively few records, results may be limited');
      }

      const uploadAge = Date.now() - upload.uploadDate.getTime();
      if (uploadAge > 90 * 24 * 60 * 60 * 1000) { // 90 days
        result.warnings.push('This upload is more than 90 days old');
      }

    } catch (error) {
      result.errors.push(`Error validating upload context: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  private addClientIdFilter(query: string, clientId: string): string {
    // Simple implementation - add WHERE clause or extend existing WHERE
    if (query.toLowerCase().includes('where')) {
      return query.replace(/where/i, `WHERE client_id = '${clientId}' AND`);
    } else {
      // Find the FROM clause and add WHERE after it
      const fromMatch = query.match(/from\s+\w+/i);
      if (fromMatch) {
        const insertPos = query.indexOf(fromMatch[0]) + fromMatch[0].length;
        return query.slice(0, insertPos) + ` WHERE client_id = '${clientId}'` + query.slice(insertPos);
      }
    }
    return query;
  }

  private addUploadIdFilter(query: string, uploadId: string): string {
    // Ensure the query uses the specific upload table
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