/**
 * Query Execution API Routes
 * Handles direct SQL query execution with validation and formatting
 */

import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import {
  validateQueryExecute,
  QueryExecuteRequest,
  validateSql,
  addRequestId,
  logRequest
} from '../middleware/validation';
import { getPool } from '../config/database';
import { queryRateLimiter, validationRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../config/logger';
import { QueryOptimizer } from '../agents/optimizer';

const router = Router();

// Initialize query optimizer for validation
const optimizer = new QueryOptimizer(process.env.NODE_ENV === 'development');

/**
 * Query result metadata
 */
interface QueryMetadata {
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
  executionTime: number;
  cached: boolean;
}

/**
 * Query result cache entry
 */
interface QueryCacheEntry {
  result: any[];
  metadata: QueryMetadata;
  timestamp: number;
  expiresAt: number;
}

// Simple in-memory cache for query results
const queryCache = new Map<string, QueryCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key for query
 */
function generateCacheKey(sql: string, clientId: string, uploadId?: string): string {
  return `${clientId}:${uploadId || 'latest'}:${sql}`;
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];

  queryCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => queryCache.delete(key));
}

// Periodic cache cleanup
setInterval(cleanExpiredCache, 60000); // Clean every minute

/**
 * POST /api/query/execute
 * Execute a validated/optimized SQL query
 */
