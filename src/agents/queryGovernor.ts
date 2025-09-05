import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';
import { QueryValidator } from '../safety/validator';
import { QueryGovernor } from '../safety/governor';

interface GovernedQuery {
  sql: string;
  parameters: Record<string, any>;
  safetyModifications: string[];
  executionParams: {
    timeout: number;
    maxRows: number;
  };
}

export class QueryGovernorAgent extends BaseAgent {
  private readonly MAX_ROWS = 100;
  private readonly QUERY_TIMEOUT = 5000;

  constructor() {
    super('query-governor');
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    if (!message.data.sql) return false;
    if (typeof message.data.sql !== 'string') return false;
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const { sql, parameters } = message.data;

      // Validate the query
      const validationResult = await QueryValidator.validate(
        sql, 
        context.clientId,
        context.workflowMode
      );
      
      if (!validationResult.isValid) {
        return this.createErrorResult(
          `Query rejected: ${validationResult.errors?.join(', ')}`,
          'QUERY_REJECTED',
          startTime,
          { details: validationResult.errors }
        );
      }

      // Apply safety rules
      const governedResult = QueryGovernor.govern(
        sql,
        context.clientId,
        context.workflowMode
      );
      
      // Create the governed query
      const governedQuery: GovernedQuery = {
        sql: governedResult.modifiedQuery || sql,
        parameters: parameters,
        safetyModifications: governedResult.warnings || [],
        executionParams: {
          timeout: this.QUERY_TIMEOUT,
          maxRows: this.MAX_ROWS
        }
      };

      // Additional safety checks based on SQL content
      const additionalSafety = this.applyAdditionalSafety(governedQuery);

      return {
        success: true,
        data: {
          ...message.data,
          ...additionalSafety
        },
        metadata: {
          agentName: this.name,
          agentId: this.id,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return this.createErrorResult(
        (error as Error).message,
        'GOVERNOR_ERROR',
        startTime
      );
    }
  }

  private applyAdditionalSafety(query: GovernedQuery): GovernedQuery {
    let { sql } = query;
    const modifications = [...query.safetyModifications];

    // Check if SQL is a SELECT statement
    const upperSQL = sql.toUpperCase().trim();
    if (!upperSQL.startsWith('SELECT')) {
      throw new Error('Only SELECT statements are allowed');
    }

    // Ensure TOP clause for SQL Server (MSSQL)
    if (!upperSQL.includes('TOP ')) {
      sql = sql.replace(/^SELECT/i, `SELECT TOP ${this.MAX_ROWS}`);
      modifications.push(`Added TOP ${this.MAX_ROWS} clause`);
    }

    // Check for dangerous operations
    const dangerousKeywords = ['DELETE', 'DROP', 'TRUNCATE', 'UPDATE', 'INSERT', 'EXEC', 'EXECUTE'];
    for (const keyword of dangerousKeywords) {
      if (upperSQL.includes(keyword)) {
        throw new Error(`Dangerous operation detected: ${keyword}`);
      }
    }

    // Check for comments that might hide malicious code
    if (sql.includes('--') || sql.includes('/*')) {
      sql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      modifications.push('Removed SQL comments');
    }

    // Ensure client_id filter is present
    if (!sql.includes('@clientId') && !sql.includes('client_id')) {
      // This is a critical security issue
      modifications.push('WARNING: Missing client_id filter - query may expose cross-client data');
    }

    // Set timeout in modifications
    if (!modifications.some(m => m.includes('timeout'))) {
      modifications.push(`Set query timeout to ${this.QUERY_TIMEOUT}ms`);
    }

    return {
      ...query,
      sql,
      safetyModifications: modifications
    };
  }

  private createErrorResult(
    message: string, 
    code: string, 
    startTime: number,
    additional?: any
  ): AgentResult {
    return {
      success: false,
      error: {
        message,
        code,
        ...additional
      },
      metadata: {
        agentName: this.name,
        agentId: this.id,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      }
    };
  }
}