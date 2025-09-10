/**
 * Main Audit Agent for company-specific financial analysis
 */

import { AuditQueryRequest, AuditQueryResponse, AuditRisk } from './types';
import { AuditSQLGenerator } from './sqlGenerator';
import { buildAuditPrompt } from './promptTemplates';
import databaseContextManager from '../../services/database-context';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

export class AuditAgent {
  private sqlGenerator: AuditSQLGenerator | null = null;
  private isInitialized: boolean = false;

  /**
   * Initialize the Audit Agent
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Audit Agent...');

      // Ensure database context is initialized
      if (!databaseContextManager.isReady()) {
        await databaseContextManager.initialize();
      }

      const context = databaseContextManager.getContext();
      if (!context) {
        throw new Error('Failed to get database context');
      }

      // Initialize SQL generator
      this.sqlGenerator = new AuditSQLGenerator(context);

      this.isInitialized = true;
      logger.info('Audit Agent initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Audit Agent:', error);
      throw error;
    }
  }

  /**
   * Process a natural language query and generate SQL
   */
  async processQuery(request: AuditQueryRequest): Promise<AuditQueryResponse> {
    if (!this.isInitialized || !this.sqlGenerator) {
      await this.initialize();
    }

    logger.info('Processing audit query:', {
      query: request.naturalLanguageQuery,
      company: request.companyName,
      clientId: request.clientId
    });

    try {
      // Validate request
      this.validateRequest(request);

      // Generate SQL using the SQL generator
      const response = await this.sqlGenerator!.generateSQL(request);

      // Log confidence level
      if (response.confidence < 0.8) {
        logger.warn('Lower confidence SQL generation:', {
          confidence: response.confidence,
          query: request.naturalLanguageQuery,
          company: request.companyName
        });
      }

      // Log audit risks if identified
      if (response.auditRisks && response.auditRisks.length > 0) {
        logger.info('Audit risks identified:', {
          company: request.companyName,
          riskCount: response.auditRisks.length,
          highRisks: response.auditRisks.filter(r => r.level === 'high').length
        });
      }

      // Add additional context if needed
      if (response.warnings && response.warnings.length > 0) {
        logger.warn('SQL generation warnings:', response.warnings);
      }

      logger.info('Successfully generated SQL for audit query', {
        confidence: response.confidence,
        involvedTables: response.involvedTables.length,
        queryType: response.queryType,
        risksIdentified: response.auditRisks?.length || 0
      });

      return response;
    } catch (error) {
      logger.error('Failed to process audit query:', error);
      throw error;
    }
  }

  /**
   * Generate SQL with Chain of Thought reasoning
   */
  async generateWithReasoning(
    query: string,
    clientId: string,
    companyName: string,
    includeFullSchema: boolean = true
  ): Promise<{
    sql: string;
    reasoning: string;
    confidence: number;
    risks: AuditRisk[];
  }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const context = databaseContextManager.getContext();
    if (!context) {
      throw new Error('Database context not available');
    }

    // Build the prompt with reasoning
    const prompt = buildAuditPrompt(query, companyName, context, includeFullSchema);

    // This would normally call an LLM for generation
    // For now, we'll use the SQL generator and add reasoning
    const request: AuditQueryRequest = {
      naturalLanguageQuery: query,
      clientId,
      companyName,
      includeExplanation: true,
      useLatestUpload: true
    };

    const response = await this.processQuery(request);

    const reasoning = `
ANALYSIS:
=========
Company: ${companyName}
Query Type: ${response.queryType}
Focus: Company-specific audit analysis
Confidence: ${(response.confidence * 100).toFixed(0)}%

APPROACH:
=========
1. Identified this as a ${response.queryType} query for ${companyName}
2. Will use the latest upload for current period analysis
3. Applied multi-tenant filtering with client_id and company_name
4. Used uploadId as primary filter for optimal performance
5. Included audit-specific fields and risk categorization

TABLES USED:
============
${response.involvedTables.map(t => `- ${t}`).join('\n')}

EXPECTED OUTPUT:
================
${response.expectedColumns.map(c => `- ${c}`).join('\n')}

${response.explanation || ''}

AUDIT RISKS IDENTIFIED:
=======================
${response.auditRisks?.map(r => `- [${r.level.toUpperCase()}] ${r.category}: ${r.description}`).join('\n') || '- No specific risks identified'}

PERFORMANCE OPTIMIZATIONS:
==========================
${response.performanceNotes?.map(n => `- ${n}`).join('\n') || '- Standard optimizations applied'}

AUDIT RECOMMENDATIONS:
======================
${response.auditRisks?.map(r => r.recommendation).filter(r => r).map(r => `- ${r}`).join('\n') || '- Perform standard audit procedures'}
`;

