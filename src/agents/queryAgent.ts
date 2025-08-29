import { IntentClassifier, IntentClassificationResult } from './intentClassifier';
import { ParameterExtractor, ParameterExtractionResult } from './parameterExtractor';
import { TemplateSelector, TemplateSelectionResult, TemplateMatchCriteria } from './templateSelector';
import { QueryTemplate, ExecutionContext, TemplateExecutionResult } from '../templates/common/types';
import { executeTemplate } from '../templates/executor';
import { QueryValidator } from '../safety/validator';
import { QueryGovernor } from '../safety/governor';
import { QueryCostEstimator } from '../safety/estimator';
import { getTemplatesByWorkflow } from '../templates';
import { SessionContext } from '../modes/types';
import { sessionManager } from '../session/manager';
import { modeManager } from '../modes';

export interface AgentQueryRequest {
  query: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
  uploadId?: string;
  sessionId?: string;
  forceTemplate?: string;
  skipParameterExtraction?: boolean;
  maxResults?: number;
}

export interface AgentQueryResponse {
  success: boolean;
  queryId?: string;
  sessionId?: string;
  data?: any[];
  template?: {
    id: string;
    name: string;
    description: string;
  };
  parameters?: Record<string, any>;
  analysis?: {
    intent: IntentClassificationResult;
    templateSelection: TemplateSelectionResult;
    parameterExtraction: ParameterExtractionResult;
  };
  safety?: {
    validation: any;
    governance: any;
    costEstimate: any;
  };
  mode?: {
    current: 'audit' | 'lending';
    constraints: any;
    appliedFilters: string[];
    recommendations: string[];
  };
  session?: {
    context: Partial<SessionContext>;
    stats: any;
  };
  error?: string;
  warnings?: string[];
  executionTime?: number;
  metadata?: {
    rowCount: number;
    processingSteps: string[];
    confidence: number;
  };
}

export class QueryAgent {
  private intentClassifier: IntentClassifier;
  private parameterExtractor: ParameterExtractor;
  private templateSelector: TemplateSelector;

  constructor() {
    this.intentClassifier = new IntentClassifier();
    this.parameterExtractor = new ParameterExtractor();
    this.templateSelector = new TemplateSelector();
  }

