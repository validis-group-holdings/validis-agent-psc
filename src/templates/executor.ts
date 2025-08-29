import { QueryTemplate, TemplateExecutionResult, ExecutionContext } from './common/types';
import { connectDatabase, getDatabaseConnection } from '../db/connection';
import sql from 'mssql';

export class TemplateExecutor {
  private connectionPool: sql.ConnectionPool | null = null;

  constructor() {
    this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      this.connectionPool = await connectDatabase();
    } catch (error) {
      console.error('Failed to initialize database connection:', error);
      throw error;
    }
  }

  async executeTemplate(
    template: QueryTemplate, 
    context: ExecutionContext
  ): Promise<TemplateExecutionResult> {
    const startTime = Date.now();
    
    try {
      if (!this.connectionPool) {
        await this.initializeConnection();
      }

      // Prepare the SQL with parameters
      const request = this.connectionPool!.request();
      
      // Add client context
      request.input('clientId', sql.UniqueIdentifier, context.clientId);
      
      // Add template parameters
      for (const param of template.parameters) {
        if (context.parameters.hasOwnProperty(param.name)) {
          const value = context.parameters[param.name];
          this.addSqlParameter(request, param.name, param.type, value);
        } else if (param.required) {
          throw new Error(`Required parameter '${param.name}' is missing`);
        } else if (param.defaultValue !== undefined) {
          this.addSqlParameter(request, param.name, param.type, param.defaultValue);
        }
      }

      // Execute the query
      const result = await request.query(template.sql);
      const executionTime = Date.now() - startTime;

      return {
        templateId: template.id,
        success: true,
        data: result.recordset,
        executionTime,
        rowCount: result.recordset.length
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`Template execution failed for ${template.id}:`, error);

      return {
        templateId: template.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      };
    }
  }

  async executeMultipleTemplates(
    templates: QueryTemplate[],
    context: ExecutionContext
  ): Promise<TemplateExecutionResult[]> {
    const results: TemplateExecutionResult[] = [];
    
    for (const template of templates) {
      try {
        const result = await this.executeTemplate(template, context);
        results.push(result);
      } catch (error) {
        results.push({
          templateId: template.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          executionTime: 0
        });
      }
    }

    return results;
  }

  async executeBatchTemplates(
    templates: QueryTemplate[],
    context: ExecutionContext,
    batchSize: number = 5
  ): Promise<TemplateExecutionResult[]> {
    const results: TemplateExecutionResult[] = [];
    
    for (let i = 0; i < templates.length; i += batchSize) {
      const batch = templates.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(template => this.executeTemplate(template, context))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            templateId: batch[results.length % batchSize]?.id || 'unknown',
            success: false,
            error: result.reason?.message || 'Batch execution failed',
            executionTime: 0
          });
        }
      }
    }

    return results;
  }

  private addSqlParameter(
    request: sql.Request, 
    name: string, 
    type: string, 
    value: any
  ): void {
    switch (type) {
      case 'string':
        request.input(name, sql.NVarChar, value);
        break;
      case 'number':
        request.input(name, sql.Decimal(18, 2), value);
        break;
      case 'date':
        request.input(name, sql.DateTime, new Date(value));
        break;
      case 'boolean':
        request.input(name, sql.Bit, value);
        break;
      default:
        request.input(name, sql.NVarChar, value?.toString());
    }
  }

  async validateTemplate(template: QueryTemplate): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Basic template validation
    if (!template.id) {
      errors.push('Template ID is required');
    }

    if (!template.name) {
      errors.push('Template name is required');
    }

    if (!template.sql) {
      errors.push('Template SQL is required');
    }

    if (!['audit', 'lending'].includes(template.category)) {
      errors.push('Template category must be either "audit" or "lending"');
    }

    if (!['low', 'medium', 'high'].includes(template.complexity)) {
      errors.push('Template complexity must be "low", "medium", or "high"');
    }

    // Parameter validation
    for (const param of template.parameters) {
      if (!param.name) {
        errors.push('Parameter name is required');
      }

      if (!['string', 'number', 'date', 'boolean'].includes(param.type)) {
        errors.push(`Invalid parameter type: ${param.type}`);
      }
    }

    // SQL validation (basic checks)
    const sql = template.sql.toLowerCase();
    
    // Check for required patterns
    if (!sql.includes('recentupload')) {
      errors.push('Template must use RecentUpload CTE pattern');
    }

    if (template.category === 'audit' && !sql.includes('@clientid')) {
      errors.push('Audit templates must include @clientId parameter');
    }

    // Check for potentially dangerous SQL operations
    const dangerousPatterns = ['drop ', 'truncate ', 'delete ', 'insert ', 'update ', 'alter '];
    for (const pattern of dangerousPatterns) {
      if (sql.includes(pattern)) {
        errors.push(`Template contains potentially dangerous SQL operation: ${pattern.trim()}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async testTemplate(
    template: QueryTemplate,
    testContext: ExecutionContext
  ): Promise<{
    success: boolean;
    executionTime: number;
    rowCount?: number;
    error?: string;
    sampleData?: any[];
  }> {
    try {
      const result = await this.executeTemplate(template, testContext);
      
      return {
        success: result.success,
        executionTime: result.executionTime,
        rowCount: result.rowCount,
        error: result.error,
        sampleData: result.data?.slice(0, 5) // Return first 5 rows as sample
      };
    } catch (error) {
      return {
        success: false,
        executionTime: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getExecutionStats(templateId: string): Promise<{
    totalExecutions: number;
    averageExecutionTime: number;
    successRate: number;
    lastExecution?: Date;
  } | null> {
    // This would typically query an execution log table
    // For now, return null to indicate not implemented
    return null;
  }

  async close(): Promise<void> {
    if (this.connectionPool) {
      await this.connectionPool.close();
      this.connectionPool = null;
    }
  }
}

// Helper function to create executor instance
export function createTemplateExecutor(): TemplateExecutor {
  return new TemplateExecutor();
}

// Helper function to validate execution context
export function validateExecutionContext(context: ExecutionContext): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!context.clientId) {
    errors.push('Client ID is required');
  }

  // Validate clientId format (should be a valid UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (context.clientId && !uuidRegex.test(context.clientId)) {
    errors.push('Client ID must be a valid UUID');
  }

  if (!context.parameters || typeof context.parameters !== 'object') {
    errors.push('Parameters must be an object');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Convenience function for direct template execution
export async function executeTemplate(
  template: QueryTemplate, 
  context: ExecutionContext
): Promise<TemplateExecutionResult> {
  const executor = new TemplateExecutor();
  try {
    const result = await executor.executeTemplate(template, context);
    await executor.close();
    return result;
  } catch (error) {
    await executor.close();
    throw error;
  }
}

export default TemplateExecutor;