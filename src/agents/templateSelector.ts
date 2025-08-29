import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLangChainModel } from '../config/langchain';
import { QueryTemplate } from '../templates/common/types';
import { getTemplateById, getTemplatesByWorkflow } from '../templates';
import { IntentClassificationResult } from './intentClassifier';

export interface TemplateSelectionResult {
  selectedTemplate: QueryTemplate;
  confidence: number;
  reasoning: string;
  alternatives: QueryTemplate[];
  matchScore: number;
}

export interface TemplateMatchCriteria {
  intent: string;
  workflow: 'audit' | 'lending';
  keywords: string[];
  suggestedTemplates?: string[];
  query: string;
}

export class TemplateSelector {
  private model: ChatAnthropic;

  constructor() {
    this.model = getLangChainModel();
  }

  async selectTemplate(
    criteria: TemplateMatchCriteria,
    intentResult?: IntentClassificationResult
  ): Promise<TemplateSelectionResult> {
    // Get candidate templates
    const candidates = this.getCandidateTemplates(criteria, intentResult);
    
    if (candidates.length === 0) {
      throw new Error(`No templates found for workflow: ${criteria.workflow}`);
    }

    if (candidates.length === 1) {
      // Single candidate, return it with high confidence
      return {
        selectedTemplate: candidates[0],
        confidence: 0.9,
        reasoning: 'Only one template matched the criteria',
        alternatives: [],
        matchScore: 1.0
      };
    }

    // Multiple candidates, use LLM for selection
    return await this.selectFromCandidates(criteria, candidates);
  }

  private getCandidateTemplates(
    criteria: TemplateMatchCriteria,
    intentResult?: IntentClassificationResult
  ): QueryTemplate[] {
    let candidates: QueryTemplate[] = [];

    // Start with workflow-specific templates
    const workflowTemplates = getTemplatesByWorkflow(criteria.workflow);

    // If we have suggested templates from intent classification, prioritize those
    if (intentResult?.suggestedTemplates?.length) {
      candidates = intentResult.suggestedTemplates
        .map(id => getTemplateById(id))
        .filter((template): template is QueryTemplate => template !== undefined);
    }

    // If we have direct template suggestions in criteria
    if (criteria.suggestedTemplates?.length) {
      const suggested = criteria.suggestedTemplates
        .map(id => getTemplateById(id))
        .filter((template): template is QueryTemplate => template !== undefined);
      
      candidates = [...candidates, ...suggested];
    }

    // If no candidates yet, fall back to keyword matching
    if (candidates.length === 0) {
      candidates = this.findTemplatesByKeywords(criteria.keywords, workflowTemplates);
    }

    // Remove duplicates
    const uniqueCandidates = candidates.filter((template, index, self) => 
      self.findIndex(t => t.id === template.id) === index
    );

    // If still no candidates, return all workflow templates as fallback
    return uniqueCandidates.length > 0 ? uniqueCandidates : workflowTemplates.slice(0, 5);
  }

