/**
 * Query Routes Integration Tests
 */

import request from 'supertest';
import express from 'express';
import sql from 'mssql';
import queryRoutes from '../../src/routes/query.routes';
import { QueryOptimizer } from '../../src/agents/optimizer';
import { getPool } from '../../src/config/database';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/agents/optimizer');
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock json2csv and exceljs
jest.mock('json2csv', () => ({
  Parser: jest.fn().mockImplementation(() => ({
    parse: jest.fn().mockReturnValue('csv,data,here')
  }))
}));

jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    addWorksheet: jest.fn().mockReturnValue({
      columns: [],
      addRows: jest.fn(),
      addRow: jest.fn()
    }),
    xlsx: {
      writeBuffer: jest.fn().mockResolvedValue(Buffer.from('excel data'))
    }
  }))
}));

describe('Query Routes', () => {
  let app: express.Application;
  let mockPool: any;
  let mockRequest: any;
  let mockOptimizer: jest.Mocked<QueryOptimizer>;

  beforeEach(() => {
    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/query', queryRoutes);

    // Setup mock database
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      query: jest.fn(),
      timeout: 30000
    };

    mockPool = {
      request: jest.fn().mockReturnValue(mockRequest)
    };

    (getPool as jest.Mock).mockReturnValue(mockPool);

    // Setup mock optimizer
    mockOptimizer = {
      validate: jest.fn(),
      optimize: jest.fn()
    } as any;

    (QueryOptimizer as jest.MockedClass<typeof QueryOptimizer>).mockImplementation(
      () => mockOptimizer
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/query/execute', () => {
    const validRequest = {
      sql: 'SELECT * FROM loans WHERE amount > 1000000',
      clientId: 'client-123',
      uploadId: 'upload-456',
      options: {
        maxRows: 100,
        format: 'json'
      }
    };

    it('should execute a valid SQL query successfully', async () => {
      const mockResult = {
        recordset: [
          { id: 1, amount: 1500000, status: 'active' },
          { id: 2, amount: 2000000, status: 'active' }
        ]
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      mockRequest.query.mockResolvedValueOnce(mockResult);

      const response = await request(app).post('/api/query/execute').send(validRequest).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: mockResult.recordset
      });

      expect(mockOptimizer.validate).toHaveBeenCalledWith(
        validRequest.sql,
        validRequest.clientId,
        validRequest.uploadId
      );

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('SELECT TOP 100'));
    });

    it('should return cached results on subsequent requests', async () => {
      const mockResult = {
        recordset: [{ id: 1, amount: 1500000 }]
      };

      mockOptimizer.validate.mockResolvedValue({
        isValid: true,
        isSafe: true,
        violations: []
      });

      mockRequest.query.mockResolvedValue(mockResult);

      // First request - should hit database
      const response1 = await request(app)
        .post('/api/query/execute')
        .send(validRequest)
        .expect(200);

      expect(response1.headers['x-cache']).toBe('MISS');

      // Second request - should hit cache
      const response2 = await request(app)
        .post('/api/query/execute')
        .send(validRequest)
        .expect(200);

      expect(response2.headers['x-cache']).toBe('HIT');
      expect(mockRequest.query).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should handle CSV format', async () => {
      const csvRequest = {
        ...validRequest,
        options: {
          ...validRequest.options,
          format: 'csv'
        }
      };

      const mockResult = {
        recordset: [
          { id: 1, amount: 1500000 },
          { id: 2, amount: 2000000 }
        ]
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      mockRequest.query.mockResolvedValueOnce(mockResult);

      const response = await request(app).post('/api/query/execute').send(csvRequest).expect(200);

      expect(response.headers['content-type']).toBe('text/csv');
      expect(response.text).toBe('csv,data,here');
    });

    it('should handle Excel format', async () => {
      const excelRequest = {
        ...validRequest,
        options: {
          ...validRequest.options,
          format: 'excel'
        }
      };

      const mockResult = {
        recordset: [
          { id: 1, amount: 1500000 },
          { id: 2, amount: 2000000 }
        ]
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      mockRequest.query.mockResolvedValueOnce(mockResult);

      const response = await request(app).post('/api/query/execute').send(excelRequest).expect(200);

      expect(response.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    });

    it('should reject invalid SQL', async () => {
      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: false,
        isSafe: false,
        violations: [
          {
            type: 'missing_client_id',
            severity: 'error',
            message: 'Missing required CLIENT_ID filter'
          },
          { type: 'missing_upload_id', severity: 'error', message: 'Invalid table name' }
        ]
      });

      const response = await request(app).post('/api/query/execute').send(validRequest).expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Query Validation Failed',
        details: ['Missing required CLIENT_ID filter', 'Invalid table name'],
        suggestions: ['Add WHERE CLIENT_ID = ? to your query']
      });
    });

    it('should handle SQL execution errors', async () => {
      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      const sqlError = new sql.RequestError('Invalid column name');
      (sqlError as any).code = 'EREQUEST';
      mockRequest.query.mockRejectedValueOnce(sqlError);

      const response = await request(app).post('/api/query/execute').send(validRequest).expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'SQL Execution Error',
        message: 'Invalid column name'
      });
    });

    it('should handle query timeouts', async () => {
      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      const timeoutError = new Error('Query timeout');
      mockRequest.query.mockRejectedValueOnce(timeoutError);

      const response = await request(app).post('/api/query/execute').send(validRequest).expect(408);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Query Timeout',
        message: 'Query execution exceeded the timeout limit'
      });
    });

    it('should validate required fields', async () => {
      const invalidRequest = {
        sql: '' // Empty SQL
        // Missing clientId
      };

      const response = await request(app)
        .post('/api/query/execute')
        .send(invalidRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation Error'
      });
    });

    it('should sanitize dangerous SQL patterns', async () => {
      const dangerousRequest = {
        ...validRequest,
        sql: 'SELECT * FROM loans; DROP TABLE users; --'
      };

      const response = await request(app)
        .post('/api/query/execute')
        .send(dangerousRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'SQL Validation Error',
        message: 'Potentially dangerous SQL pattern detected'
      });
    });

    it('should enforce rate limiting', async () => {
      // Make 30 requests quickly (rate limit is 30 per minute)
      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(request(app).post('/api/query/execute').send(validRequest));
      }

      await Promise.all(promises);

      // 31st request should be rate limited
      const response = await request(app).post('/api/query/execute').send(validRequest).expect(429);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Rate Limit Exceeded'
      });
    });

    it('should add parameters to query', async () => {
      const requestWithParams = {
        ...validRequest,
        parameters: {
          minAmount: 1000000,
          status: 'active'
        }
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: []
      });

      mockRequest.query.mockResolvedValueOnce({ recordset: [] });

      await request(app).post('/api/query/execute').send(requestWithParams).expect(200);

      expect(mockRequest.input).toHaveBeenCalledWith('minAmount', 1000000);
      expect(mockRequest.input).toHaveBeenCalledWith('status', 'active');
    });
  });

  describe('POST /api/query/validate', () => {
    it('should validate SQL query without executing', async () => {
      const validateRequest = {
        sql: 'SELECT * FROM loans',
        clientId: 'client-123',
        uploadId: 'upload-456'
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: true,
        isSafe: true,
        violations: [
          {
            type: 'missing_index',
            severity: 'warning',
            message: 'Consider adding an index on amount column'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query/validate')
        .send(validateRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        isValid: true,
        warnings: ['Consider adding an index on amount column']
      });

      expect(mockRequest.query).not.toHaveBeenCalled();
    });

    it('should return validation errors', async () => {
      const validateRequest = {
        sql: 'SELECT * FROM invalid_table',
        clientId: 'client-123'
      };

      mockOptimizer.validate.mockResolvedValueOnce({
        isValid: false,
        isSafe: false,
        violations: [
          {
            type: 'missing_upload_id',
            severity: 'error',
            message: 'Table invalid_table does not exist'
          }
        ]
      });

      const response = await request(app)
        .post('/api/query/validate')
        .send(validateRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        isValid: false,
        errors: ['Table invalid_table does not exist'],
        suggestions: ['Available tables: loans, customers, transactions']
      });
    });
  });

  describe('POST /api/query/explain', () => {
    it('should return query execution plan', async () => {
      const explainRequest = {
        sql: 'SELECT * FROM loans WHERE amount > 1000000',
        clientId: 'client-123'
      };

      const mockPlan = {
        recordset: [{ StmtText: 'Table Scan on loans' }, { StmtText: 'Filter: amount > 1000000' }]
      };

      mockRequest.query.mockResolvedValueOnce(mockPlan);

      const response = await request(app)
        .post('/api/query/explain')
        .send(explainRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        executionPlan: mockPlan.recordset
      });
    });

    it('should handle explain errors', async () => {
      const explainRequest = {
        sql: 'SELECT * FROM loans',
        clientId: 'client-123'
      };

      mockRequest.query.mockRejectedValueOnce(new Error('Failed to generate plan'));

      const response = await request(app)
        .post('/api/query/explain')
        .send(explainRequest)
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Explain Error'
      });
    });
  });

  describe('GET /api/query/history/:clientId', () => {
    it('should return query history for client', async () => {
      const response = await request(app)
        .get('/api/query/history/client-123')
        .query({ limit: 5, offset: 0 })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        clientId: 'client-123',
        history: expect.any(Array)
      });
    });

    it('should handle pagination', async () => {
      const response = await request(app)
        .get('/api/query/history/client-123')
        .query({ limit: 10, offset: 5 })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        clientId: 'client-123',
        history: expect.any(Array)
      });
    });
  });
});
