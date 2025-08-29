import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLangChainModel } from '../config/langchain';
import { QueryTemplate, QueryParameter } from '../templates/common/types';

export interface ParameterExtractionResult {
  extractedParameters: Record<string, any>;
  missingRequired: string[];
  confidence: number;
  suggestions: string[];
  reasoning: string;
}

export class ParameterExtractor {
  private model: ChatAnthropic;

  constructor() {
    this.model = getLangChainModel();
  }

  async extractParameters(
    query: string,
    template: QueryTemplate
  ): Promise<ParameterExtractionResult> {
    const requiredParams = template.parameters.filter(p => p.required);
    const optionalParams = template.parameters.filter(p => !p.required);
    
    const systemPrompt = `You are a parameter extraction specialist for financial data queries. Your job is to extract parameter values from natural language queries based on a specific template's requirements.

Template: ${template.name}
Description: ${template.description}

Required Parameters:
${requiredParams.map(p => `- ${p.name} (${p.type}): ${p.description || 'No description'}`).join('\n')}

Optional Parameters:
${optionalParams.map(p => `- ${p.name} (${p.type}): ${p.description || 'No description'} (default: ${p.defaultValue || 'none'})`).join('\n')}

IMPORTANT RULES:
1. Extract parameter values from the user's natural language query
2. Convert values to the correct data types (string, number, date, boolean)
3. For dates, use ISO format (YYYY-MM-DD) or relative terms like "last_month", "ytd"
4. For numbers, extract exact values or reasonable defaults
5. For boolean, infer from context (presence/absence of conditions)
6. Return only valid JSON in the exact format specified
7. If a required parameter cannot be determined, mark it as missing
8. Provide suggestions for missing parameters

Response Format (JSON only):
{
  "extractedParameters": {
    "param1": "value1",
    "param2": 123,
    "param3": "2024-01-01"
  },
  "missingRequired": ["param_name"],
  "confidence": 0.85,
  "suggestions": ["Please specify the date range for analysis"],
  "reasoning": "Brief explanation of parameter extraction"
}`;

    const humanPrompt = `User Query: "${query}"

Extract parameters for the "${template.name}" template. What values can you identify from this query?`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt)
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;
      
      // Parse JSON response
      const result = JSON.parse(content.trim());
      
      // Validate and type-cast the result
      const validatedResult = this.validateAndTypecast(result, template);
      
