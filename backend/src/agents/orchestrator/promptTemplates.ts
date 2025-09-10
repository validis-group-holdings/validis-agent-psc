/**
 * Prompt Templates for the Orchestrator Agent
 */

import { PromptTemplate } from '@langchain/core/prompts';

/**
 * Main orchestrator prompt for analyzing and routing queries
 */
export const ORCHESTRATOR_PROMPT = new PromptTemplate({
  template: `You are an intelligent orchestrator agent for a financial analysis system. Your role is to understand user queries and route them to the appropriate specialist agent.

Available Agents:
1. LENDING AGENT: Handles portfolio analysis, multiple company comparisons, lending/credit analysis, covenant compliance, and cross-company metrics.
2. AUDIT AGENT: Handles single company audits, financial statement analysis, audit procedures, control testing, and compliance verification.

Current Conversation Context:
{conversationHistory}

User Query: {query}

Previous Intent: {previousIntent}

Analyze the user's query and determine:
1. The primary intent (lending or audit)
2. Key indicators that support your classification
3. Whether clarification is needed
4. Which agent should handle this request

Provide your analysis in a clear, structured format.`,
  inputVariables: ['query', 'conversationHistory', 'previousIntent']
});

/**
 * Clarification prompt when intent is ambiguous
 */
export const CLARIFICATION_PROMPT = new PromptTemplate({
  template: `The user's query is ambiguous and could relate to either lending/portfolio analysis or audit procedures.

User Query: "{query}"

Detected Keywords: {keywords}

Lending Indicators: {lendingIndicators}
Audit Indicators: {auditIndicators}

Generate a helpful clarification question to determine the user's intent. Be specific and provide examples of what each path would entail.

Clarification Response:`,
  inputVariables: ['query', 'keywords', 'lendingIndicators', 'auditIndicators']
});

/**
 * Routing explanation prompt
 */
export const ROUTING_EXPLANATION_PROMPT = new PromptTemplate({
  template: `Explain why the query is being routed to the {targetAgent} agent.

User Query: "{query}"
Classification: {classification}
Confidence: {confidence}%
Key Indicators: {keyIndicators}

Provide a brief, user-friendly explanation of the routing decision:`,
  inputVariables: ['query', 'targetAgent', 'classification', 'confidence', 'keyIndicators']
});

/**
 * Template suggestion prompt
 */
export const TEMPLATE_SUGGESTION_PROMPT = new PromptTemplate({
  template: `Based on the user's query and intent, suggest relevant analysis templates.

User Query: "{query}"
Intent: {intent}
Keywords: {keywords}

Available Templates:
{availableTemplates}

Suggest the most relevant templates (maximum 3) with brief descriptions of how they apply to the user's needs:`,
  inputVariables: ['query', 'intent', 'keywords', 'availableTemplates']
});

/**
 * Context summary prompt for maintaining conversation flow
 */
export const CONTEXT_SUMMARY_PROMPT = new PromptTemplate({
  template: `Summarize the conversation context for handoff to the {targetAgent} agent.

Conversation History:
{conversationHistory}

Current Query: "{currentQuery}"
Identified Intent: {intent}
Key Topics Discussed: {topics}

Provide a concise summary that helps the specialist agent understand the context:`,
  inputVariables: ['targetAgent', 'conversationHistory', 'currentQuery', 'intent', 'topics']
});

/**
 * Welcome prompt for initial interaction
 */
export const WELCOME_PROMPT = `Welcome to the Validis Financial Analysis System. I'm here to help route your queries to the appropriate specialist.

I can connect you with:
- **Lending Agent**: For portfolio analysis, multiple company comparisons, credit risk assessment, and covenant compliance
- **Audit Agent**: For single company audits, financial statement analysis, control testing, and audit procedures

How can I assist you today?`;

/**
 * Error handling prompts
 */
export const ERROR_PROMPTS = {
  ROUTING_FAILED: `I apologize, but I'm having difficulty routing your request. Could you please rephrase your query or specify whether you need:
- Portfolio/lending analysis (multiple companies, credit assessment)
- Audit procedures (single company, financial statement review)`,

  AGENT_UNAVAILABLE: `The {agentType} agent is currently unavailable. Please try again in a moment or rephrase your query.`,

  CONTEXT_LOST: `I seem to have lost track of our conversation context. Could you please restate your request or question?`,

  INVALID_INPUT: `I didn't understand your input. Please provide a clear question or request related to financial analysis, auditing, or lending.`
};

