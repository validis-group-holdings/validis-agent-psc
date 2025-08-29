import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLangChainModel } from '../config/langchain';
import { ALL_TEMPLATES, getTemplatesByWorkflow } from '../templates';

export interface IntentClassificationResult {
  intent: string;
  confidence: number;
  workflow: 'audit' | 'lending';
  suggestedTemplates: string[];
  reasoning: string;
  keywords: string[];
}

export class IntentClassifier {
  private model: ChatAnthropic;
  private auditIntents: string[];
  private lendingIntents: string[];

  constructor() {
    this.model = getLangChainModel();
    
    // Extract common intents from templates
    this.auditIntents = [
      'journal_analysis', 'timing_analysis', 'user_activity', 
      'balance_reconciliation', 'period_end_analysis', 'pattern_detection',
      'vendor_analysis', 'customer_analysis', 'expense_analysis', 
      'compliance_check', 'fraud_detection', 'audit_trail'
    ];
    
    this.lendingIntents = [
      'cash_flow_analysis', 'revenue_analysis', 'debt_analysis',
      'working_capital', 'financial_ratios', 'risk_assessment',
      'covenant_monitoring', 'liquidity_analysis', 'profitability',
      'credit_scoring', 'portfolio_analysis', 'benchmarking'
    ];
  }

  async classifyIntent(
    query: string, 
    workflow: 'audit' | 'lending'
  ): Promise<IntentClassificationResult> {
    const availableTemplates = getTemplatesByWorkflow(workflow);
    const templateDescriptions = availableTemplates.map(t => 
      `${t.id}: ${t.name} - ${t.description}`
    ).join('\n');
    
    const relevantIntents = workflow === 'audit' ? this.auditIntents : this.lendingIntents;

    const systemPrompt = `You are a financial data analysis intent classifier. Your job is to understand what the user wants to analyze from their natural language query and map it to the most appropriate financial analysis template.

Workflow: ${workflow.toUpperCase()}
Available Intents: ${relevantIntents.join(', ')}

Available Templates:
${templateDescriptions}

IMPORTANT RULES:
1. Return only valid JSON in the exact format specified
2. Choose the intent that best matches the user's analytical goal
3. Confidence should be 0.0-1.0 (1.0 = perfect match)
4. Suggest 1-3 most relevant template IDs
5. Extract key financial terms and concepts as keywords
6. Provide clear reasoning for your classification

Response Format (JSON only):
{
  "intent": "most_relevant_intent",
  "confidence": 0.85,
  "workflow": "${workflow}",
  "suggestedTemplates": ["template_id_1", "template_id_2"],
  "reasoning": "Brief explanation of why this intent was chosen",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;

    const humanPrompt = `User Query: "${query}"

Analyze this query and classify the financial analysis intent. What kind of analysis does the user want to perform?`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt)
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;
      
      // Parse JSON response
      const result = JSON.parse(content.trim());
      
      // Validate the result
      this.validateResult(result, workflow);
      
      return result;
    } catch (error) {
      console.error('Intent classification error:', error);
      
      // Fallback classification
      return this.getFallbackClassification(query, workflow);
    }
  }

  private validateResult(result: any, workflow: 'audit' | 'lending'): void {
    const required = ['intent', 'confidence', 'workflow', 'suggestedTemplates', 'reasoning', 'keywords'];
    const missing = required.filter(field => !(field in result));
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    
    if (result.workflow !== workflow) {
      throw new Error(`Workflow mismatch: expected ${workflow}, got ${result.workflow}`);
    }
    
    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
      throw new Error('Confidence must be a number between 0 and 1');
    }
    
    if (!Array.isArray(result.suggestedTemplates) || result.suggestedTemplates.length === 0) {
      throw new Error('suggestedTemplates must be a non-empty array');
    }
    
    if (!Array.isArray(result.keywords)) {
      throw new Error('keywords must be an array');
    }
  }

  private getFallbackClassification(
    query: string, 
    workflow: 'audit' | 'lending'
  ): IntentClassificationResult {
    const queryLower = query.toLowerCase();
    const templates = getTemplatesByWorkflow(workflow);
    
    // Simple keyword-based fallback
    let bestTemplate = templates[0];
    let bestScore = 0;
    
    for (const template of templates) {
      let score = 0;
      const templateText = `${template.name} ${template.description}`.toLowerCase();
      
      // Count matching words
      const queryWords = queryLower.split(/\s+/);
      for (const word of queryWords) {
        if (word.length > 3 && templateText.includes(word)) {
          score += 1;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestTemplate = template;
      }
    }
    
    // Extract keywords from query
    const keywords = queryLower
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'from', 'they', 'have', 'been', 'will', 'what', 'when', 'where'].includes(word))
      .slice(0, 5);
    
    return {
      intent: workflow === 'audit' ? 'general_audit' : 'general_lending',
      confidence: Math.min(bestScore / queryLower.split(/\s+/).length, 0.8),
      workflow,
      suggestedTemplates: [bestTemplate.id],
      reasoning: 'Fallback classification based on keyword matching',
      keywords
    };
  }

  /**
   * Get all possible intents for a workflow
   */
  getAvailableIntents(workflow: 'audit' | 'lending'): string[] {
    return workflow === 'audit' ? [...this.auditIntents] : [...this.lendingIntents];
  }

  /**
   * Get template suggestions based on keywords
   */
  getTemplatesByKeywords(keywords: string[], workflow: 'audit' | 'lending'): string[] {
    const templates = getTemplatesByWorkflow(workflow);
    const scored = templates.map(template => {
      const templateText = `${template.name} ${template.description} ${template.tags?.join(' ') || ''}`.toLowerCase();
      const score = keywords.reduce((acc, keyword) => {
        return acc + (templateText.includes(keyword.toLowerCase()) ? 1 : 0);
      }, 0);
      
      return { template, score };
    });
    
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => item.template.id);
  }
}