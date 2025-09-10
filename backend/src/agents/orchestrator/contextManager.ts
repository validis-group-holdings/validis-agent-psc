/**
 * Context Manager for maintaining conversation history and state
 */

import { BufferMemory } from 'langchain/memory';
import {
  ConversationContext,
  ConversationMessage,
  IntentType,
  AgentType,
  OrchestratorConfig
} from './types';

export class ContextManager {
  private contexts: Map<string, ConversationContext>;
  private memories: Map<string, BufferMemory>;
  private readonly config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.contexts = new Map();
    this.memories = new Map();
    this.config = config;
  }

  /**
   * Initialize or retrieve context for a session
   */
  public getContext(sessionId: string): ConversationContext {
    if (!this.contexts.has(sessionId)) {
      this.initializeContext(sessionId);
    }
    return this.contexts.get(sessionId)!;
  }

  /**
   * Initialize a new conversation context
   */
  private initializeContext(sessionId: string): void {
    const context: ConversationContext = {
      sessionId,
      messages: [],
      currentIntent: undefined,
      metadata: {
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        routingHistory: []
      }
    };

    // Initialize LangChain memory
    const memory = new BufferMemory({
      returnMessages: true,
      memoryKey: 'history',
      inputKey: 'input',
      outputKey: 'output'
    });

    this.contexts.set(sessionId, context);
    this.memories.set(sessionId, memory);
  }

  /**
   * Add a message to the conversation context
   */
  public async addMessage(sessionId: string, message: ConversationMessage): Promise<void> {
    const context = this.getContext(sessionId);

    // Add to our context
    context.messages.push(message);
    context.metadata.lastActivity = new Date();
    context.metadata.messageCount++;

    // Update current intent if provided
    if (message.intent) {
      context.currentIntent = message.intent;
    }

    // Track routing decisions
    if (message.routedTo) {
      if (!context.metadata.routingHistory) {
        context.metadata.routingHistory = [];
      }
      context.metadata.routingHistory.push({
        agent: message.routedTo,
        timestamp: message.timestamp,
        intent: message.intent
      });
    }

    // Add to LangChain memory
    const memory = this.memories.get(sessionId);
    if (memory) {
      if (message.role === 'user') {
        await memory.saveContext(
          { input: message.content },
          { output: '' } // Will be updated when assistant responds
        );
      } else if (message.role === 'assistant') {
        // Update the last context with assistant response
        const lastMessages = await memory.chatHistory.getMessages();
        if (lastMessages.length > 0) {
          await memory.saveContext(
            { input: lastMessages[lastMessages.length - 1].content },
            { output: message.content }
          );
        }
      }
    }

    // Trim messages if exceeding max limit
    this.trimContext(context);
  }

  /**
   * Get conversation history for LangChain
   */
  public async getMemory(sessionId: string): Promise<BufferMemory> {
    if (!this.memories.has(sessionId)) {
      this.initializeContext(sessionId);
    }
    return this.memories.get(sessionId)!;
  }

  /**
   * Get recent messages from context
   */
  public getRecentMessages(sessionId: string, limit: number = 10): ConversationMessage[] {
    const context = this.getContext(sessionId);
    return context.messages.slice(-limit);
  }

  /**
   * Get conversation summary
   */
  public getConversationSummary(sessionId: string): {
    messageCount: number;
    duration: number;
    intents: IntentType[];
    routedAgents: AgentType[];
  } {
    const context = this.getContext(sessionId);
    const startTime = context.metadata.createdAt as Date;
    const endTime = context.metadata.lastActivity as Date;

    const intents = new Set<IntentType>();
    const routedAgents = new Set<AgentType>();

    context.messages.forEach((msg) => {
      if (msg.intent) intents.add(msg.intent);
      if (msg.routedTo) routedAgents.add(msg.routedTo);
    });

    return {
      messageCount: context.messages.length,
      duration: endTime.getTime() - startTime.getTime(),
      intents: Array.from(intents),
      routedAgents: Array.from(routedAgents)
    };
  }

  /**
   * Analyze conversation patterns
   */
  public analyzePatterns(sessionId: string): {
    dominantIntent: IntentType | undefined;
    switchCount: number;
    clarificationRate: number;
  } {
    const context = this.getContext(sessionId);

    // Count intent occurrences
    const intentCounts = new Map<IntentType, number>();
    let previousIntent: IntentType | undefined;
    let switchCount = 0;
    let clarificationCount = 0;

    context.messages.forEach((msg) => {
      if (msg.intent) {
        intentCounts.set(msg.intent, (intentCounts.get(msg.intent) || 0) + 1);

        if (previousIntent && previousIntent !== msg.intent) {
          switchCount++;
        }
        previousIntent = msg.intent;

        if (msg.intent === IntentType.AMBIGUOUS) {
          clarificationCount++;
        }
      }
    });

    // Find dominant intent
    let dominantIntent: IntentType | undefined;
    let maxCount = 0;
    intentCounts.forEach((count, intent) => {
      if (count > maxCount) {
        maxCount = count;
        dominantIntent = intent;
      }
    });

    const clarificationRate =
      context.messages.length > 0 ? clarificationCount / context.messages.length : 0;

    return {
      dominantIntent,
      switchCount,
      clarificationRate
    };
  }

  /**
   * Trim context to maintain memory limits
   */
  private trimContext(context: ConversationContext): void {
    if (context.messages.length > this.config.maxContextMessages) {
      // Keep system messages and recent messages
      const systemMessages = context.messages.filter((m) => m.role === 'system');
      const recentMessages = context.messages.slice(-this.config.maxContextMessages);

      context.messages = [...systemMessages, ...recentMessages.filter((m) => m.role !== 'system')];
    }
  }

  /**
   * Clear context for a session
   */
  public clearContext(sessionId: string): void {
    this.contexts.delete(sessionId);
    this.memories.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): string[] {
    return Array.from(this.contexts.keys());
  }

  /**
   * Clean up inactive sessions
   */
  public cleanupInactiveSessions(maxInactiveMinutes: number = 30): number {
    const now = new Date();
    const maxInactiveMs = maxInactiveMinutes * 60 * 1000;
    let cleanedCount = 0;

    this.contexts.forEach((context, sessionId) => {
      const lastActivity = context.metadata.lastActivity as Date;
      if (now.getTime() - lastActivity.getTime() > maxInactiveMs) {
        this.clearContext(sessionId);
        cleanedCount++;
      }
    });

    return cleanedCount;
  }

  /**
   * Export context for persistence
   */
  public exportContext(sessionId: string): string {
    const context = this.getContext(sessionId);
    return JSON.stringify(context, null, 2);
  }

  /**
   * Import context from persistence
   */
  public importContext(sessionId: string, data: string): void {
    try {
      const context = JSON.parse(data) as ConversationContext;

      // Convert date strings back to Date objects
      context.messages.forEach((msg) => {
        msg.timestamp = new Date(msg.timestamp);
      });
      context.metadata.createdAt = new Date(context.metadata.createdAt);
      context.metadata.lastActivity = new Date(context.metadata.lastActivity);

      this.contexts.set(sessionId, context);

      // Rebuild LangChain memory from messages
      const memory = new BufferMemory({
        returnMessages: true,
        memoryKey: 'history',
        inputKey: 'input',
        outputKey: 'output'
      });

      // Reconstruct conversation pairs
      for (let i = 0; i < context.messages.length; i++) {
        const msg = context.messages[i];
        if (msg.role === 'user' && i + 1 < context.messages.length) {
          const nextMsg = context.messages[i + 1];
          if (nextMsg.role === 'assistant') {
            memory.saveContext({ input: msg.content }, { output: nextMsg.content });
          }
        }
      }

      this.memories.set(sessionId, memory);
    } catch (error) {
      throw new Error(`Failed to import context: ${error}`);
    }
  }
}
