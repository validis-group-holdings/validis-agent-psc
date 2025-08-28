import { Router } from 'express';
import { 
  querySafetyCheck, 
  queryValidationAndGovernance, 
  queuedExecution 
} from '@/middleware/safety';

export const queryRouter = Router();

/**
 * Execute a financial data query with full safety protection
 * 
 * POST /api/query
 * Body: {
 *   query: string,
 *   clientId: string,
 *   workflowMode: 'audit' | 'lending',
 *   maxResults?: number,
 *   useCache?: boolean
 * }
 */
queryRouter.post('/', 
  querySafetyCheck,
  queryValidationAndGovernance,
  queuedExecution
);

/**
 * Quick query validation without execution
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