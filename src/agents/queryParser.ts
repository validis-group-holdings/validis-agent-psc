import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';

interface ParsedQuery {
  intent: string;
  entities: Record<string, any>;
  confidence?: number;
  workflowSpecific?: boolean;
  suggestions?: string[];
}

export class QueryParserAgent extends BaseAgent {
  private readonly MAX_QUERY_LENGTH = 1000;
  
  private readonly intentPatterns = new Map<string, RegExp[]>([
    ['query_journal_entries', [
      /journal\s+entr/i,
      /\bje\b/i,
      /journal/i
    ]],
    ['query_transactions', [
      /transaction/i,
      /\btxn/i,
      /payment/i,
      /receipt/i
    ]],
    ['aggregate_revenue', [
      /total\s+revenue/i,
      /revenue\s+sum/i,
      /revenue.*aggregate/i
    ]],
    ['compare_expenses', [
      /compare.*expense/i,
      /expense.*comparison/i,
      /expense.*between/i
    ]],
    ['query_account_balance', [
      /balance.*account/i,
      /account.*balance/i,
      /show.*balance/i
    ]],
    ['list_portfolio_companies', [
      /portfolio/i,
      /companies/i,
      /holdings/i
    ]],
    ['query_audit_trail', [
      /audit\s+trail/i,
      /audit\s+log/i,
      /change\s+history/i
    ]],
    ['calculate_dscr', [
      /debt\s+service\s+coverage/i,
      /dscr/i,
      /coverage\s+ratio/i
    ]],
    ['export_data', [
      /export/i,
      /download/i,
      /save\s+as/i
    ]],
    ['query_portfolio', [
      /portfolio\s+summary/i,
      /portfolio\s+overview/i
    ]],
    ['check_covenants', [
      /covenant/i,
      /compliance\s+check/i
    ]],
    ['query_balance_sheet', [
      /balance\s+sheet/i,
      /financial\s+position/i
    ]]
  ]);

  constructor() {
    super('query-parser');
  }

