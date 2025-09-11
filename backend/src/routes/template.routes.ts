import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger';
import { getTemplateService } from '../services/template.service';

const router = Router();

// Validation schemas
const getTemplatesQuerySchema = z.object({
  category: z.enum(['lending', 'audit', 'all']).optional().default('all'),
  search: z.string().optional(),
  limit: z.coerce.number().positive().max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0)
});

const getTemplateByIdSchema = z.object({
  id: z.string().min(1)
});

/**
 * GET /api/templates
 * Get all available query templates with optional filtering
 */
router.get('/', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Validate query parameters
    const validatedQuery = getTemplatesQuerySchema.parse(req.query);

    // Get template service
    const templateService = getTemplateService();

    // Get templates based on filters
    const templates = await templateService.getTemplates({
      category: validatedQuery.category === 'all' ? undefined : validatedQuery.category,
      search: validatedQuery.search,
      limit: validatedQuery.limit,
      offset: validatedQuery.offset
    });

    // Calculate pagination info
    const totalCount = await templateService.getTemplateCount({
      category: validatedQuery.category === 'all' ? undefined : validatedQuery.category,
      search: validatedQuery.search
    });

    res.json({
      success: true,
      data: {
        templates,
        pagination: {
          total: totalCount,
          limit: validatedQuery.limit,
          offset: validatedQuery.offset,
          hasMore: validatedQuery.offset + templates.length < totalCount
        },
        categories: {
          lending: templates.filter((t) => t.category === 'lending').length,
          audit: templates.filter((t) => t.category === 'audit').length
        }
      },
      requestId: req.id
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.errors,
        requestId: req.id
      });
    }

    logger.error('Error fetching templates:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch templates',
      requestId: req.id
    });
  }
});

/**
 * GET /api/templates/:id
 * Get a specific template by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Validate path parameter
    const { id } = getTemplateByIdSchema.parse(req.params);

    // Get template service
    const templateService = getTemplateService();

    // Get template by ID
    const template = await templateService.getTemplateById(id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found',
        requestId: req.id
      });
    }

    res.json({
      success: true,
      data: template,
      requestId: req.id
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.errors,
        requestId: req.id
      });
    }

    logger.error(`Error fetching template ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch template',
      requestId: req.id
    });
  }
});

/**
 * GET /api/templates/categories
 * Get available template categories with counts
 */
router.get('/meta/categories', async (req: Request, res: Response) => {
  try {
    // Get template service
    const templateService = getTemplateService();

    // Get category information
    const categories = await templateService.getCategories();

    res.json({
      success: true,
      data: categories,
      requestId: req.id
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      requestId: req.id
    });
  }
});

/**
 * GET /api/templates/tables/:tableName
 * Get templates that involve a specific table
 */
router.get('/tables/:tableName', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { tableName } = req.params;

    if (!tableName) {
      return res.status(400).json({
        success: false,
        error: 'Table name is required',
        requestId: req.id
      });
    }

    // Get template service
    const templateService = getTemplateService();

    // Get templates for the table
    const templates = await templateService.getTemplatesForTable(tableName);

    res.json({
      success: true,
      data: {
        tableName,
        templates,
        count: templates.length
      },
      requestId: req.id
    });
  } catch (error) {
    logger.error(`Error fetching templates for table ${req.params.tableName}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch templates for table',
      requestId: req.id
    });
  }
});

export default router;
