import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger';
import databaseContextManager from '../services/database-context';

const router = Router();

// Cache configuration
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let schemaCache: {
  data: any;
  timestamp: number;
} | null = null;

// Validation schemas
const getSchemaQuerySchema = z.object({
  tables: z.string().optional(), // Comma-separated list of table names
  includeRelationships: z.coerce.boolean().optional().default(true),
  includeBusinessRules: z.coerce.boolean().optional().default(false),
  format: z.enum(['full', 'summary', 'names']).optional().default('summary')
});

const getTableSchemaSchema = z.object({
  tableName: z.string().min(1)
});

/**
 * Helper function to check and return cached schema if valid
 */
function getCachedSchema(): any | null {
  if (!schemaCache) return null;

  const now = Date.now();
  if (now - schemaCache.timestamp > SCHEMA_CACHE_TTL) {
    schemaCache = null;
    return null;
  }

  return schemaCache.data;
}

/**
 * Helper function to set schema cache
 */
function setCachedSchema(data: any): void {
  schemaCache = {
    data,
    timestamp: Date.now()
  };
}

/**
 * GET /api/schema
 * Get database schema information with caching
 */
router.get('/', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Validate query parameters
    const validatedQuery = getSchemaQuerySchema.parse(req.query);

    // Check cache first (only for summary format without specific tables)
    if (!validatedQuery.tables && validatedQuery.format === 'summary') {
      const cached = getCachedSchema();
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true,
          requestId: req.id
        });
      }
    }

    // Ensure database context is initialized
    if (!databaseContextManager.isReady()) {
      await databaseContextManager.initialize();
    }

    const schema = databaseContextManager.getSchema();
    if (!schema) {
      return res.status(503).json({
        success: false,
        error: 'Schema not available. Database context not initialized.',
        requestId: req.id
      });
    }

    // Filter tables if specified
    let tables = Array.from(schema.tables.entries());
    if (validatedQuery.tables) {
      const requestedTables = validatedQuery.tables.split(',').map((t) => t.trim().toLowerCase());
      tables = tables.filter(([name]) => requestedTables.includes(name.toLowerCase()));
    }

    // Format response based on requested format
    let responseData: any;

    switch (validatedQuery.format) {
      case 'names':
        responseData = {
          tables: tables.map(([name]) => name),
          count: tables.length
        };
        break;

      case 'summary':
        responseData = {
          tables: tables.map(([name, table]) => ({
            name,
            columns: Array.from(table.columns.entries()).map(([colName, col]) => ({
              name: colName,
              type: col.dataType,
              nullable: col.isNullable,
              isPrimary: col.isPrimaryKey,
              isForeign: col.isForeignKey
            })),
            recordCount: table.rowCount,
            indexes: table.indexes
          })),
          relationships: validatedQuery.includeRelationships ? schema.relationships : undefined,
          count: tables.length,
          version: schema.version,
          loadedAt: schema.loadedAt
        };
        break;

      case 'full':
        const context = databaseContextManager.getContext();
        responseData = {
          tables: tables.map(([name, table]) => ({
            name,
            schema: table,
            context: context ? context.tables[name] : null
          })),
          relationships: validatedQuery.includeRelationships ? schema.relationships : undefined,
          businessRules: validatedQuery.includeBusinessRules
            ? databaseContextManager.getBusinessRules()
            : undefined,
          count: tables.length,
          version: schema.version,
          loadedAt: schema.loadedAt
        };
        break;
    }

    // Cache the response if it's a default request
    if (!validatedQuery.tables && validatedQuery.format === 'summary') {
      setCachedSchema(responseData);
    }

    res.json({
      success: true,
      data: responseData,
      cached: false,
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

    logger.error('Error fetching schema:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schema',
      requestId: req.id
    });
  }
});

/**
 * GET /api/schema/table/:tableName
 * Get schema for a specific table
 */
router.get('/table/:tableName', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Validate path parameter
    const { tableName } = getTableSchemaSchema.parse(req.params);

    // Ensure database context is initialized
    if (!databaseContextManager.isReady()) {
      await databaseContextManager.initialize();
    }

    const schema = databaseContextManager.getSchema();
    if (!schema) {
      return res.status(503).json({
        success: false,
        error: 'Schema not available. Database context not initialized.',
        requestId: req.id
      });
    }

    // Find the table (case-insensitive)
    const tableEntry = Array.from(schema.tables.entries()).find(
      ([name]) => name.toLowerCase() === tableName.toLowerCase()
    );

    if (!tableEntry) {
      return res.status(404).json({
        success: false,
        error: `Table '${tableName}' not found in schema`,
        requestId: req.id
      });
    }

    const [actualTableName, tableSchema] = tableEntry;
    const context = databaseContextManager.getTableContext(actualTableName);

    res.json({
      success: true,
      data: {
        name: actualTableName,
        columns: Array.from(tableSchema.columns.entries()).map(([name, col]) => ({
          name,
          type: col.dataType,
          maxLength: col.maxLength,
          precision: col.precision,
          scale: col.scale,
          nullable: col.isNullable,
          defaultValue: col.defaultValue,
          isPrimary: col.isPrimaryKey,
          isForeign: col.isForeignKey
        })),
        indexes: tableSchema.indexes,
        rowCount: tableSchema.rowCount,
        context: context || null,
        relationships: schema.relationships.filter(
          (rel) => rel.parentTable === actualTableName || rel.childTable === actualTableName
        )
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

    logger.error(`Error fetching schema for table ${req.params.tableName}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch table schema',
      requestId: req.id
    });
  }
});

/**
 * GET /api/schema/relationships
 * Get all table relationships
 */
router.get('/relationships', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Ensure database context is initialized
    if (!databaseContextManager.isReady()) {
      await databaseContextManager.initialize();
    }

    const schema = databaseContextManager.getSchema();
    if (!schema) {
      return res.status(503).json({
        success: false,
        error: 'Schema not available. Database context not initialized.',
        requestId: req.id
      });
    }

    res.json({
      success: true,
      data: {
        relationships: schema.relationships,
        count: schema.relationships.length
      },
      requestId: req.id
    });
  } catch (error) {
    logger.error('Error fetching relationships:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch relationships',
      requestId: req.id
    });
  }
});

/**
 * POST /api/schema/refresh
 * Force refresh of the schema cache
 */
router.post('/refresh', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Clear cache
    schemaCache = null;

    // Refresh the database context
    await databaseContextManager.refresh();

    const schema = databaseContextManager.getSchema();
    if (!schema) {
      return res.status(503).json({
        success: false,
        error: 'Failed to refresh schema',
        requestId: req.id
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Schema refreshed successfully',
        tableCount: schema.tables.size,
        relationshipCount: schema.relationships.length,
        version: schema.version,
        loadedAt: schema.loadedAt
      },
      requestId: req.id
    });
  } catch (error) {
    logger.error('Error refreshing schema:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh schema',
      requestId: req.id
    });
  }
});

/**
 * GET /api/schema/context
 * Get the full database context for AI agent consumption
 */
router.get('/context', async (req: Request, res: Response) => {
  try {
    // Ensure database context is initialized
    if (!databaseContextManager.isReady()) {
      await databaseContextManager.initialize();
    }

    const agentContext = databaseContextManager.getAgentContext();

    res.json({
      success: true,
      data: agentContext,
      requestId: req.id
    });
  } catch (error) {
    logger.error('Error fetching agent context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch database context',
      requestId: req.id
    });
  }
});

export default router;