/**
 * Routing rules prompt for complex decisions
 */
export const ROUTING_RULES_PROMPT = new PromptTemplate({
  template: `Apply these routing rules to determine the appropriate agent:

ROUTE TO LENDING AGENT IF:
- Query mentions portfolio, multiple companies, or cross-company analysis
- Focus is on credit risk, lending metrics, or debt analysis
- User wants to compare companies or analyze industry trends
- Covenant compliance or loan performance is discussed
- Aggregate or consolidated financial analysis is needed

ROUTE TO AUDIT AGENT IF:
- Query mentions audit procedures, testing, or controls
- Focus is on a single company's financial statements
- User needs materiality calculations or risk assessments
- Substantive procedures or compliance testing is required
- Internal controls or SOX compliance is discussed

REQUIRE CLARIFICATION IF:
- Query could apply to both single and multiple companies
- Intent is unclear after analyzing keywords
- Confidence in classification is below {confidenceThreshold}%
- User is asking about general financial analysis without context

Query: "{query}"
Keywords Found: {keywords}
Confidence Level: {confidence}%

Decision:`,
  inputVariables: ['query', 'keywords', 'confidence', 'confidenceThreshold']
});

/**
 * Generate clarification options for ambiguous queries
 */
export const CLARIFICATION_OPTIONS_PROMPT = new PromptTemplate({
  template: `Generate clarification options for the ambiguous query.

Query: "{query}"

Create 2-3 specific options that help determine if the user needs:
1. Lending/Portfolio analysis
2. Audit/Single company analysis

Format as clear, actionable choices the user can select:`,
  inputVariables: ['query']
});

/**
 * Handoff prompt for transferring to specialist agent
 */
export const HANDOFF_PROMPT = new PromptTemplate({
  template: `Prepare handoff message to {targetAgent} agent.

User Query: "{query}"
Context Summary: {contextSummary}
Identified Requirements: {requirements}
Suggested Approach: {suggestedApproach}

Generate a professional handoff message that includes all relevant context:`,
  inputVariables: ['targetAgent', 'query', 'contextSummary', 'requirements', 'suggestedApproach']
});

/**
 * Learning prompt for improving classification
 */
export const LEARNING_PROMPT = new PromptTemplate({
  template: `Analyze this routing decision for improvement opportunities.

Query: "{query}"
Initial Classification: {initialClassification}
Final Agent Used: {finalAgent}
User Feedback: {feedback}
Success: {success}

Identify patterns or keywords that could improve future routing:`,
  inputVariables: ['query', 'initialClassification', 'finalAgent', 'feedback', 'success']
});

/**
 * Helper function to get appropriate prompt based on scenario
 */
export function getPromptForScenario(scenario: string): PromptTemplate | string {
  const promptMap: Record<string, PromptTemplate | string> = {
    orchestrate: ORCHESTRATOR_PROMPT,
    clarify: CLARIFICATION_PROMPT,
    explain: ROUTING_EXPLANATION_PROMPT,
    suggest: TEMPLATE_SUGGESTION_PROMPT,
    summarize: CONTEXT_SUMMARY_PROMPT,
    welcome: WELCOME_PROMPT,
    rules: ROUTING_RULES_PROMPT,
    options: CLARIFICATION_OPTIONS_PROMPT,
    handoff: HANDOFF_PROMPT,
    learn: LEARNING_PROMPT
  };

  return promptMap[scenario] || ORCHESTRATOR_PROMPT;
}

/**
 * Format conversation history for prompt
 */
export function formatConversationHistory(
  messages: Array<{ role: string; content: string }>
): string {
  if (messages.length === 0) {
    return 'No previous conversation history.';
  }

  return messages
    .slice(-5) // Last 5 messages for context
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n');
}

/**
 * Format keywords for prompt
 */
export function formatKeywords(keywords: string[]): string {
  if (keywords.length === 0) {
    return 'None identified';
  }
  return keywords.join(', ');
}

/**
 * Format confidence for display
 */
export function formatConfidence(confidence: number): string {
  const percentage = Math.round(confidence * 100);
  if (percentage >= 90) return `${percentage}% (Very High)`;
  if (percentage >= 75) return `${percentage}% (High)`;
  if (percentage >= 60) return `${percentage}% (Moderate)`;
  if (percentage >= 40) return `${percentage}% (Low)`;
  return `${percentage}% (Very Low)`;
}