  validate(message: AgentMessage): boolean {
    // Basic structure validation only
    if (!message.data) return false;
    // Allow execute to handle missing/invalid query field for better error messages
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      // Check for missing query field
      if (message.data.query === undefined) {
        return this.createErrorResult('No query provided', 'NO_QUERY', startTime);
      }
      
      if (typeof message.data.query !== 'string') {
        return this.createErrorResult('Query must be a string', 'INVALID_QUERY_TYPE', startTime);
      }
      
      const query = message.data.query.trim();
      
      // Check for empty or too long queries
      if (query === '') {
        return this.createErrorResult('Empty query provided', 'EMPTY_QUERY', startTime);
      }
      
      if (query.length > this.MAX_QUERY_LENGTH) {
        return this.createErrorResult(
          `Query too long (${query.length} characters, max ${this.MAX_QUERY_LENGTH})`, 
          'QUERY_TOO_LONG', 
          startTime
        );
      }

      // Parse the query
      const parsed = this.parseQuery(query, context.workflowMode);

      return {
        success: true,
        data: parsed,
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
        'PARSE_ERROR',
        startTime
      );
    }
  }

  private parseQuery(query: string, workflowMode: 'audit' | 'lending'): ParsedQuery {
    // Detect intent
    const intent = this.detectIntent(query, workflowMode);
    
    // If no clear intent, need clarification
    if (intent === 'clarification_needed') {
      return {
        intent,
        entities: {},
        suggestions: ['journal entries', 'balance sheet', 'transactions', 'portfolio summary']
      };
    }

    // Extract entities based on intent
    const entities = this.extractEntities(query, intent);
    
    // Check if workflow-specific
    const workflowSpecific = this.isWorkflowSpecific(intent, workflowMode);

    return {
      intent,
      entities,
      workflowSpecific,
      confidence: 0.9
    };
  }

  private detectIntent(query: string, workflowMode: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Check each intent pattern
    for (const [intent, patterns] of this.intentPatterns.entries()) {
      // Check workflow restrictions
      if (workflowMode === 'lending' && intent === 'query_audit_trail') {
        continue;
      }
      
      for (const pattern of patterns) {
        if (pattern.test(lowerQuery)) {
          return intent;
        }
      }
    }

    // Check for ambiguous queries
    if (lowerQuery.includes('show me') && lowerQuery.split(' ').length <= 4) {
      return 'clarification_needed';
    }

    // Default intents based on keywords
    if (lowerQuery.includes('get') || lowerQuery.includes('find')) {
      if (lowerQuery.includes('transaction')) {
        return 'query_transactions';
      }
    }

    return 'clarification_needed';
  }

  private extractEntities(query: string, intent: string): Record<string, any> {
    const entities: Record<string, any> = {};
    const lowerQuery = query.toLowerCase();

    // For aggregation queries, extract metric first
    if (intent === 'aggregate_revenue') {
      if (lowerQuery.includes('total')) {
        entities.metric = 'total';
      }
    }
    
    // Extract account numbers before general numbers
    const accountMatch = query.match(/account\s+(\d+)/i);
    if (accountMatch) {
      entities.accountNumber = accountMatch[1];
    }
    
    // Extract amounts for transaction/journal queries
    if (intent === 'query_transactions' || intent === 'query_journal_entries') {
      // Look for money amounts with $ or keywords like "over", "under"
      const amountMatch = query.match(/(?:\$|over|under|greater than|less than)\s*([\d,]+(?:\.\d+)?)/i);
      if (amountMatch) {
        entities.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        
        // Detect operators
        if (lowerQuery.includes('over') || lowerQuery.includes('greater than') || lowerQuery.includes('>')) {
          entities.operator = 'greater_than';
        } else if (lowerQuery.includes('under') || lowerQuery.includes('less than') || lowerQuery.includes('<')) {
          entities.operator = 'less_than';
        } else if (lowerQuery.includes('equal') || lowerQuery.includes('=')) {
          entities.operator = 'equal';
        }
      }
    }

    // Extract date ranges
    const dateRange = this.extractDateRange(query);
    if (dateRange) {
      entities.dateRange = dateRange;
    }

    // Extract comparison periods first (before general year extraction)
    const compareMatch = query.match(/between\s+(\d{4})\s+and\s+(\d{4})/i);
    if (compareMatch) {
      entities.periods = [compareMatch[1], compareMatch[2]];
      entities.metric = 'expenses'; // Default based on context
    } else {
      // Extract periods only if not a comparison query
      const periodMatch = query.match(/Q(\d)\s+(\d{4})/i);
      if (periodMatch) {
        entities.period = `Q${periodMatch[1]}`;
        entities.year = parseInt(periodMatch[2]);
      } else if (intent !== 'query_account_balance' && query.match(/(\d{4})/)) {
        const yearMatch = query.match(/(\d{4})/);
        if (yearMatch && !accountMatch) {
          entities.year = parseInt(yearMatch[1]);
        }
      }
    }

    // Extract transaction type
    if (lowerQuery.includes('credit')) {
      entities.transactionType = 'credit';
    } else if (lowerQuery.includes('debit')) {
      entities.transactionType = 'debit';
    }

    // Extract export format
    if (intent === 'export_data') {
      if (lowerQuery.includes('csv')) {
        entities.format = 'CSV';
      } else if (lowerQuery.includes('pdf')) {
        entities.format = 'PDF';
      } else if (lowerQuery.includes('excel')) {
        entities.format = 'XLSX';
      }
      
      // Extract data type
      if (lowerQuery.includes('trial balance')) {
        entities.dataType = 'trial_balance';
      } else if (lowerQuery.includes('journal')) {
        entities.dataType = 'journal_entries';
      }
    }

    // Handle negation
    if (lowerQuery.includes('not posted')) {
      entities.posted = false;
      entities.target = 'general_ledger';
    }

    // Handle scope for portfolio queries
    if (intent === 'list_portfolio_companies' && lowerQuery.includes('all')) {
      entities.scope = 'all';
    }

    return entities;
  }

  private extractDateRange(query: string): { start: string; end: string } | null {
    const months = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };

    // Check for month range
    const monthRangeMatch = query.toLowerCase().match(
      /(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+to\s+|\s*-\s*)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i
    );

    if (monthRangeMatch) {
      const startMonth = months[monthRangeMatch[1].toLowerCase() as keyof typeof months];
      const endMonth = months[monthRangeMatch[2].toLowerCase() as keyof typeof months];
      const year = monthRangeMatch[3];
      
      const lastDay = new Date(parseInt(year), parseInt(endMonth), 0).getDate();
      
      return {
        start: `${year}-${startMonth}-01`,
        end: `${year}-${endMonth}-${lastDay}`
      };
    }

    // Check for single month
    const singleMonthMatch = query.toLowerCase().match(
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i
    );

    if (singleMonthMatch) {
      const month = months[singleMonthMatch[1].toLowerCase() as keyof typeof months];
      const year = singleMonthMatch[2];
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      
      return {
        start: `${year}-${month}-01`,
        end: `${year}-${month}-${lastDay}`
      };
    }

    return null;
  }

  private isWorkflowSpecific(intent: string, workflowMode: string): boolean {
    const auditSpecific = ['query_audit_trail'];
    const lendingSpecific = ['calculate_dscr', 'check_covenants'];

    if (workflowMode === 'audit' && auditSpecific.includes(intent)) {
      return true;
    }
    
    if (workflowMode === 'lending' && lendingSpecific.includes(intent)) {
      return true;
    }

    return false;
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