  private findTemplatesByKeywords(
    keywords: string[],
    templates: QueryTemplate[]
  ): QueryTemplate[] {
    if (keywords.length === 0) return templates.slice(0, 3);

    const scored = templates.map(template => {
      const templateText = `${template.name} ${template.description} ${template.tags?.join(' ') || ''}`.toLowerCase();
      
      let score = 0;
      for (const keyword of keywords) {
        const keywordLower = keyword.toLowerCase();
        if (templateText.includes(keywordLower)) {
          // Boost score for exact matches in name
          if (template.name.toLowerCase().includes(keywordLower)) {
            score += 3;
          }
          // Boost score for matches in description
          else if (template.description.toLowerCase().includes(keywordLower)) {
            score += 2;
          }
          // Regular score for tag matches
          else {
            score += 1;
          }
        }
      }
      
      return { template, score };
    });

    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.template);
  }

  private async selectFromCandidates(
    criteria: TemplateMatchCriteria,
    candidates: QueryTemplate[]
  ): Promise<TemplateSelectionResult> {
    const candidateDescriptions = candidates.map((template, index) => 
      `${index + 1}. ${template.id} - ${template.name}
         Description: ${template.description}
         Complexity: ${template.complexity}
         Parameters: ${template.parameters.map(p => `${p.name}(${p.type}${p.required ? ',required' : ''})`).join(', ')}
         Tags: ${template.tags?.join(', ') || 'none'}`
    ).join('\n\n');

    const systemPrompt = `You are a template selection expert for financial data analysis. Your job is to select the most appropriate template from a list of candidates based on the user's query and analysis intent.

User Query: "${criteria.query}"
Intent: ${criteria.intent}
Workflow: ${criteria.workflow.toUpperCase()}
Keywords: ${criteria.keywords.join(', ')}

Template Candidates:
${candidateDescriptions}

IMPORTANT RULES:
1. Select the template that best matches the user's analytical intent
2. Consider the complexity of the user's request vs template complexity
3. Prefer templates with fewer required parameters for simple queries
4. Consider whether the user has provided enough information for complex templates
5. Return only valid JSON in the exact format specified
6. Match score should reflect how well the template fits (0.0-1.0)

Response Format (JSON only):
{
  "selectedTemplateId": "template_id",
  "confidence": 0.85,
  "reasoning": "Clear explanation of why this template was selected",
  "matchScore": 0.9,
  "alternativeIds": ["alt_template_1", "alt_template_2"]
}`;

    const humanPrompt = `Based on the user's query "${criteria.query}", which template would be most appropriate for their ${criteria.workflow} analysis? Consider their intent: ${criteria.intent}`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt)
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;
      
      // Parse JSON response
      const result = JSON.parse(content.trim());
      
      // Validate and build result
      return this.buildSelectionResult(result, candidates);
    } catch (error) {
      console.error('Template selection error:', error);
      
      // Fallback to first candidate
      return {
        selectedTemplate: candidates[0],
        confidence: 0.5,
        reasoning: 'Fallback selection due to LLM error',
        alternatives: candidates.slice(1, 3),
        matchScore: 0.5
      };
    }
  }

  private buildSelectionResult(
    llmResult: any,
    candidates: QueryTemplate[]
  ): TemplateSelectionResult {
    // Find selected template
    const selectedTemplate = candidates.find(t => t.id === llmResult.selectedTemplateId);
    if (!selectedTemplate) {
      throw new Error(`Selected template not found: ${llmResult.selectedTemplateId}`);
    }

    // Find alternatives
    const alternatives = (llmResult.alternativeIds || [])
      .map((id: string) => candidates.find(t => t.id === id))
      .filter((template: QueryTemplate | undefined): template is QueryTemplate => template !== undefined)
      .slice(0, 2);

    return {
      selectedTemplate,
      confidence: Math.min(Math.max(llmResult.confidence || 0.5, 0), 1),
      reasoning: llmResult.reasoning || 'Template selected by LLM',
      alternatives,
      matchScore: Math.min(Math.max(llmResult.matchScore || 0.5, 0), 1)
    };
  }

  /**
   * Simple template selection based on intent and keywords (no LLM)
   */
  selectTemplateSimple(criteria: TemplateMatchCriteria): TemplateSelectionResult {
    const candidates = this.getCandidateTemplates(criteria);
    
    if (candidates.length === 0) {
      throw new Error(`No templates found for workflow: ${criteria.workflow}`);
    }

    // Score candidates based on keyword matches
    const scored = candidates.map(template => {
      let score = 0;
      const templateText = `${template.name} ${template.description} ${template.tags?.join(' ') || ''}`.toLowerCase();
      
      for (const keyword of criteria.keywords) {
        const keywordLower = keyword.toLowerCase();
        if (templateText.includes(keywordLower)) {
          if (template.name.toLowerCase().includes(keywordLower)) {
            score += 3;
          } else if (template.description.toLowerCase().includes(keywordLower)) {
            score += 2;
          } else {
            score += 1;
          }
        }
      }
      
      // Boost score for intent matches
      const intentLower = criteria.intent.toLowerCase();
      if (templateText.includes(intentLower)) {
        score += 2;
      }
      
      return { template, score };
    });

    // Sort by score and return the best match
    scored.sort((a, b) => b.score - a.score);
    
    const best = scored[0];
    const maxPossibleScore = criteria.keywords.length * 3 + 2; // Max keywords score + intent score
    const normalizedScore = maxPossibleScore > 0 ? best.score / maxPossibleScore : 0.5;
    
    return {
      selectedTemplate: best.template,
      confidence: Math.min(normalizedScore + 0.3, 1.0), // Add base confidence
      reasoning: `Selected based on keyword matching (score: ${best.score})`,
      alternatives: scored.slice(1, 3).map(s => s.template),
      matchScore: normalizedScore
    };
  }

  /**
   * Get template by exact ID with validation
   */
  getTemplateById(templateId: string): QueryTemplate | null {
    return getTemplateById(templateId) || null;
  }

  /**
   * Validate that a template is suitable for the given criteria
   */
  validateTemplateSelection(
    template: QueryTemplate,
    criteria: TemplateMatchCriteria
  ): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check workflow match
    if (template.workflow !== criteria.workflow) {
      issues.push(`Template workflow (${template.workflow}) does not match required workflow (${criteria.workflow})`);
    }

    // Check if template has too many required parameters for a simple query
    const requiredParams = template.parameters.filter(p => p.required);
    const queryWordCount = criteria.query.split(/\s+/).length;
    
    if (requiredParams.length > 3 && queryWordCount < 10) {
      issues.push(`Template requires ${requiredParams.length} parameters but query appears simple`);
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }
}