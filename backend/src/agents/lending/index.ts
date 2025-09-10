/**
 * Main Lending Agent for portfolio-wide financial analysis
 */

import { LendingQueryRequest, LendingQueryResponse } from './types';
import { LendingSQLGenerator } from './sqlGenerator';
import { buildLendingPrompt } from './promptTemplates';
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

export class LendingAgent {
  private sqlGenerator: LendingSQLGenerator | null = null;
  private isInitialized: boolean = false;

  /**
   * Initialize the Lending Agent
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Lending Agent...');

      // Ensure database context is initialized
      if (!databaseContextManager.isReady()) {
        await databaseContextManager.initialize();
      }

      const context = databaseContextManager.getContext();
      if (!context) {
        throw new Error('Failed to get database context');
      }

      // Initialize SQL generator
      this.sqlGenerator = new LendingSQLGenerator(context);

      this.isInitialized = true;
      logger.info('Lending Agent initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Lending Agent:', error);
      throw error;
    }
  }

  /**
   * Process a natural language query and generate SQL
   */
  async processQuery(request: LendingQueryRequest): Promise<LendingQueryResponse> {
    if (!this.isInitialized || !this.sqlGenerator) {
      await this.initialize();
    }

    logger.info('Processing lending query:', {
      query: request.naturalLanguageQuery,
      clientId: request.clientId
    });

    try {
      // Validate request
      this.validateRequest(request);

      // Generate SQL using the SQL generator
      const response = await this.sqlGenerator!.generateSQL(request);

      // Log confidence level
      if (response.confidence < 0.7) {
        logger.warn('Low confidence SQL generation:', {
          confidence: response.confidence,
          query: request.naturalLanguageQuery
        });
      }

      // Add additional context if needed
      if (response.warnings && response.warnings.length > 0) {
        logger.warn('SQL generation warnings:', response.warnings);
      }

      logger.info('Successfully generated SQL for lending query', {
        confidence: response.confidence,
        involvedTables: response.involvedTables.length,
        queryType: response.queryType
      });

      return response;
    } catch (error) {
      logger.error('Failed to process lending query:', error);
      throw error;
    }
  }

  /**
   * Generate SQL with Chain of Thought reasoning
   */
  async generateWithReasoning(
    query: string,
    clientId: string,
    includeFullSchema: boolean = true
  ): Promise<{
    sql: string;
    reasoning: string;
    confidence: number;
  }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const context = databaseContextManager.getContext();
    if (!context) {
      throw new Error('Database context not available');
    }

    // Build the prompt with reasoning
    const prompt = buildLendingPrompt(query, context, includeFullSchema);

    // This would normally call an LLM for generation
    // For now, we'll use the SQL generator and add reasoning
    const request: LendingQueryRequest = {
      naturalLanguageQuery: query,
      clientId,
      includeExplanation: true
    };

    const response = await this.processQuery(request);

    const reasoning = `
ANALYSIS:
=========
Query Type: ${response.queryType}
Focus: Portfolio-wide lending analysis
Confidence: ${(response.confidence * 100).toFixed(0)}%

APPROACH:
=========
1. Identified this as a ${response.queryType} query requiring portfolio-wide analysis
2. Will use latest uploads from the last 3 months for each company
3. Applied multi-tenant filtering with client_id
4. Used uploadId as primary filter for optimal performance
5. Aggregated metrics across ${response.involvedTables.length} tables

TABLES USED:
============
${response.involvedTables.map(t => `- ${t}`).join('\n')}

EXPECTED OUTPUT:
================
${response.expectedColumns.map(c => `- ${c}`).join('\n')}

${response.explanation || ''}

PERFORMANCE OPTIMIZATIONS:
==========================
${response.performanceNotes?.map(n => `- ${n}`).join('\n') || '- Standard optimizations applied'}
`;

    return {
      sql: response.sql,
      reasoning,
      confidence: response.confidence
    };
  }

  /**
   * Validate a lending query request
   */
  private validateRequest(request: LendingQueryRequest): void {
    if (!request.naturalLanguageQuery || request.naturalLanguageQuery.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (!request.clientId || request.clientId.trim().length === 0) {
      throw new Error('Client ID is required for multi-tenant isolation');
    }

    // Check if query is asking for single company (not portfolio)
    const lowerQuery = request.naturalLanguageQuery.toLowerCase();
    if (lowerQuery.includes('single company') ||
        lowerQuery.includes('one company') ||
        lowerQuery.includes('specific company')) {
      logger.warn('Query appears to be for single company, not portfolio. Consider using Audit Agent instead.');
    }

    // Warn if query timeframe is too broad
    if (lowerQuery.includes('all time') || lowerQuery.includes('since inception')) {
      logger.warn('Query timeframe may be too broad. Consider limiting to recent periods for performance.');
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
  }> {
    const templates = databaseContextManager.getSampleQueries('lending');

    return templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      example: t.naturalLanguageExample
    }));
  }

  /**
   * Test the agent with a sample query
   */
  async testWithSampleQuery(): Promise<void> {
    const sampleRequest: LendingQueryRequest = {
      naturalLanguageQuery: 'Show me the top 20 asset-based finance opportunities across the portfolio',
      clientId: 'test-client-123',
      includeExplanation: true,
      maxResults: 20
    };

    logger.info('Testing Lending Agent with sample query...');

    try {
      const response = await this.processQuery(sampleRequest);

      logger.info('Sample query test successful:', {
        confidence: response.confidence,
        sqlLength: response.sql.length,
        tables: response.involvedTables,
        columns: response.expectedColumns
      });

      console.log('\n=== GENERATED SQL ===\n');
      console.log(response.sql);

      if (response.explanation) {
        console.log('\n=== EXPLANATION ===\n');
        console.log(response.explanation);
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
}

// Create singleton instance
const lendingAgent = new LendingAgent();

// Export everything
export {
  lendingAgent,
  LendingQueryRequest,
  LendingQueryResponse
};

// Default export
export default lendingAgent;
