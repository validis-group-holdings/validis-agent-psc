import { Router } from 'express';
import { 
  querySafetyCheck, 
  queryValidationAndGovernance, 
  queuedExecution,
  auditLogger,
  clientRateLimit 
} from '../middleware/safety';
import { QueryAgent, AgentQueryRequest } from '../agents/queryAgent';

export const queryRouter = Router();

// Initialize query agent
const queryAgent = new QueryAgent();

/**
 * Process natural language query using the agent pipeline
 * 
 * POST /api/query
 * Body: {
 *   query: string,
 *   clientId: string,
 *   workflowMode: 'audit' | 'lending',
 *   uploadId?: string,
 *   forceTemplate?: string,
 *   skipParameterExtraction?: boolean,
 *   maxResults?: number
 * }
 */
queryRouter.post('/', 
  auditLogger,
  clientRateLimit,
  async (req, res) => {
    try {
      const request: AgentQueryRequest = {
        query: req.body.query,
        clientId: req.body.clientId,
        workflowMode: req.body.workflowMode,
        uploadId: req.body.uploadId,
        forceTemplate: req.body.forceTemplate,
        skipParameterExtraction: req.body.skipParameterExtraction,
        maxResults: req.body.maxResults
      };

      // Validate request
      const validation = await queryAgent.validateQuery(request);
      if (!validation.isValid) {
        res.status(400).json({
          success: false,
          error: 'Query validation failed',
          issues: validation.issues,
          recommendations: validation.recommendations
        });
        return;
      }

      // Process the query
      const result = await queryAgent.processQuery(request);
      
      // Return result with appropriate status code
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
      
    } catch (error) {
      console.error('Query processing error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        executionTime: 0
      });
    }
  }
);

/**
 * Legacy endpoint: Execute a raw SQL query with full safety protection
 * 
 * POST /api/query/raw
 * Body: {
 *   query: string,
 *   clientId: string,
 *   workflowMode: 'audit' | 'lending',
 *   maxResults?: number,
 *   useCache?: boolean
 * }
 */
queryRouter.post('/raw', 
  querySafetyCheck,
  queryValidationAndGovernance,
  queuedExecution
);

/**
 * Analyze a natural language query without executing it
 * 
 * POST /api/query/analyze
 * Body: {
 *   query: string,
 *   workflowMode: 'audit' | 'lending'
 * }
 */
queryRouter.post('/analyze', 
  auditLogger,
  async (req, res) => {
    try {
      const { query, workflowMode } = req.body;
      
      if (!query || !workflowMode) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: query, workflowMode'
        });
        return;
      }

      const analysis = await queryAgent.analyzeQuery(query, workflowMode);
      
      res.json({
        success: true,
        analysis: {
          intent: {
            intent: analysis.intent.intent,
            confidence: analysis.intent.confidence,
            keywords: analysis.intent.keywords,
            reasoning: analysis.intent.reasoning
          },
          recommendedTemplate: {
            id: analysis.templateRecommendation.selectedTemplate.id,
            name: analysis.templateRecommendation.selectedTemplate.name,
            description: analysis.templateRecommendation.selectedTemplate.description,
            confidence: analysis.templateRecommendation.confidence,
            reasoning: analysis.templateRecommendation.reasoning
          },
          parameterRequirements: {
            extractedParameters: analysis.parameterRequirements.extractedParameters,
            missingRequired: analysis.parameterRequirements.missingRequired,
            suggestions: analysis.parameterRequirements.suggestions
          }
        }
      });
      
    } catch (error) {
      console.error('Query analysis error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed'
      });
    }
  }
);

/**
 * Get query suggestions for partial input
 * 
 * POST /api/query/suggestions
 * Body: {
 *   partialQuery: string,
 *   workflowMode: 'audit' | 'lending'
 * }
 */
queryRouter.post('/suggestions', 
  auditLogger,
  (req, res) => {
    try {
      const { partialQuery, workflowMode } = req.body;
      
      if (!workflowMode) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: workflowMode'
        });
        return;
      }

      const suggestions = queryAgent.getQuerySuggestions(partialQuery || '', workflowMode);
      
      res.json({
        success: true,
        suggestions
      });
      
    } catch (error) {
      console.error('Query suggestions error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Suggestions failed'
      });
    }
  }
);

/**
 * Get available templates for a workflow
 * 
 * GET /api/query/templates/:workflow
 */
queryRouter.get('/templates/:workflow', 
  auditLogger,
  (req, res) => {
    try {
      const workflow = req.params.workflow as 'audit' | 'lending';
      
      if (!['audit', 'lending'].includes(workflow)) {
        res.status(400).json({
          success: false,
          error: 'Workflow must be either "audit" or "lending"'
        });
        return;
      }

      const templates = queryAgent.getAvailableTemplates(workflow);
      
      res.json({
        success: true,
        workflow,
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          description: template.description,
          complexity: template.complexity,
          estimatedRuntime: template.estimatedRuntime,
          parameters: template.parameters,
          tags: template.tags
        })),
        count: templates.length
      });
      
    } catch (error) {
      console.error('Templates error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get templates'
      });
    }
  }
);

/**
 * Quick query validation without execution (legacy endpoint)
 * 
 * POST /api/query/validate
 * Body: {
 *   query: string,
 *   clientId: string,
 *   workflowMode: 'audit' | 'lending'
 * }
 */
queryRouter.post('/validate', 
  querySafetyCheck,
  queryValidationAndGovernance,
  (req, res) => {
    // If we get here, validation passed
    const { validation, governance, costEstimate } = (req as any).safetyValidation;
    
    res.json({
      success: true,
      message: 'Query validation successful',
      validation: {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      },
      governance: {
        modificationsApplied: !!governance.modifiedQuery,
        suggestions: governance.warnings
      },
      costEstimate: {
        riskLevel: costEstimate.riskLevel,
        estimatedTime: costEstimate.estimatedTime,
        estimatedRows: costEstimate.estimatedRows,
        recommendations: costEstimate.recommendations
      }
    });
  }
);