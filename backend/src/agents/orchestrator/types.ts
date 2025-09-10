/**
 * TypeScript interfaces for the Orchestrator Agent
 */

export enum AgentType {
  LENDING = 'lending',
  AUDIT = 'audit',
  ORCHESTRATOR = 'orchestrator'
}

export enum IntentType {
  LENDING = 'lending',
  AUDIT = 'audit',
  AMBIGUOUS = 'ambiguous'
}

export interface UserQuery {
  text: string;
  timestamp: Date;
  sessionId: string;
  userId?: string;
}

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  reasoning: string;
  keywords: string[];
  suggestedTemplates?: string[];
}

export interface RoutingDecision {
  targetAgent: AgentType;
  intent: IntentClassification;
  requiresClarification: boolean;
  clarificationPrompt?: string;
  explanation: string;
}

export interface ConversationContext {
  sessionId: string;
  messages: ConversationMessage[];
  currentIntent?: IntentType;
  metadata: Record<string, any>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  intent?: IntentType;
  routedTo?: AgentType;
}

export interface OrchestratorResponse {
  routing: RoutingDecision;
  response?: string;
  templates?: TemplateRecommendation[];
  context: ConversationContext;
}

export interface TemplateRecommendation {
  id: string;
  name: string;
  description: string;
  category: 'lending' | 'audit';
  relevanceScore: number;
}

export interface OrchestratorConfig {
  confidenceThreshold: number;
  maxContextMessages: number;
  clarificationEnabled: boolean;
  templateSuggestionEnabled: boolean;
}

export interface ClassificationCriteria {
  lendingKeywords: string[];
  auditKeywords: string[];
  lendingPatterns: RegExp[];
  auditPatterns: RegExp[];
}