      return validatedResult;
    } catch (error) {
      console.error('Parameter extraction error:', error);
      
      // Fallback extraction
      return this.getFallbackExtraction(query, template);
    }
  }

  private validateAndTypecast(
    result: any, 
    template: QueryTemplate
  ): ParameterExtractionResult {
    // Validate structure
    const required = ['extractedParameters', 'missingRequired', 'confidence', 'suggestions', 'reasoning'];
    const missing = required.filter(field => !(field in result));
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // Type cast parameters
    const typedParameters: Record<string, any> = {};
    
    for (const [paramName, paramValue] of Object.entries(result.extractedParameters || {})) {
      const paramDef = template.parameters.find(p => p.name === paramName);
      
      if (!paramDef) {
        continue; // Skip unknown parameters
      }
      
      try {
        typedParameters[paramName] = this.castParameterValue(paramValue, paramDef);
      } catch (castError) {
        console.warn(`Failed to cast parameter ${paramName}:`, castError);
        // Remove invalid parameter
      }
    }

    // Check for missing required parameters
    const requiredParams = template.parameters.filter(p => p.required);
    const actualMissing = requiredParams
      .filter(p => !(p.name in typedParameters))
      .map(p => p.name);

    return {
      extractedParameters: typedParameters,
      missingRequired: actualMissing,
      confidence: Math.min(Math.max(result.confidence || 0, 0), 1),
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      reasoning: result.reasoning || 'Parameter extraction completed'
    };
  }

  private castParameterValue(value: any, paramDef: QueryParameter): any {
    if (value === null || value === undefined) {
      if (paramDef.defaultValue !== undefined) {
        return paramDef.defaultValue;
      }
      throw new Error(`No value provided for parameter ${paramDef.name}`);
    }

    switch (paramDef.type) {
      case 'string':
        return String(value);
        
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new Error(`Invalid number: ${value}`);
        }
        return num;
        
      case 'boolean':
        if (typeof value === 'boolean') return value;
        const str = String(value).toLowerCase();
        if (['true', 'yes', '1', 'on', 'enabled'].includes(str)) return true;
        if (['false', 'no', '0', 'off', 'disabled'].includes(str)) return false;
        throw new Error(`Invalid boolean: ${value}`);
        
      case 'date':
        if (typeof value === 'string') {
          // Handle relative dates
          if (value === 'today') return new Date().toISOString().split('T')[0];
          if (value === 'yesterday') {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            return date.toISOString().split('T')[0];
          }
          if (value === 'last_month') {
            const date = new Date();
            date.setMonth(date.getMonth() - 1);
            return date.toISOString().split('T')[0];
          }
          if (value === 'ytd') {
            return `${new Date().getFullYear()}-01-01`;
          }
          
          // Try to parse as ISO date
          const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}$/);
          if (dateMatch) {
            return value;
          }
          
          // Try to parse natural language date
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
          }
        }
        
        if (value instanceof Date) {
          return value.toISOString().split('T')[0];
        }
        
        throw new Error(`Invalid date: ${value}`);
        
      default:
        return value;
    }
  }

  private getFallbackExtraction(
    query: string,
    template: QueryTemplate
  ): ParameterExtractionResult {
    const queryLower = query.toLowerCase();
    const extractedParameters: Record<string, any> = {};
    const suggestions: string[] = [];

    // Simple pattern matching for common parameters
    for (const param of template.parameters) {
      try {
        const value = this.extractParameterByPattern(queryLower, param);
        if (value !== null) {
          extractedParameters[param.name] = value;
        } else if (param.defaultValue !== undefined) {
          extractedParameters[param.name] = param.defaultValue;
        }
      } catch (error) {
        console.warn(`Fallback extraction failed for ${param.name}:`, error);
      }
    }

    // Find missing required parameters
    const requiredParams = template.parameters.filter(p => p.required);
    const missingRequired = requiredParams
      .filter(p => !(p.name in extractedParameters))
      .map(p => p.name);

    // Generate suggestions for missing parameters
    for (const paramName of missingRequired) {
      const param = template.parameters.find(p => p.name === paramName);
      if (param) {
        suggestions.push(`Please specify ${param.name} (${param.type}): ${param.description || 'Required parameter'}`);
      }
    }

    return {
      extractedParameters,
      missingRequired,
      confidence: 0.3, // Low confidence for fallback
      suggestions,
      reasoning: 'Fallback parameter extraction using pattern matching'
    };
  }

  private extractParameterByPattern(query: string, param: QueryParameter): any {
    const name = param.name.toLowerCase();
    
    switch (param.type) {
      case 'number':
        // Look for numbers near parameter name or common financial terms
        if (name.includes('threshold') || name.includes('amount') || name.includes('limit')) {
          const match = query.match(/(\d+(?:\.\d+)?)/);
          return match ? parseFloat(match[1]) : null;
        }
        break;
        
      case 'date':
        // Look for date patterns
        const datePattern = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{4})|(\d{1,2}-\d{1,2}-\d{4})/;
        const dateMatch = query.match(datePattern);
        if (dateMatch) {
          const dateStr = dateMatch[0];
          try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return date.toISOString().split('T')[0];
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        // Check for relative dates
        if (query.includes('last month')) return 'last_month';
        if (query.includes('this year') || query.includes('ytd')) return 'ytd';
        if (query.includes('today')) return 'today';
        break;
        
      case 'boolean':
        // Look for boolean indicators
        if (query.includes('include') && name.includes('include')) return true;
        if (query.includes('exclude') && name.includes('include')) return false;
        if (query.includes('with') && name.includes('include')) return true;
        if (query.includes('without') && name.includes('include')) return false;
        break;
        
      case 'string':
        // For string parameters, check for quoted values or common patterns
        if (name.includes('account') && query.includes('account')) {
          const accountMatch = query.match(/account[:\s]+([a-zA-Z0-9\s]+)/i);
          if (accountMatch) return accountMatch[1].trim();
        }
        break;
    }
    
    return null;
  }

  /**
   * Validate that all required parameters are present
   */
  validateRequiredParameters(
    parameters: Record<string, any>,
    template: QueryTemplate
  ): { isValid: boolean; missing: string[] } {
    const requiredParams = template.parameters.filter(p => p.required);
    const missing = requiredParams
      .filter(p => !(p.name in parameters) || parameters[p.name] === null || parameters[p.name] === undefined)
      .map(p => p.name);
    
    return {
      isValid: missing.length === 0,
      missing
    };
  }

  /**
   * Apply default values for missing optional parameters
   */
  applyDefaults(
    parameters: Record<string, any>,
    template: QueryTemplate
  ): Record<string, any> {
    const result = { ...parameters };
    
    for (const param of template.parameters) {
      if (!(param.name in result) && param.defaultValue !== undefined) {
        result[param.name] = param.defaultValue;
      }
    }
    
    return result;
  }
}