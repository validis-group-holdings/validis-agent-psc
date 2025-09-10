/**
 * Main Orchestrator Agent Implementation
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { IntentClassifier } from './intentClassifier';
import { ContextManager } from './contextManager';
import {
  ORCHESTRATOR_PROMPT,
  CLARIFICATION_PROMPT,
  ROUTING_EXPLANATION_PROMPT,
  TEMPLATE_SUGGESTION_PROMPT,
  WELCOME_PROMPT,
  ERROR_PROMPTS,
  formatConversationHistory,
  formatKeywords,
  formatConfidence
} from './promptTemplates';
import {
  UserQuery,
  OrchestratorResponse,
  RoutingDecision,
  OrchestratorConfig,
  IntentType,
  AgentType,
  ConversationMessage,
  TemplateRecommendation
} from './types';

export class OrchestratorAgent {
  private intentClassifier: IntentClassifier;
  private contextManager: ContextManager;
  private llm: ChatAnthropic;
  private config: OrchestratorConfig;
  private outputParser: StringOutputParser;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      confidenceThreshold: config?.confidenceThreshold || 0.7,
      maxContextMessages: config?.maxContextMessages || 20,
      clarificationEnabled: config?.clarificationEnabled !== false,
      templateSuggestionEnabled: config?.templateSuggestionEnabled !== false
    };

    this.intentClassifier = new IntentClassifier();
    this.contextManager = new ContextManager(this.config);

    // Initialize LangChain components
    this.llm = new ChatAnthropic({
      modelName: 'claude-3-haiku-20240307',
      temperature: 0.3,
      maxTokens: 1000
    });

    this.outputParser = new StringOutputParser();
  }

  /**
   * Main orchestration method
   */
  public async orchestrate(query: UserQuery): Promise<OrchestratorResponse> {
    try {
      // Get or create context
      const context = this.contextManager.getContext(query.sessionId);

      // Add user message to context
      await this.contextManager.addMessage(query.sessionId, {
        role: 'user',
        content: query.text,
        timestamp: query.timestamp
      });

      // Classify intent
      const classification = this.intentClassifier.classifyIntent(query);

      // Make routing decision
      const routing = await this.makeRoutingDecision(query, classification);

      // Generate response based on routing
      let response: string | undefined;

      if (routing.requiresClarification) {
        response = await this.generateClarification(query, classification);
      } else {
        response = await this.generateRoutingExplanation(routing);
      }

      // Get template suggestions if enabled
      let templates: TemplateRecommendation[] = [];
      if (this.config.templateSuggestionEnabled && classification.suggestedTemplates) {
        templates = await this.generateTemplateRecommendations(
          classification.suggestedTemplates,
          classification.intent
        );
      }

      // Add assistant message to context
      await this.contextManager.addMessage(query.sessionId, {
        role: 'assistant',
        content: response || routing.explanation,
        timestamp: new Date(),
        intent: classification.intent,
        routedTo: routing.targetAgent
      });

      return {
        routing,
        response,
        templates,
        context: this.contextManager.getContext(query.sessionId)
      };
    } catch (error) {
      console.error('Orchestration error:', error);
      throw new Error(`Failed to orchestrate query: ${error}`);
    }
  }

  /**
   * Make routing decision based on classification
   */
  private async makeRoutingDecision(
    query: UserQuery,
    classification: any
  ): Promise<RoutingDecision> {
    // Check if clarification is needed
    const requiresClarification =
      this.config.clarificationEnabled &&
      (classification.intent === IntentType.AMBIGUOUS ||
       classification.confidence < this.config.confidenceThreshold);

    let targetAgent: AgentType;
    let explanation: string;
    let clarificationPrompt: string | undefined;

    if (requiresClarification) {
      targetAgent = AgentType.ORCHESTRATOR;
      explanation = 'Additional information needed to route your request appropriately.';
      clarificationPrompt = await this.generateClarificationPrompt(query, classification);
    } else {
      // Determine target agent
      targetAgent = classification.intent === IntentType.LENDING
        ? AgentType.LENDING
        : AgentType.AUDIT;

      // Generate routing explanation
      explanation = await this.generateExplanation(query, classification, targetAgent);
    }

    return {
      targetAgent,
      intent: classification,
      requiresClarification,
      clarificationPrompt,
      explanation
    };
  }

  /**
   * Generate clarification request
   */
  private async generateClarification(
    query: UserQuery,
    classification: any
  ): Promise<string> {
    const prompt = await CLARIFICATION_PROMPT.format({
      query: query.text,
      keywords: formatKeywords(classification.keywords),
      lendingIndicators: classification.keywords
        .filter((k: string) => this.isLendingKeyword(k))
        .join(', ') || 'None',
      auditIndicators: classification.keywords
        .filter((k: string) => this.isAuditKeyword(k))
        .join(', ') || 'None'
    });

    const response = await this.llm.invoke(prompt);
    return this.outputParser.parse(response);
  }

  /**
   * Generate clarification prompt
   */
  private async generateClarificationPrompt(
    query: UserQuery,
    classification: any
  ): Promise<string> {
    const basePrompt = `I need a bit more information to route your request to the right specialist.\n\n`;

    if (classification.confidence < 0.3) {
      return basePrompt +
        `Are you looking for:\n` +
        `• Portfolio/lending analysis (multiple companies, credit assessment)\n` +
        `• Audit procedures (single company, financial statement review)`;
    }

    const lendingScore = classification.keywords
      .filter((k: string) => this.isLendingKeyword(k)).length;
    const auditScore = classification.keywords
      .filter((k: string) => this.isAuditKeyword(k)).length;

    if (Math.abs(lendingScore - auditScore) < 2) {
      return basePrompt +
        `Your query could relate to either:\n` +
        `• Portfolio analysis across multiple companies\n` +
        `• Audit procedures for a specific company\n\n` +
        `Which type of analysis do you need?`;
    }

    return basePrompt + `Could you specify whether you need analysis for a single company or multiple companies?`;
  }

  /**
   * Generate routing explanation
   */
  private async generateRoutingExplanation(routing: RoutingDecision): Promise<string> {
    const prompt = await ROUTING_EXPLANATION_PROMPT.format({
      query: routing.intent.reasoning,
      targetAgent: routing.targetAgent,
      classification: routing.intent.intent,
      confidence: Math.round(routing.intent.confidence * 100),
      keyIndicators: formatKeywords(routing.intent.keywords)
    });

    const response = await this.llm.invoke(prompt);
    return this.outputParser.parse(response);
  }

  /**
   * Generate explanation for routing decision
   */
  private async generateExplanation(
    query: UserQuery,
    classification: any,
    targetAgent: AgentType
  ): Promise<string> {
    const agentName = targetAgent === AgentType.LENDING ? 'Lending' : 'Audit';
    const confidence = formatConfidence(classification.confidence);

    return `Routing to ${agentName} Agent (Confidence: ${confidence}). ${classification.reasoning}`;
  }

  /**
   * Generate template recommendations
   */
  private async generateTemplateRecommendations(
    suggestedTemplates: string[],
    intent: IntentType
  ): Promise<TemplateRecommendation[]> {
    return suggestedTemplates.map((template, index) => ({
      id: `template_${intent}_${index}`,
      name: template,
      description: this.getTemplateDescription(template),
      category: intent === IntentType.LENDING ? 'lending' : 'audit',
      relevanceScore: 1.0 - (index * 0.2) // Decrease score for lower priority templates
    }));
  }

  /**
   * Get template description
   */
  private getTemplateDescription(templateName: string): string {
    const descriptions: Record<string, string> = {
      'Portfolio Financial Analysis Template': 'Comprehensive analysis framework for evaluating multiple companies in a portfolio',
      'Multi-Company Comparison Template': 'Side-by-side comparison of financial metrics across companies',
      'Covenant Compliance Testing Template': 'Structured approach to test and document covenant compliance',
      'Credit Risk Assessment Template': 'Framework for evaluating credit risk and lending decisions',
      'Substantive Testing Procedures Template': 'Detailed procedures for substantive audit testing',
      'Internal Control Testing Template': 'Framework for testing and evaluating internal controls',
      'Financial Statement Audit Template': 'Comprehensive audit program for financial statements',
      'Materiality Calculation Template': 'Tools and methods for calculating audit materiality'
    };

    return descriptions[templateName] || 'Template for financial analysis and reporting';
  }

  /**
   * Check if keyword is lending-related
   */
  private isLendingKeyword(keyword: string): boolean {
    const lendingKeywords = [
      'portfolio', 'portfolios', 'multiple companies', 'loan',
      'lending', 'credit', 'debt', 'covenant', 'facility'
    ];
    return lendingKeywords.includes(keyword.toLowerCase());
  }

  /**
   * Check if keyword is audit-related
   */
  private isAuditKeyword(keyword: string): boolean {
    const auditKeywords = [
      'audit', 'auditor', 'materiality', 'substantive',
      'control', 'testing', 'procedure', 'assertion'
    ];
    return auditKeywords.includes(keyword.toLowerCase());
  }

  /**
   * Get welcome message
   */
  public getWelcomeMessage(): string {
    return WELCOME_PROMPT;
  }

  /**
   * Handle error scenarios
   */
  public handleError(errorType: keyof typeof ERROR_PROMPTS, params?: Record<string, string>): string {
    let errorMessage = ERROR_PROMPTS[errorType];

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        errorMessage = errorMessage.replace(`{${key}}`, value);
      });
    }

    return errorMessage;
  }

  /**
   * Get conversation summary
   */
  public getConversationSummary(sessionId: string) {
    return this.contextManager.getConversationSummary(sessionId);
  }

  /**
   * Analyze conversation patterns
   */
  public analyzePatterns(sessionId: string) {
    return this.contextManager.analyzePatterns(sessionId);
  }

  /**
   * Clear session context
   */
  public clearSession(sessionId: string): void {
    this.contextManager.clearContext(sessionId);
  }

  /**
   * Cleanup inactive sessions
   */
  public cleanupInactiveSessions(maxInactiveMinutes: number = 30): number {
    return this.contextManager.cleanupInactiveSessions(maxInactiveMinutes);
  }

  /**
   * Export session data
   */
  public exportSession(sessionId: string): string {
    return this.contextManager.exportContext(sessionId);
  }

  /**
   * Import session data
   */
  public importSession(sessionId: string, data: string): void {
    this.contextManager.importContext(sessionId, data);
  }
}

// Export the orchestrator instance factory
export function createOrchestratorAgent(config?: Partial<OrchestratorConfig>): OrchestratorAgent {
  return new OrchestratorAgent(config);
}

// Export all types for external use
export * from './types';