router.post(
  '/execute',
  addRequestId,
  logRequest,
  queryRateLimiter, // Add rate limiting
  validateQueryExecute,
  validateSql,
  async (req: Request<{}, {}, QueryExecuteRequest>, res: Response) => {
    const startTime = Date.now();
    const { sql: query, clientId, uploadId, parameters, options } = req.body;
    const requestId = (req as any).id;

    try {
      logger.info('Executing SQL query', {
        requestId,
        clientId,
        uploadId,
        queryLength: query.length,
        format: options?.format || 'json'
      });

      // Check cache first
      const cacheKey = generateCacheKey(query, clientId, uploadId);
      const cachedResult = queryCache.get(cacheKey);

      if (cachedResult && cachedResult.expiresAt > Date.now()) {
        logger.info('Query cache hit', { requestId, cacheKey });

        // Format cached result based on requested format
        const formattedResult = await formatQueryResult(
          cachedResult.result,
          cachedResult.metadata,
          options?.format || 'json'
        );

        return res
          .status(200)
          .header('X-Cache', 'HIT')
          .header('Content-Type', getContentType(options?.format || 'json'))
          .send(formattedResult);
      }

      // Validate query with optimizer
      const validationResult = await optimizer.validate(query, clientId, uploadId);

      if (!validationResult.isValid) {
        logger.warn('Query validation failed', {
          requestId,
          errors: validationResult.errors
        });

        return res.status(400).json({
          success: false,
          requestId,
          error: 'Query Validation Failed',
          details: validationResult.errors,
          suggestions: validationResult.suggestions
        });
      }

      // Execute query
      const pool = getPool();
      const request = pool.request();

      // Add parameters if provided
      if (parameters) {
        Object.entries(parameters).forEach(([name, value]) => {
          request.input(name, value);
        });
      }

      // Set query timeout
      request.timeout = options?.timeout || 30000;

      // Execute with row limit
      const limitedQuery = applyRowLimit(query, options?.maxRows || 5000);

      const queryStartTime = Date.now();
      const result = await request.query(limitedQuery);
      const executionTime = Date.now() - queryStartTime;

      // Build metadata
      const metadata: QueryMetadata = {
        rowCount: result.recordset?.length || 0,
        columnCount: result.recordset?.[0] ? Object.keys(result.recordset[0]).length : 0,
        columns: extractColumnMetadata(result.recordset),
        executionTime,
        cached: false
      };

      // Cache the result
      const cacheEntry: QueryCacheEntry = {
        result: result.recordset || [],
        metadata,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_TTL
      };
      queryCache.set(cacheKey, cacheEntry);

      // Log success
      logger.info('Query executed successfully', {
        requestId,
        rowCount: metadata.rowCount,
        executionTime: `${executionTime}ms`,
        totalTime: `${Date.now() - startTime}ms`
      });

      // Format result based on requested format
      const formattedResult = await formatQueryResult(
        result.recordset || [],
        metadata,
        options?.format || 'json',
        options?.includeMetadata
      );

      // Send response with appropriate content type
      res
        .status(200)
        .header('X-Cache', 'MISS')
        .header('X-Execution-Time', `${executionTime}ms`)
        .header('Content-Type', getContentType(options?.format || 'json'))
        .send(formattedResult);
    } catch (error) {
      logger.error('Query execution error', {
        requestId,
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Handle specific SQL errors
      if (error instanceof sql.RequestError) {
        return res.status(400).json({
          success: false,
          requestId,
          error: 'SQL Execution Error',
          message: error.message,
          code: error.code,
          state: (error as any).state
        });
      }

      // Handle timeout errors
      if (error instanceof Error && error.message.includes('timeout')) {
        return res.status(408).json({
          success: false,
          requestId,
          error: 'Query Timeout',
          message: 'Query execution exceeded the timeout limit',
          timeout: options?.timeout || 30000
        });
      }

      // Generic error response
      res.status(500).json({
        success: false,
        requestId,
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Failed to execute query'
      });
    }
  }
);

/**
 * POST /api/query/validate
 * Validate a SQL query without executing it
 */
router.post(
  '/validate',
  addRequestId,
  logRequest,
  validationRateLimiter, // Add rate limiting
  validateSql,
  async (req: Request, res: Response) => {
    const { sql: query, clientId, uploadId } = req.body;
    const requestId = (req as any).id;

    try {
      logger.info('Validating SQL query', {
        requestId,
        clientId,
        queryLength: query.length
      });

      // Validate with optimizer
      const validationResult = await optimizer.validate(query, clientId, uploadId);

      // Parse the query to extract metadata
      const queryInfo = await analyzer.analyzeQuery(query);

      const errors = validationResult.violations
        .filter((v) => v.severity === 'error')
        .map((v) => v.message);
      const warnings = validationResult.violations
        .filter((v) => v.severity === 'warning')
        .map((v) => v.message);

      res.json({
        success: true,
        requestId,
        isValid: validationResult.isValid,
        errors,
        warnings,
        suggestions: [], // ValidationResult doesn't have suggestions
        queryInfo: {
          tables: queryInfo.tables,
          columns: queryInfo.columns,
          estimatedRows: queryInfo.estimatedRows,
          complexity: queryInfo.complexity
        }
      });
    } catch (error) {
      logger.error('Query validation error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        requestId,
        error: 'Validation Error',
        message: error instanceof Error ? error.message : 'Failed to validate query'
      });
    }
  }
);

/**
 * POST /api/query/explain
 * Get query execution plan
 */
router.post(
  '/explain',
  addRequestId,
  logRequest,
  validationRateLimiter, // Add rate limiting
  validateSql,
  async (req: Request, res: Response) => {
    const { sql: query, clientId } = req.body;
    const requestId = (req as any).id;

    try {
      logger.info('Explaining SQL query', {
        requestId,
        clientId,
        queryLength: query.length
      });

      const pool = getPool();
      const request = pool.request();

      // Get execution plan
      const planQuery = `SET SHOWPLAN_TEXT ON; ${query}; SET SHOWPLAN_TEXT OFF;`;
      const result = await request.query(planQuery);

      res.json({
        success: true,
        requestId,
        executionPlan: result.recordset,
        estimatedCost: calculateEstimatedCost(result.recordset)
      });
    } catch (error) {
      logger.error('Query explain error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        success: false,
        requestId,
        error: 'Explain Error',
        message: error instanceof Error ? error.message : 'Failed to explain query'
      });
    }
  }
);

/**
 * GET /api/query/history
 * Get query execution history for a client
 */