    return {
      sql: response.sql,
      reasoning,
      confidence: response.confidence,
      risks: response.auditRisks || []
    };
  }

  /**
   * Validate an audit query request
   */
  private validateRequest(request: AuditQueryRequest): void {
    if (!request.naturalLanguageQuery || request.naturalLanguageQuery.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (!request.clientId || request.clientId.trim().length === 0) {
      throw new Error('Client ID is required for multi-tenant isolation');
    }

    if (!request.companyName || request.companyName.trim().length === 0) {
      throw new Error('Company name is required for audit queries');
    }

    // Check if query is asking for portfolio (not company-specific)
    const lowerQuery = request.naturalLanguageQuery.toLowerCase();
    if (lowerQuery.includes('portfolio') ||
        lowerQuery.includes('all companies') ||
        lowerQuery.includes('across companies')) {
      logger.warn('Query appears to be for portfolio, not single company. Consider using Lending Agent instead.');
    }

    // Warn if no specific audit focus is clear
    const auditKeywords = ['variance', 'aged', 'journal', 'duplicate', 'cutoff', 'round', 'manual', 'adjustment'];
    if (!auditKeywords.some(keyword => lowerQuery.includes(keyword))) {
      logger.info('No specific audit focus detected, will perform general analysis');
    }
  }

  /**
   * Get available query templates
   */
  getAvailableTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    example: string;
    riskLevel: string;
  }> {
    const templates = databaseContextManager.getSampleQueries('audit');

    return templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      example: t.naturalLanguageExample,
      riskLevel: this.determineTemplateRiskLevel(t.id)
    }));
  }

  /**
   * Determine risk level for a template
   */
  private determineTemplateRiskLevel(templateId: string): string {
    if (templateId.includes('duplicate') || templateId.includes('weekend') || templateId.includes('aged')) {
      return 'high';
    } else if (templateId.includes('variance') || templateId.includes('round') || templateId.includes('cutoff')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Test the agent with a sample query
   */
  async testWithSampleQuery(): Promise<void> {
    const sampleRequest: AuditQueryRequest = {
      naturalLanguageQuery: 'Identify transactions more than 10% up or down versus prior period for ABC Company',
      clientId: 'test-client-123',
      companyName: 'ABC Company',
      includeExplanation: true,
      maxResults: 100,
      useLatestUpload: true
    };

    logger.info('Testing Audit Agent with sample query...');

    try {
      const response = await this.processQuery(sampleRequest);

      logger.info('Sample query test successful:', {
        confidence: response.confidence,
        sqlLength: response.sql.length,
        tables: response.involvedTables,
        columns: response.expectedColumns,
        risks: response.auditRisks?.length || 0
      });

      console.log('\n=== GENERATED SQL ===\n');
      console.log(response.sql);

      if (response.explanation) {
        console.log('\n=== EXPLANATION ===\n');
        console.log(response.explanation);
      }

      if (response.auditRisks && response.auditRisks.length > 0) {
        console.log('\n=== AUDIT RISKS ===\n');
        response.auditRisks.forEach(risk => {
          console.log(`[${risk.level.toUpperCase()}] ${risk.category}: ${risk.description}`);
          if (risk.recommendation) {
            console.log(`  Recommendation: ${risk.recommendation}`);
          }
        });
      }

      if (response.warnings && response.warnings.length > 0) {
        console.log('\n=== WARNINGS ===\n');
        response.warnings.forEach(w => console.log(`- ${w}`));
      }
    } catch (error) {
      logger.error('Sample query test failed:', error);
      throw error;
    }
  }

  /**
   * Perform risk assessment for a company
   */
  async performRiskAssessment(
    clientId: string,
    companyName: string
  ): Promise<{
    overallRisk: 'high' | 'medium' | 'low';
    riskAreas: AuditRisk[];
    recommendations: string[];
  }> {
    logger.info('Performing risk assessment for company:', companyName);

    const riskAreas: AuditRisk[] = [];
    const recommendations: string[] = [];

    // Run multiple audit checks
    const checks = [
      'Check for journal entries made on weekends or after hours',
      'Identify duplicate payments in the last 3 months',
      'Find transactions with significant variance from prior period',
      'Identify aged receivables over 120 days',
      'Check for round amount transactions that may be estimates'
    ];

    for (const check of checks) {
      try {
        const response = await this.processQuery({
          naturalLanguageQuery: check,
          clientId,
          companyName,
          maxResults: 10,
          useLatestUpload: true
        });

        if (response.auditRisks) {
          riskAreas.push(...response.auditRisks);
        }
      } catch (error) {
        logger.error(`Risk check failed: ${check}`, error);
      }
    }

    // Determine overall risk level
    const highRisks = riskAreas.filter(r => r.level === 'high').length;
    const mediumRisks = riskAreas.filter(r => r.level === 'medium').length;

    let overallRisk: 'high' | 'medium' | 'low';
    if (highRisks >= 2) {
      overallRisk = 'high';
      recommendations.push('Immediate detailed review required');
      recommendations.push('Consider expanding audit procedures');
    } else if (highRisks >= 1 || mediumRisks >= 3) {
      overallRisk = 'medium';
      recommendations.push('Enhanced audit procedures recommended');
      recommendations.push('Focus on high-risk areas identified');
    } else {
      overallRisk = 'low';
      recommendations.push('Standard audit procedures sufficient');
      recommendations.push('Continue monitoring for changes');
    }

    // Add specific recommendations based on risks
    const uniqueRecommendations = new Set<string>();
    riskAreas.forEach(risk => {
      if (risk.recommendation) {
        uniqueRecommendations.add(risk.recommendation);
      }
    });
    recommendations.push(...Array.from(uniqueRecommendations));

    logger.info('Risk assessment complete:', {
      company: companyName,
      overallRisk,
      riskAreasCount: riskAreas.length,
      recommendationsCount: recommendations.length
    });

    return {
      overallRisk,
      riskAreas,
      recommendations
    };
  }
}

// Create singleton instance
const auditAgent = new AuditAgent();

// Export everything
export {
  auditAgent,
  AuditQueryRequest,
  AuditQueryResponse,
  AuditRisk
};

// Default export
export default auditAgent;
