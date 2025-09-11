import request from 'supertest';
import express, { Express } from 'express';
import schemaRoutes from '../../src/routes/schema.routes';
import databaseContextManager from '../../src/services/database-context';

// Mock the database context manager
jest.mock('../../src/services/database-context');
jest.mock('../../src/config/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Schema Routes', () => {
  let app: Express;
  let mockDatabaseContextManager: any;

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Add request ID middleware
    app.use((req, _res, next) => {
      req.id = 'test-request-id';
      next();
    });

    app.use('/api/schema', schemaRoutes);

    // Setup mock database context manager
    mockDatabaseContextManager = databaseContextManager as jest.Mocked<
      typeof databaseContextManager
    >;
    mockDatabaseContextManager.isReady = jest.fn();
    mockDatabaseContextManager.initialize = jest.fn();
    mockDatabaseContextManager.getSchema = jest.fn();
    mockDatabaseContextManager.getContext = jest.fn();
    mockDatabaseContextManager.getTableContext = jest.fn();
    mockDatabaseContextManager.getBusinessRules = jest.fn();
    mockDatabaseContextManager.getAgentContext = jest.fn();
    mockDatabaseContextManager.refresh = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/schema', () => {
    const mockSchema = {
      tables: new Map([
        [
          'saleHeader',
          {
            columns: new Map([
              [
                'invoice_id',
                { dataType: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }
              ],
              [
                'customer_name',
                { dataType: 'varchar', isNullable: true, isPrimaryKey: false, isForeignKey: false }
              ]
            ]),
            indexes: ['IX_invoice_date'],
            estimatedRowCount: 10000
          }
        ],
        [
          'purchaseHeader',
          {
            columns: new Map([
              [
                'purchase_id',
                { dataType: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }
              ],
              [
                'supplier_name',
                { dataType: 'varchar', isNullable: true, isPrimaryKey: false, isForeignKey: false }
              ]
            ]),
            indexes: ['IX_purchase_date'],
            estimatedRowCount: 5000
          }
        ]
      ]),
      relationships: [{ parentTable: 'saleHeader', childTable: 'customer', type: 'many-to-one' }],
      version: '1.0.0',
      loadedAt: new Date('2024-01-01')
    };

    it('should return schema summary by default', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);

      const response = await request(app).get('/api/schema').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('tables');
      expect(response.body.data.tables).toHaveLength(2);
      expect(response.body.data.count).toBe(2);
      expect(response.body.data.version).toBe('1.0.0');
      expect(response.body.cached).toBe(false);
    });

    it('should filter tables when specified', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);

      const response = await request(app)
        .get('/api/schema')
        .query({ tables: 'saleHeader' })
        .expect(200);

      expect(response.body.data.tables).toHaveLength(1);
      expect(response.body.data.tables[0].name).toBe('saleHeader');
    });

    it('should return only table names when format=names', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);

      const response = await request(app).get('/api/schema').query({ format: 'names' }).expect(200);

      expect(response.body.data).toEqual({
        tables: ['saleHeader', 'purchaseHeader'],
        count: 2
      });
    });

    it('should return full schema when format=full', async () => {
      const mockContext = {
        tables: {
          saleHeader: { description: 'Sales header table' },
          purchaseHeader: { description: 'Purchase header table' }
        }
      };

      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);
      mockDatabaseContextManager.getContext.mockReturnValue(mockContext);
      mockDatabaseContextManager.getBusinessRules.mockReturnValue([]);

      const response = await request(app)
        .get('/api/schema')
        .query({ format: 'full', includeBusinessRules: true })
        .expect(200);

      expect(response.body.data).toHaveProperty('businessRules');
      expect(response.body.data.tables[0]).toHaveProperty('context');
    });

    it('should initialize database context if not ready', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(false);
      mockDatabaseContextManager.initialize.mockResolvedValue(undefined);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);

      await request(app).get('/api/schema').expect(200);

      expect(mockDatabaseContextManager.initialize).toHaveBeenCalled();
    });

    it('should return 503 when schema is not available', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(null);

      const response = await request(app).get('/api/schema').expect(503);

      expect(response.body).toEqual({
        success: false,
        error: 'Schema not available. Database context not initialized.',
        requestId: 'test-request-id'
      });
    });

    it('should handle invalid query parameters', async () => {
      const response = await request(app)
        .get('/api/schema')
        .query({ format: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Validation Error');
    });
  });

  describe('GET /api/schema/table/:tableName', () => {
    const mockSchema = {
      tables: new Map([
        [
          'saleHeader',
          {
            columns: new Map([
              [
                'invoice_id',
                {
                  dataType: 'int',
                  maxLength: null,
                  precision: 10,
                  scale: 0,
                  isNullable: false,
                  defaultValue: null,
                  isPrimaryKey: true,
                  isForeignKey: false,
                  isUnique: true,
                  referencedTable: null,
                  referencedColumn: null
                }
              ]
            ]),
            indexes: ['IX_invoice_date'],
            constraints: ['PK_saleHeader'],
            estimatedRowCount: 10000
          }
        ]
      ]),
      relationships: [{ fromTable: 'saleHeader', toTable: 'customer', type: 'many-to-one' }]
    };

    it('should return schema for a specific table', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);
      mockDatabaseContextManager.getTableContext.mockReturnValue({
        description: 'Sales header context'
      });

      const response = await request(app).get('/api/schema/table/saleHeader').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('saleHeader');
      expect(response.body.data.columns).toHaveLength(1);
      expect(response.body.data.context).toEqual({ description: 'Sales header context' });
      expect(response.body.data.relationships).toHaveLength(1);
    });

    it('should handle case-insensitive table names', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);
      mockDatabaseContextManager.getTableContext.mockReturnValue({});

      const response = await request(app).get('/api/schema/table/SALEHEADER').expect(200);

      expect(response.body.data.name).toBe('saleHeader');
    });

    it('should return 404 for non-existent table', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(mockSchema);

      const response = await request(app).get('/api/schema/table/nonExistentTable').expect(404);

      expect(response.body).toEqual({
        success: false,
        error: "Table 'nonExistentTable' not found in schema",
        requestId: 'test-request-id'
      });
    });

    it('should handle service errors', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app).get('/api/schema/table/saleHeader').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch table schema',
        requestId: 'test-request-id'
      });
    });
  });

  describe('GET /api/schema/relationships', () => {
    it('should return all table relationships', async () => {
      const mockRelationships = [
        { fromTable: 'saleHeader', toTable: 'customer', type: 'many-to-one' },
        { fromTable: 'purchaseHeader', toTable: 'supplier', type: 'many-to-one' }
      ];

      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue({
        relationships: mockRelationships
      });

      const response = await request(app).get('/api/schema/relationships').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          relationships: mockRelationships,
          count: 2
        },
        requestId: 'test-request-id'
      });
    });

    it('should return 503 when schema is not available', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getSchema.mockReturnValue(null);

      const response = await request(app).get('/api/schema/relationships').expect(503);

      expect(response.body.error).toBe('Schema not available. Database context not initialized.');
    });
  });

  describe('POST /api/schema/refresh', () => {
    it('should refresh the schema successfully', async () => {
      const refreshedSchema = {
        tables: new Map(),
        relationships: [],
        version: '1.0.1',
        loadedAt: new Date()
      };

      mockDatabaseContextManager.refresh.mockResolvedValue(undefined);
      mockDatabaseContextManager.getSchema.mockReturnValue(refreshedSchema);

      const response = await request(app).post('/api/schema/refresh').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          message: 'Schema refreshed successfully',
          tableCount: 0,
          relationshipCount: 0,
          version: '1.0.1',
          loadedAt: refreshedSchema.loadedAt.toISOString()
        },
        requestId: 'test-request-id'
      });

      expect(mockDatabaseContextManager.refresh).toHaveBeenCalled();
    });

    it('should return 503 when refresh fails', async () => {
      mockDatabaseContextManager.refresh.mockResolvedValue(undefined);
      mockDatabaseContextManager.getSchema.mockReturnValue(null);

      const response = await request(app).post('/api/schema/refresh').expect(503);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to refresh schema',
        requestId: 'test-request-id'
      });
    });

    it('should handle refresh errors', async () => {
      mockDatabaseContextManager.refresh.mockRejectedValue(new Error('Refresh failed'));

      const response = await request(app).post('/api/schema/refresh').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to refresh schema',
        requestId: 'test-request-id'
      });
    });
  });

  describe('GET /api/schema/context', () => {
    it('should return agent context', async () => {
      const mockAgentContext = {
        overview: 'Database overview',
        criticalNotes: ['Note 1', 'Note 2'],
        tableCount: 10,
        businessRules: 5,
        queryTemplates: {
          lending: 8,
          audit: 8
        },
        bestPractices: ['Practice 1'],
        lastUpdated: new Date()
      };

      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getAgentContext.mockReturnValue(mockAgentContext);

      const response = await request(app).get('/api/schema/context').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.requestId).toBe('test-request-id');
      expect(response.body.data).toMatchObject({
        overview: mockAgentContext.overview,
        criticalNotes: mockAgentContext.criticalNotes,
        tableCount: mockAgentContext.tableCount,
        businessRules: mockAgentContext.businessRules,
        queryTemplates: mockAgentContext.queryTemplates,
        bestPractices: mockAgentContext.bestPractices
      });
      // Check lastUpdated separately as it's serialized to string
      expect(response.body.data.lastUpdated).toBeDefined();
    });

    it('should initialize context if not ready', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(false);
      mockDatabaseContextManager.initialize.mockResolvedValue(undefined);
      mockDatabaseContextManager.getAgentContext.mockReturnValue({});

      await request(app).get('/api/schema/context').expect(200);

      expect(mockDatabaseContextManager.initialize).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockDatabaseContextManager.isReady.mockReturnValue(true);
      mockDatabaseContextManager.getAgentContext.mockImplementation(() => {
        throw new Error('Context error');
      });

      const response = await request(app).get('/api/schema/context').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch database context',
        requestId: 'test-request-id'
      });
    });
  });
});
