import { BaseAgent, AgentMessage, AgentContext, AgentResult } from './baseAgent';
import { RedisService } from '../services/redis';

interface SessionData {
  sessionId: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
  uploadId: string;
  conversationHistory: ConversationEntry[];
  startTime: string;
}

interface ConversationEntry {
  query: string;
  intent: string;
  entities?: Record<string, any>;
  timestamp: string;
  response?: string;
}

export class ContextAgent extends BaseAgent {
  private readonly MAX_HISTORY_SIZE = 20;
  private readonly SESSION_TTL = 3600; // 1 hour
  private redis: RedisService;

  constructor(redis?: RedisService) {
    super('context-agent');
    this.redis = redis || new RedisService();
  }

  validate(message: AgentMessage): boolean {
    if (!message.data) return false;
    if (!message.data.query) return false;
    if (!message.data.intent) return false;
    return true;
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Validate message data
      if (!message.data) {
        return this.createErrorResult('Invalid message data', 'INVALID_DATA', startTime);
      }

      // Load session data
      const sessionData = await this.loadSessionData(context);
      
      // Create a snapshot of the original session data
      const originalSessionData = {
        ...sessionData,
        conversationHistory: [...sessionData.conversationHistory]
      };
      
      // Enrich query with context
      const enrichedQuery = await this.enrichQuery(
        message.data,
        sessionData,
        context
      );

      // Update conversation history
      await this.updateConversationHistory(
        sessionData,
        message.data,
        context.sessionId
      );

      return {
        success: true,
        data: {
          sessionData: originalSessionData,
          enrichedQuery
        },
        metadata: {
          agentName: this.name,
          agentId: this.id,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      // If Redis fails, continue without session data
      if ((error as Error).message.includes('Redis')) {
        const sessionData = this.createNewSession(context);
        const enrichedQuery = {
          ...message.data,
          context: {
            isNewSession: true,
            previousQueries: [],
            redisError: true
          }
        };

        return {
          success: true,
          data: {
            sessionData,
            enrichedQuery
          },
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          }
        };
      }

      return this.createErrorResult(
        (error as Error).message,
        'CONTEXT_ERROR',
        startTime
      );
    }
  }

  private async loadSessionData(context: AgentContext): Promise<SessionData> {
    const sessionKey = `session:${context.sessionId}`;
    
    try {
      const existingData = await this.redis.get(sessionKey);
      
      if (existingData) {
        return JSON.parse(existingData);
      }
    } catch (error) {
      // If Redis fails, create new session
      console.error('Failed to load session from Redis:', error);
    }

    return this.createNewSession(context);
  }

  private createNewSession(context: AgentContext): SessionData {
    return {
      sessionId: context.sessionId,
      clientId: context.clientId,
      workflowMode: context.workflowMode,
      uploadId: context.uploadId,
      conversationHistory: [],
      startTime: new Date().toISOString()
    };
  }

  private async enrichQuery(
    queryData: any,
    sessionData: SessionData,
    context: AgentContext
  ): Promise<any> {
    const enriched = { ...queryData };
    const isNewSession = sessionData.conversationHistory.length === 0;

    // Add basic context
    enriched.context = {
      isNewSession,
      previousQueries: sessionData.conversationHistory.slice(-5),
      workflowMode: context.workflowMode,
      currentDate: new Date().toISOString()
    };

    // Add workflow capabilities
    if (context.workflowMode === 'audit') {
      enriched.context.workflowCapabilities = [
        'audit_trail',
        'journal_entries',
        'general_ledger',
        'trial_balance'
      ];
    } else if (context.workflowMode === 'lending') {
      enriched.context.workflowCapabilities = [
        'portfolio_summary',
        'financial_ratios',
        'covenant_monitoring'
      ];
    }

    // Handle pronoun resolution
    if (queryData.query.toLowerCase().includes('that account')) {
      const lastAccountRef = this.findLastAccountReference(sessionData.conversationHistory);
      if (lastAccountRef) {
        enriched.entities = enriched.entities || {};
        enriched.entities.accountNumber = lastAccountRef;
        enriched.context.resolvedReferences = {
          'that account': lastAccountRef
        };
      }
    }

    // Handle conversation continuity
    if (this.isContinuation(queryData, sessionData)) {
      enriched.intent = this.adjustIntentForContinuation(
        queryData.intent,
        sessionData.conversationHistory
      );
      enriched.entities = this.mergeEntitiesFromHistory(
        queryData.entities,
        sessionData.conversationHistory
      );
    }

    // Handle time-based context
    if (queryData.entities?.period === 'current_month') {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      enriched.entities.dateRange = {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      };
    }

    return enriched;
  }

  private findLastAccountReference(history: ConversationEntry[]): string | null {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].entities?.accountNumber) {
        return history[i].entities!.accountNumber;
      }
    }
    return null;
  }

  private isContinuation(queryData: any, sessionData: SessionData): boolean {
    const query = queryData.query.toLowerCase();
    const continuationPhrases = [
      'compare with',
      'show more',
      'what about',
      'and also',
      'in addition'
    ];

    return continuationPhrases.some(phrase => query.includes(phrase)) &&
           sessionData.conversationHistory.length > 0;
  }

  private adjustIntentForContinuation(
    currentIntent: string,
    history: ConversationEntry[]
  ): string {
    if (currentIntent === 'compare' && history.length > 0) {
      const lastEntry = history[history.length - 1];
      if (lastEntry.intent === 'query_revenue' || lastEntry.intent === 'aggregate_revenue') {
        return 'compare_revenue';
      }
      if (lastEntry.intent === 'query_expenses') {
        return 'compare_expenses';
      }
    }
    return currentIntent;
  }

  private mergeEntitiesFromHistory(
    currentEntities: any,
    history: ConversationEntry[]
  ): any {
    const merged = { ...currentEntities };
    
    if (history.length === 0) return merged;
    
    const lastEntry = history[history.length - 1];
    
    // For comparison queries, merge periods
    if (merged.year && lastEntry.entities?.year) {
      merged.periods = [lastEntry.entities.year, merged.year];
      
      // Inherit metric from previous query
      if (lastEntry.intent.includes('revenue')) {
        merged.metric = 'revenue';
      } else if (lastEntry.intent.includes('expense')) {
        merged.metric = 'expenses';
      }
    }

    return merged;
  }

  private async updateConversationHistory(
    sessionData: SessionData,
    queryData: any,
    sessionId: string
  ): Promise<void> {
    const entry: ConversationEntry = {
      query: queryData.query,
      intent: queryData.intent,
      entities: queryData.entities,
      timestamp: new Date().toISOString()
    };

    sessionData.conversationHistory.push(entry);

    // Limit history size
    if (sessionData.conversationHistory.length > this.MAX_HISTORY_SIZE) {
      sessionData.conversationHistory = sessionData.conversationHistory.slice(-this.MAX_HISTORY_SIZE);
    }

    // Save to Redis
    try {
      const sessionKey = `session:${sessionId}`;
      await this.redis.set(sessionKey, JSON.stringify(sessionData));
      await this.redis.expire(sessionKey, this.SESSION_TTL);
    } catch (error) {
      console.error('Failed to save session to Redis:', error);
    }
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