  /**
   * Process a natural language query through the complete agent pipeline
   */
  async processQuery(request: AgentQueryRequest): Promise<AgentQueryResponse> {
    const startTime = Date.now();
    const processingSteps: string[] = [];
    const warnings: string[] = [];
    let sessionContext: SessionContext | null = null;

    try {
      processingSteps.push('Starting query processing');

      // Step 0: Session Management
      processingSteps.push('Managing session context');
      if (request.sessionId) {
        sessionContext = await sessionManager.getSession(request.sessionId);
        if (!sessionContext) {
          return {
            success: false,
            error: 'Session not found or expired',
            warnings: ['Please start a new session'],
            executionTime: Date.now() - startTime,
            metadata: {
              rowCount: 0,
              processingSteps,
              confidence: 0
            }
          };
        }
      } else {
        // Create new session
        sessionContext = await sessionManager.createSession(
          request.clientId,
          request.workflowMode,
          request.uploadId
        );
      }

      // Apply mode constraints to query before processing
      processingSteps.push('Applying mode constraints');
      const constraintApplication = await sessionManager.applySessionConstraints(
        sessionContext.sessionId,
        request.query
      );

      if (constraintApplication.errors.length > 0) {
        return {
          success: false,
          sessionId: sessionContext.sessionId,
          error: 'Query violates mode constraints',
          warnings: constraintApplication.modification?.warnings || [],
          mode: {
            current: sessionContext.mode,
            constraints: modeManager.getModeConstraints(sessionContext.mode),
            appliedFilters: [],
            recommendations: await sessionManager.getSessionRecommendations(sessionContext.sessionId)
          },
          executionTime: Date.now() - startTime,
          metadata: {
            rowCount: 0,
            processingSteps,
            confidence: 0
          }
        };
      }

      const constrainedQuery = constraintApplication.modification.modifiedQuery;
      const appliedConstraints = constraintApplication.modification.appliedConstraints;

      // Step 1: Intent Classification
      processingSteps.push('Analyzing query intent');
      const intentResult = await this.intentClassifier.classifyIntent(
        constrainedQuery,
        request.workflowMode
      );

      if (intentResult.confidence < 0.5) {
        warnings.push('Low confidence in intent classification');
      }

      // Step 2: Template Selection
      processingSteps.push('Selecting appropriate template');
      let templateResult: TemplateSelectionResult;
      
      if (request.forceTemplate) {
        // Use forced template
        const forcedTemplate = this.templateSelector.getTemplateById(request.forceTemplate);
        if (!forcedTemplate) {
          throw new Error(`Forced template not found: ${request.forceTemplate}`);
        }
        templateResult = {
          selectedTemplate: forcedTemplate,
          confidence: 1.0,
          reasoning: 'Template forced by user',
          alternatives: [],
          matchScore: 1.0
        };
      } else {
        // Select template based on intent
        const criteria: TemplateMatchCriteria = {
          intent: intentResult.intent,
          workflow: request.workflowMode,
          keywords: intentResult.keywords,
          suggestedTemplates: intentResult.suggestedTemplates,
          query: request.query
        };
        
        templateResult = await this.templateSelector.selectTemplate(criteria, intentResult);
      }

      if (templateResult.confidence < 0.6) {
        warnings.push('Moderate confidence in template selection');
      }

      // Step 3: Parameter Extraction
      processingSteps.push('Extracting query parameters');
      let parameterResult: ParameterExtractionResult;
      
      if (request.skipParameterExtraction) {
        parameterResult = {
          extractedParameters: {},
          missingRequired: [],
          confidence: 1.0,
          suggestions: [],
          reasoning: 'Parameter extraction skipped by user'
        };
      } else {
        parameterResult = await this.parameterExtractor.extractParameters(
          request.query,
          templateResult.selectedTemplate
        );
      }

      // Check for missing required parameters
      if (parameterResult.missingRequired.length > 0) {
        return {
          success: false,
          error: 'Missing required parameters',
          analysis: {
            intent: intentResult,
            templateSelection: templateResult,
            parameterExtraction: parameterResult
          },
          warnings: [
            ...warnings,
            ...parameterResult.suggestions
          ],
          template: {
            id: templateResult.selectedTemplate.id,
            name: templateResult.selectedTemplate.name,
            description: templateResult.selectedTemplate.description
          },
          executionTime: Date.now() - startTime,
          metadata: {
            rowCount: 0,
            processingSteps,
            confidence: Math.min(intentResult.confidence, templateResult.confidence, parameterResult.confidence)
          }
        };
      }

      // Step 4: Safety Validation
      processingSteps.push('Performing safety validation');
      const template = templateResult.selectedTemplate;
      const parameters = this.parameterExtractor.applyDefaults(
        parameterResult.extractedParameters,
        template
      );

      // Create execution context
      const executionContext: ExecutionContext = {
        clientId: request.clientId,
        uploadId: request.uploadId,
        parameters
      };

      // Validate with safety layer
      const validation = await QueryValidator.validate(
        template.sql,
        request.clientId,
        request.workflowMode
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: 'Query failed safety validation',
          template: {
            id: template.id,
            name: template.name,
            description: template.description
          },
          parameters,
          safety: { 
            validation, 
            governance: { isValid: true, warnings: [] }, 
            costEstimate: { riskLevel: 'unknown' } 
          },
          warnings: [...warnings, ...validation.warnings],
          executionTime: Date.now() - startTime,
          metadata: {
            rowCount: 0,
            processingSteps,
            confidence: Math.min(intentResult.confidence, templateResult.confidence, parameterResult.confidence)
          }
        };
      }

      // Apply governance
      const governance = QueryGovernor.adaptiveGovernance(
        template.sql,
        'medium', // Load level - could be dynamic
        request.clientId,
        request.workflowMode
      );

      if (!governance.isValid) {
        return {
          success: false,
          error: 'Query blocked by governance policies',
          template: {
            id: template.id,
            name: template.name,
            description: template.description
          },
          parameters,
          safety: { 
            validation, 
            governance, 
            costEstimate: { riskLevel: 'unknown' } 
          },
          warnings: [...warnings, ...governance.warnings],
          executionTime: Date.now() - startTime,
          metadata: {
            rowCount: 0,
            processingSteps,
            confidence: Math.min(intentResult.confidence, templateResult.confidence, parameterResult.confidence)
          }
        };
      }

      // Cost estimation
      const costEstimate = await QueryCostEstimator.estimate(
        governance.modifiedQuery || template.sql
      );

      // Step 5: Execute Template
      processingSteps.push('Executing query template');
      const executionResult = await executeTemplate(template, executionContext);

      if (!executionResult.success) {
        return {
          success: false,
          error: executionResult.error || 'Template execution failed',
          template: {
            id: template.id,
            name: template.name,
            description: template.description
          },
          parameters,
          safety: { validation, governance, costEstimate },
          analysis: {
            intent: intentResult,
            templateSelection: templateResult,
            parameterExtraction: parameterResult
          },
          warnings: [...warnings, `Execution failed after ${executionResult.executionTime}ms`],
          executionTime: Date.now() - startTime,
          metadata: {
            rowCount: 0,
            processingSteps,
            confidence: Math.min(intentResult.confidence, templateResult.confidence, parameterResult.confidence)
          }
        };
      }

      processingSteps.push('Query processing completed successfully');

      // Successful execution
      return {
        success: true,
        queryId: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId: sessionContext.sessionId,
        data: executionResult.data,
        template: {
          id: template.id,
          name: template.name,
          description: template.description
        },
        parameters,
        safety: { validation, governance, costEstimate },
        mode: {
          current: sessionContext.mode,
          constraints: modeManager.getModeConstraints(sessionContext.mode),
          appliedFilters: appliedConstraints,
          recommendations: await sessionManager.getSessionRecommendations(sessionContext.sessionId)
        },
        session: {
          context: {
            sessionId: sessionContext.sessionId,
            clientId: sessionContext.clientId,
            mode: sessionContext.mode,
            currentUploadId: sessionContext.currentUploadId,
            companyContext: sessionContext.companyContext,
            portfolioContext: sessionContext.portfolioContext
          },
          stats: modeManager.getSessionStats(sessionContext)
        },
        analysis: {
          intent: intentResult,
          templateSelection: templateResult,
          parameterExtraction: parameterResult
        },
        warnings: [...warnings, ...constraintApplication.modification.warnings],
        executionTime: Date.now() - startTime,
        metadata: {
          rowCount: executionResult.rowCount || 0,
          processingSteps,
          confidence: Math.min(intentResult.confidence, templateResult.confidence, parameterResult.confidence)
        }
      };

    } catch (error) {
      console.error('Query agent processing error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown processing error',
        warnings: [...warnings, 'Processing failed due to unexpected error'],
        executionTime: Date.now() - startTime,
        metadata: {
          rowCount: 0,
          processingSteps,
          confidence: 0
        }
      };
    }
  }

  /**
   * Analyze a query without executing it
   */
  async analyzeQuery(
    query: string,
    workflowMode: 'audit' | 'lending'
  ): Promise<{
    intent: IntentClassificationResult;
    templateRecommendation: TemplateSelectionResult;
    parameterRequirements: ParameterExtractionResult;
  }> {
    // Step 1: Intent Classification
    const intentResult = await this.intentClassifier.classifyIntent(query, workflowMode);

    // Step 2: Template Selection
    const criteria: TemplateMatchCriteria = {
      intent: intentResult.intent,
      workflow: workflowMode,
      keywords: intentResult.keywords,
      suggestedTemplates: intentResult.suggestedTemplates,
      query
    };
    
    const templateResult = await this.templateSelector.selectTemplate(criteria, intentResult);

    // Step 3: Parameter Analysis
    const parameterResult = await this.parameterExtractor.extractParameters(
      query,
      templateResult.selectedTemplate
    );

    return {
      intent: intentResult,
      templateRecommendation: templateResult,
      parameterRequirements: parameterResult
    };
  }

  /**
   * Get available templates for a workflow
   */
  getAvailableTemplates(workflow: 'audit' | 'lending'): QueryTemplate[] {
    const criteria: TemplateMatchCriteria = { 
      intent: '', 
      workflow, 
      keywords: [], 
      query: '' 
    };
    // Return workflow templates directly
    return getTemplatesByWorkflow(workflow);
  }

  /**
   * Validate a query without processing
   */
  async validateQuery(request: AgentQueryRequest): Promise<{
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Basic validation
      if (!request.query.trim()) {
        issues.push('Query cannot be empty');
      }

      if (!request.clientId) {
        issues.push('Client ID is required');
      }

      if (!['audit', 'lending'].includes(request.workflowMode)) {
        issues.push('Workflow mode must be either "audit" or "lending"');
      }

      if (request.query.length > 1000) {
        recommendations.push('Consider breaking down very long queries into smaller parts');
      }

      // Safety validation if query is present
      if (request.query.trim()) {
        const validation = await QueryValidator.validate(
          request.query,
          request.clientId,
          request.workflowMode
        );

        if (!validation.isValid) {
          issues.push(...validation.errors);
        }

        recommendations.push(...validation.warnings);
      }

    } catch (error) {
      issues.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      isValid: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Get query suggestions based on partial input
   */
  getQuerySuggestions(
    partialQuery: string,
    workflowMode: 'audit' | 'lending'
  ): string[] {
    const suggestions: string[] = [];
    const queryLower = partialQuery.toLowerCase();

    // Common audit suggestions
    if (workflowMode === 'audit') {
      if (queryLower.includes('journal')) {
        suggestions.push('Show me journal entries over $10,000 this month');
        suggestions.push('Find journal entries with round amounts');
      }
      if (queryLower.includes('transaction')) {
        suggestions.push('Show me weekend transactions');
        suggestions.push('Find transactions after business hours');
      }
      if (queryLower.includes('vendor')) {
        suggestions.push('Show me large vendor payments');
        suggestions.push('Find duplicate vendor payments');
      }
    }

    // Common lending suggestions
    if (workflowMode === 'lending') {
      if (queryLower.includes('cash')) {
        suggestions.push('Analyze cash flow patterns');
        suggestions.push('Show me daily cash position');
      }
      if (queryLower.includes('ratio')) {
        suggestions.push('Calculate profitability ratios');
        suggestions.push('Show me debt-to-equity ratios');
      }
      if (queryLower.includes('revenue')) {
        suggestions.push('Analyze revenue growth trends');
        suggestions.push('Show me seasonal revenue patterns');
      }
    }

    return suggestions.slice(0, 5);
  }
}