router.get('/history/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const { limit = 10, offset = 0 } = req.query;

  try {
    // This would typically fetch from a query log table
    // For now, return cached queries
    const history: any[] = [];

    queryCache.forEach((entry, key) => {
      if (key.startsWith(clientId)) {
        history.push({
          query: key.split(':').slice(2).join(':'),
          executedAt: new Date(entry.timestamp).toISOString(),
          rowCount: entry.metadata.rowCount,
          executionTime: entry.metadata.executionTime
        });
      }
    });

    res.json({
      success: true,
      clientId,
      history: history.slice(Number(offset), Number(offset) + Number(limit)),
      total: history.length
    });
  } catch (error) {
    logger.error('Query history error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch query history'
    });
  }
});

/**
 * Apply row limit to query
 */
function applyRowLimit(query: string, maxRows: number): string {
  // Check if query already has TOP clause
  if (/^\s*SELECT\s+TOP\s+\d+/i.test(query)) {
    return query;
  }

  // Add TOP clause after SELECT
  return query.replace(/^\s*SELECT\s+/i, `SELECT TOP ${maxRows} `);
}

/**
 * Extract column metadata from result set
 */
function extractColumnMetadata(recordset: any[]): QueryMetadata['columns'] {
  if (!recordset || recordset.length === 0) {
    return [];
  }

  const firstRow = recordset[0];
  return Object.keys(firstRow).map((name) => ({
    name,
    type: typeof firstRow[name],
    nullable: recordset.some((row) => row[name] === null)
  }));
}

/**
 * Format query result based on requested format
 */
async function formatQueryResult(
  data: any[],
  metadata: QueryMetadata,
  format: 'json' | 'csv' | 'excel',
  includeMetadata?: boolean
): Promise<any> {
  switch (format) {
    case 'csv':
      if (data.length === 0) return '';
      const parser = new Parser({ fields: Object.keys(data[0]) });
      return parser.parse(data);

    case 'excel':
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Query Results');

      if (data.length > 0) {
        // Add headers
        worksheet.columns = Object.keys(data[0]).map((key) => ({
          header: key,
          key: key,
          width: 15
        }));

        // Add data
        worksheet.addRows(data);
      }

      // Add metadata sheet if requested
      if (includeMetadata) {
        const metaSheet = workbook.addWorksheet('Metadata');
        metaSheet.addRow(['Property', 'Value']);
        metaSheet.addRow(['Row Count', metadata.rowCount]);
        metaSheet.addRow(['Column Count', metadata.columnCount]);
        metaSheet.addRow(['Execution Time (ms)', metadata.executionTime]);
        metaSheet.addRow(['Cached', metadata.cached]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;

    case 'json':
    default:
      if (includeMetadata) {
        return {
          success: true,
          data,
          metadata
        };
      }
      return {
        success: true,
        data
      };
  }
}

/**
 * Get content type for response format
 */
function getContentType(format: string): string {
  switch (format) {
    case 'csv':
      return 'text/csv';
    case 'excel':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'json':
    default:
      return 'application/json';
  }
}

/**
 * Calculate estimated cost from execution plan
 */
function calculateEstimatedCost(plan: any[]): number {
  // This is a simplified cost calculation
  // In reality, you'd parse the execution plan XML
  return plan.length * 0.1;
}

/**
 * Simple query analyzer
 */
const analyzer = {
  async analyzeQuery(query: string) {
    // Extract tables
    const tableMatches = query.match(/FROM\s+(\w+)/gi) || [];
    const tables = tableMatches.map((match) => match.replace(/FROM\s+/i, ''));

    // Extract columns
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/is);
    const columns = selectMatch ? selectMatch[1].split(',').map((col) => col.trim()) : [];

    // Estimate complexity
    const joins = (query.match(/JOIN/gi) || []).length;
    const wheres = (query.match(/WHERE|AND|OR/gi) || []).length;
    const complexity = joins * 2 + wheres;

    return {
      tables,
      columns,
      estimatedRows: 1000, // Would need actual statistics
      complexity: complexity < 5 ? 'simple' : complexity < 10 ? 'moderate' : 'complex'
    };
  }
};

export default router;
