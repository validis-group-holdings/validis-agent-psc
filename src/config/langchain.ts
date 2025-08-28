import { ChatAnthropic } from '@langchain/anthropic';
import { config } from './index';

let chatModel: ChatAnthropic | null = null;

export function initializeLangChain(): ChatAnthropic {
  if (!chatModel) {
    chatModel = new ChatAnthropic({
      apiKey: config.anthropic.apiKey,
      model: config.anthropic.model,
      temperature: 0.1,
      maxTokens: 4000,
    });
  }
  
  return chatModel;
}

export function getLangChainModel(): ChatAnthropic {
  if (!chatModel) {
    throw new Error('LangChain model not initialized. Call initializeLangChain() first.');
  }
  
  return chatModel;
}

// Utility function to create structured prompts for financial queries
export function createFinancialQueryPrompt(
  query: string,
  clientId: string,
  workflowMode: 'audit' | 'lending',
  availableTables: string[]
): string {
  return `
You are a financial data analyst assistant that helps generate SQL queries for ${workflowMode} workflows.

Context:
- Client ID: ${clientId}
- Workflow Mode: ${workflowMode}
- Available Upload Tables: ${availableTables.join(', ')}

IMPORTANT RULES:
1. ALL queries MUST use the upload table pattern for data access
2. Always include CLIENT_ID filtering for security scoping
3. For audit workflow: Focus on company-specific analysis
4. For lending workflow: Enable portfolio-wide analysis
5. Only query tables that exist in the available tables list

User Query: ${query}

Generate a SQL query that follows the upload table pattern and includes proper CLIENT_ID scoping.
Respond with just the SQL query, no additional text.
`;
}