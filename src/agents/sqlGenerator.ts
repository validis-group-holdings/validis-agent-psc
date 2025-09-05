import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';
import { getQueryTemplates } from '../templates';

interface SQLQuery {
  sql: string;
  parameters: Record<string, any>;
}

export class SQLGeneratorAgent extends BaseAgent {
  constructor() {
    super('sql-generator');
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    if (!message.data.intent) return false;
    if (!message.data.schema) return false;
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const { intent, entities, schema } = message.data;

      // Get templates
      const templates = getQueryTemplates();
      const template = templates[intent];

      if (!template) {
        // Generate dynamic SQL if no template exists
        const dynamicSQL = this.generateDynamicSQL(
          schema,
          entities,
          context
        );

        if (!dynamicSQL) {
          return this.createErrorResult(
            `No template found for intent: ${intent}`,
            'TEMPLATE_NOT_FOUND',
            startTime
          );
        }

        return {
          success: true,
          data: {
            ...message.data,
            ...dynamicSQL
          },
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          }
        };
      }

      // Generate SQL from template
      const sqlQuery = this.generateFromTemplate(
        template,
        entities,
        context
      );

      // Add entity-based filters
      const enhancedQuery = this.addEntityFilters(
        sqlQuery,
        entities,
        schema
      );

      return {
        success: true,
        data: {
          ...message.data,
          ...enhancedQuery
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
        'SQL_GENERATION_ERROR',
        startTime
      );
    }
  }

  private generateFromTemplate(
    template: any,
    entities: Record<string, any>,
    context: AgentContext
  ): SQLQuery {
    let sql = template.sql;
    const parameters: Record<string, any> = {
      clientId: context.clientId,
      uploadId: context.uploadId
    };

    // Replace template parameters
    if (template.parameters) {
      for (const param of template.parameters) {
        if (param === 'clientId' || param === 'uploadId') {
          continue;
        }
        
        if (entities[param] !== undefined) {
          parameters[param] = entities[param];
        }
      }
    }

    return { sql, parameters };
  }

  private generateDynamicSQL(
    schema: any,
    entities: Record<string, any>,
    context: AgentContext
  ): SQLQuery | null {
    if (!schema.primaryTable) return null;

    const { primaryTable, joinTables, columns } = schema;
    
    // Build SELECT clause
    const selectColumns = columns?.length 
      ? columns.map((col: string) => `${primaryTable}.${col}`).join(', ')
      : `${primaryTable}.*`;
    
    // Build FROM clause with joins
    let fromClause = `FROM ${primaryTable}`;
    
    // Always join with upload table for client isolation
    if (joinTables?.includes('upload')) {
      fromClause += `\n  INNER JOIN upload u ON ${primaryTable}.uploadId = u.upload_id`;
    }

    // Add other joins
    if (joinTables) {
      for (const table of joinTables) {
        if (table === 'upload') continue;
        if (table === 'company') {
          fromClause += `\n  INNER JOIN company c ON c.uploadId = u.upload_id`;
        } else if (table === 'account') {
          fromClause += `\n  LEFT JOIN account a ON ${primaryTable}.accountId = a.id AND a.uploadId = ${primaryTable}.uploadId`;
        } else if (table === 'transactionHeader') {
          fromClause += `\n  INNER JOIN transactionHeader th ON ${primaryTable}.headerId = th.id AND ${primaryTable}.uploadId = th.uploadId`;
        }
      }
    }

    // Build WHERE clause
    const whereConditions = ['u.client_id = @clientId'];
    const parameters: Record<string, any> = {
      clientId: context.clientId
    };

    // Add entity-based conditions
    if (entities.amount && entities.operator) {
      const operator = this.getOperator(entities.operator);
      whereConditions.push(`${primaryTable}.amount ${operator} @amount`);
      parameters.amount = entities.amount;
    }

    if (entities.dateRange) {
      whereConditions.push(`${primaryTable}.date BETWEEN @startDate AND @endDate`);
      parameters.startDate = entities.dateRange.start;
      parameters.endDate = entities.dateRange.end;
    }

    if (entities.accountNumber) {
      whereConditions.push('a.account_number = @accountNumber');
      parameters.accountNumber = entities.accountNumber;
    }

    const sql = `
SELECT ${selectColumns}
${fromClause}
WHERE ${whereConditions.join(' AND ')}
    `.trim();

    return { sql, parameters };
  }

  private addEntityFilters(
    query: SQLQuery,
    entities: Record<string, any>,
    schema: any
  ): SQLQuery {
    const enhanced = { ...query };
    let { sql } = enhanced;

    // Add amount filter if not already present
    if (entities.amount && entities.operator && !sql.includes('@amount')) {
      const operator = this.getOperator(entities.operator);
      const amountCondition = `amount ${operator} @amount`;
      
      if (sql.includes('WHERE')) {
        sql = sql.replace(/WHERE/i, `WHERE ${amountCondition} AND`);
      } else {
        sql += ` WHERE ${amountCondition}`;
      }
      
      enhanced.parameters.amount = entities.amount;
    }

    // Add date range filter if not already present
    if (entities.dateRange && !sql.includes('@startDate')) {
      const dateCondition = `date BETWEEN @startDate AND @endDate`;
      
      if (sql.includes('WHERE')) {
        sql += ` AND ${dateCondition}`;
      } else {
        sql += ` WHERE ${dateCondition}`;
      }
      
      enhanced.parameters.startDate = entities.dateRange.start;
      enhanced.parameters.endDate = entities.dateRange.end;
    }

    // Handle transaction type filter
    if (entities.transactionType && schema.primaryTable === 'transactionHeader') {
      sql += ` AND transactionTypeId = @transactionTypeId`;
      // Map transaction type name to ID (1=Journal Entry, 2=Invoice, 3=Payment, 4=Credit Note)
      const typeMap: Record<string, number> = {
        'journal': 1,
        'invoice': 2,
        'payment': 3,
        'credit': 4
      };
      enhanced.parameters.transactionTypeId = typeMap[entities.transactionType.toLowerCase()] || 1;
    }

    // Handle negation (e.g., "not posted")
    if (entities.posted === false) {
      sql += ` AND posted = 0`;
    }

    enhanced.sql = sql;
    return enhanced;
  }

  private getOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      'greater_than': '>',
      'less_than': '<',
      'equal': '=',
      'greater_than_equal': '>=',
      'less_than_equal': '<=',
      'not_equal': '<>'
    };

    return operatorMap[operator] || '=';
  }

  private createErrorResult(message: string, code: string, startTime: number): AgentResult {
    return {
      success: false,
      error: {
        message,
        code
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