import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';

interface FormattedResponse {
  response: string;
  formattedResults?: any[];
  exportOptions?: string[];
  workflowFormatting?: string;
  errorHandled?: boolean;
  fallbackResponse?: string;
}

export class ResponseFormatterAgent extends BaseAgent {
  constructor() {
    super('response-formatter');
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    if (!message.data.query) return false;
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const { query, intent, results, rowCount, error } = message.data;

      // Handle error responses
      if (error) {
        const errorResponse = this.formatErrorResponse(query, error);
        return {
          success: true,
          data: errorResponse,
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          }
        };
      }

      // Format based on result type
      const formattedResponse = this.formatQueryResponse(
        query,
        intent,
        results,
        rowCount,
        context.workflowMode
      );

      return {
        success: true,
        data: formattedResponse,
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
        'FORMATTING_ERROR',
        startTime
      );
    }
  }

  private formatQueryResponse(
    query: string,
    intent: string,
    results: any[],
    rowCount: number,
    workflowMode: string
  ): FormattedResponse {
    // Handle empty results
    if (!results || rowCount === 0) {
      return this.formatEmptyResponse(query, intent);
    }

    // Handle aggregation results
    if (intent.includes('aggregate') || intent.includes('calculate')) {
      return this.formatAggregationResponse(query, intent, results, workflowMode);
    }

    // Handle large result sets
    if (rowCount >= 100) {
      return this.formatLargeResultSet(query, intent, results, rowCount);
    }

    // Standard query response
    return this.formatStandardResponse(query, intent, results, rowCount);
  }

  private formatEmptyResponse(query: string, intent: string): FormattedResponse {
    const entityType = this.getEntityType(intent);
    const criteria = this.extractCriteria(query);

    return {
      response: `No ${entityType} found ${criteria}. You may want to adjust your search criteria or check if the data has been uploaded for the specified period.`,
      formattedResults: []
    };
  }

  private formatAggregationResponse(
    query: string,
    intent: string,
    results: any[],
    workflowMode: string
  ): FormattedResponse {
    const result = results[0];
    
    if (intent === 'aggregate_revenue') {
      const revenue = result.total_revenue || result.revenue;
      const period = result.period || this.extractPeriod(query);
      return {
        response: `The total revenue for ${period} is ${this.formatCurrency(revenue)}.`,
        formattedResults: results,
        workflowFormatting: workflowMode
      };
    }

    if (intent === 'calculate_dscr') {
      const dscr = result.dscr;
      const period = result.period || '2024';
      return {
        response: `Debt Service Coverage Ratio for ${period}: ${dscr}x\n\nA DSCR of ${dscr}x indicates that the company generates ${dscr} times the cash flow needed to cover its debt obligations.`,
        formattedResults: results,
        workflowFormatting: 'lending'
      };
    }

    // Generic aggregation
    return {
      response: this.buildAggregationSummary(results),
      formattedResults: results
    };
  }

  private formatLargeResultSet(
    query: string,
    intent: string,
    results: any[],
    rowCount: number
  ): FormattedResponse {
    const entityType = this.getEntityType(intent);
    const criteria = this.extractCriteria(query);

    return {
      response: `Found ${rowCount} ${entityType} ${criteria}. Showing first 100 results. Consider refining your search criteria or exporting the full dataset.`,
      formattedResults: results.slice(0, 100),
      exportOptions: ['CSV', 'PDF', 'Excel']
    };
  }

  private formatStandardResponse(
    query: string,
    intent: string,
    results: any[],
    rowCount: number
  ): FormattedResponse {
    const entityType = this.getEntityType(intent);
    const criteria = this.extractCriteria(query);
    
    // Build summary based on intent
    let summary = `Found ${rowCount} ${entityType}`;
    
    if (criteria) {
      summary += ` ${criteria}`;
    }

    // Add specific details based on intent
    if (intent === 'query_journal_entries' && results.length > 0) {
      const totalAmount = results.reduce((sum, r) => sum + (r.amount || 0), 0);
      summary += `\n\nTotal amount: ${this.formatCurrency(totalAmount)}`;
    }

    return {
      response: summary,
      formattedResults: results,
      exportOptions: rowCount > 20 ? ['CSV', 'PDF'] : undefined
    };
  }

  private formatErrorResponse(query: string, error: string): FormattedResponse {
    return {
      response: `I was unable to complete your request: "${query}". Please try rephrasing your question or contact support if the issue persists.`,
      errorHandled: true,
      fallbackResponse: 'I can help you query financial data. Try asking questions like "Show me journal entries over $10,000" or "What is the total revenue for Q1 2024?"'
    };
  }

  private getEntityType(intent: string): string {
    const entityMap: Record<string, string> = {
      'query_journal_entries': 'journal entries',
      'query_transactions': 'transactions',
      'query_portfolio': 'portfolio companies',
      'query_balance_sheet': 'balance sheet items',
      'query_audit_trail': 'audit entries',
      'query_account_balance': 'account balances',
      'list_portfolio_companies': 'companies'
    };

    return entityMap[intent] || 'results';
  }

  private extractCriteria(query: string): string {
    // Extract amount criteria
    const amountMatch = query.match(/over \$?([\d,]+)/i);
    if (amountMatch) {
      return `over $${amountMatch[1]}`;
    }

    // Extract date criteria
    const dateMatch = query.match(/(?:for|from|in)\s+(\w+\s+\d{4}|\d{4}|Q\d\s+\d{4})/i);
    if (dateMatch) {
      return `for ${dateMatch[1]}`;
    }

    // Extract account criteria
    const accountMatch = query.match(/account\s+(\d+)/i);
    if (accountMatch) {
      return `for account ${accountMatch[1]}`;
    }

    return '';
  }

  private extractPeriod(query: string): string {
    const periodMatch = query.match(/Q(\d)\s+(\d{4})/i);
    if (periodMatch) {
      return `Q${periodMatch[1]} ${periodMatch[2]}`;
    }

    const yearMatch = query.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      return yearMatch[1];
    }

    return 'the specified period';
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  }

  private buildAggregationSummary(results: any[]): string {
    if (results.length === 0) return 'No aggregation results available.';
    
    const result = results[0];
    const lines: string[] = [];

    for (const [key, value] of Object.entries(result)) {
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (typeof value === 'number') {
        if (key.includes('amount') || key.includes('revenue') || key.includes('expense')) {
          lines.push(`${formattedKey}: ${this.formatCurrency(value)}`);
        } else if (key.includes('ratio') || key.includes('percent')) {
          lines.push(`${formattedKey}: ${value.toFixed(2)}%`);
        } else {
          lines.push(`${formattedKey}: ${value.toLocaleString()}`);
        }
      } else {
        lines.push(`${formattedKey}: ${value}`);
      }
    }

    return lines.join('\n');
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