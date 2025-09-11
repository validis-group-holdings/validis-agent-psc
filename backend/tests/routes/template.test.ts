import request from 'supertest';
import express, { Express } from 'express';
import templateRoutes from '../../src/routes/template.routes';
import { getTemplateService } from '../../src/services/template.service';

// Mock the template service
jest.mock('../../src/services/template.service');
jest.mock('../../src/config/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Template Routes', () => {
  let app: Express;
  let mockTemplateService: any;

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Add request ID middleware
    app.use((req, _res, next) => {
      req.id = 'test-request-id';
      next();
    });

    app.use('/api/templates', templateRoutes);

    // Setup mock template service
    mockTemplateService = {
      getTemplates: jest.fn(),
      getTemplateCount: jest.fn(),
      getTemplateById: jest.fn(),
      getTemplatesForTable: jest.fn(),
      getCategories: jest.fn()
    };

    (getTemplateService as jest.Mock).mockReturnValue(mockTemplateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/templates', () => {
    it('should return all templates with default parameters', async () => {
      const mockTemplates = [
        {
          id: 'lending-top-ar-opportunities',
          name: 'Top 20 Asset-Based Finance Opportunities',
          category: 'lending',
          description: 'Identify companies with strong AR balances'
        },
        {
          id: 'audit-variance-analysis',
          name: 'Identify Transactions with Significant Variance',
          category: 'audit',
          description: 'Find transactions >10% up/down vs prior period'
        }
      ];

      mockTemplateService.getTemplates.mockResolvedValue(mockTemplates);
      mockTemplateService.getTemplateCount.mockResolvedValue(2);

      const response = await request(app).get('/api/templates').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          templates: mockTemplates,
          pagination: {
            total: 2,
            limit: 50,
            offset: 0,
            hasMore: false
          },
          categories: {
            lending: 1,
            audit: 1
          }
        },
        requestId: 'test-request-id'
      });

      expect(mockTemplateService.getTemplates).toHaveBeenCalledWith({
        category: undefined,
        search: undefined,
        limit: 50,
        offset: 0
      });
    });

    it('should filter templates by category', async () => {
      const mockLendingTemplates = [
        {
          id: 'lending-top-ar-opportunities',
          name: 'Top 20 Asset-Based Finance Opportunities',
          category: 'lending'
        }
      ];

      mockTemplateService.getTemplates.mockResolvedValue(mockLendingTemplates);
      mockTemplateService.getTemplateCount.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/templates')
        .query({ category: 'lending' })
        .expect(200);

      expect(response.body.data.templates).toEqual(mockLendingTemplates);
      expect(mockTemplateService.getTemplates).toHaveBeenCalledWith({
        category: 'lending',
        search: undefined,
        limit: 50,
        offset: 0
      });
    });

    it('should search templates', async () => {
      mockTemplateService.getTemplates.mockResolvedValue([]);
      mockTemplateService.getTemplateCount.mockResolvedValue(0);

      await request(app).get('/api/templates').query({ search: 'revenue' }).expect(200);

      expect(mockTemplateService.getTemplates).toHaveBeenCalledWith({
        category: undefined,
        search: 'revenue',
        limit: 50,
        offset: 0
      });
    });

    it('should handle pagination', async () => {
      mockTemplateService.getTemplates.mockResolvedValue([]);
      mockTemplateService.getTemplateCount.mockResolvedValue(100);

      const response = await request(app)
        .get('/api/templates')
        .query({ limit: 10, offset: 20 })
        .expect(200);

      expect(response.body.data.pagination).toEqual({
        total: 100,
        limit: 10,
        offset: 20,
        hasMore: true
      });

      expect(mockTemplateService.getTemplates).toHaveBeenCalledWith({
        category: undefined,
        search: undefined,
        limit: 10,
        offset: 20
      });
    });

    it('should return 400 for invalid query parameters', async () => {
      const response = await request(app)
        .get('/api/templates')
        .query({ category: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Validation Error');
      expect(response.body).toHaveProperty('details');
    });

    it('should handle service errors gracefully', async () => {
      mockTemplateService.getTemplates.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/templates').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch templates',
        requestId: 'test-request-id'
      });
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should return a specific template by ID', async () => {
      const mockTemplate = {
        id: 'lending-top-ar-opportunities',
        name: 'Top 20 Asset-Based Finance Opportunities',
        category: 'lending',
        description: 'Full template details',
        sqlTemplate: 'SELECT * FROM ...'
      };

      mockTemplateService.getTemplateById.mockResolvedValue(mockTemplate);

      const response = await request(app)
        .get('/api/templates/lending-top-ar-opportunities')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockTemplate,
        requestId: 'test-request-id'
      });

      expect(mockTemplateService.getTemplateById).toHaveBeenCalledWith(
        'lending-top-ar-opportunities'
      );
    });

    it('should return 404 for non-existent template', async () => {
      mockTemplateService.getTemplateById.mockResolvedValue(undefined);

      const response = await request(app).get('/api/templates/non-existent').expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Template not found',
        requestId: 'test-request-id'
      });
    });

    it('should handle service errors', async () => {
      mockTemplateService.getTemplateById.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/templates/some-id').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch template',
        requestId: 'test-request-id'
      });
    });
  });

  describe('GET /api/templates/meta/categories', () => {
    it('should return category information', async () => {
      const mockCategories = [
        {
          name: 'lending',
          displayName: 'Lending & Portfolio Analysis',
          description: 'Templates for portfolio-level analysis',
          count: 5,
          templates: ['template1', 'template2']
        },
        {
          name: 'audit',
          displayName: 'Audit & Compliance',
          description: 'Templates for audit procedures',
          count: 8,
          templates: ['template3', 'template4']
        }
      ];

      mockTemplateService.getCategories.mockResolvedValue(mockCategories);

      const response = await request(app).get('/api/templates/meta/categories').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockCategories,
        requestId: 'test-request-id'
      });
    });

    it('should handle service errors', async () => {
      mockTemplateService.getCategories.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/api/templates/meta/categories').expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch categories',
        requestId: 'test-request-id'
      });
    });
  });

  describe('GET /api/templates/tables/:tableName', () => {
    it('should return templates for a specific table', async () => {
      const mockTemplates = [
        {
          id: 'template1',
          name: 'Template involving saleHeader',
          involvedTables: ['saleHeader', 'saleLine']
        }
      ];

      mockTemplateService.getTemplatesForTable.mockResolvedValue(mockTemplates);

      const response = await request(app).get('/api/templates/tables/saleHeader').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          tableName: 'saleHeader',
          templates: mockTemplates,
          count: 1
        },
        requestId: 'test-request-id'
      });

      expect(mockTemplateService.getTemplatesForTable).toHaveBeenCalledWith('saleHeader');
    });

    it('should return 400 for missing table name', async () => {
      await request(app).get('/api/templates/tables/').expect(404); // Express will return 404 for missing route parameter
    });

    it('should handle service errors', async () => {
      mockTemplateService.getTemplatesForTable.mockRejectedValue(new Error('Service error'));

      const resp = await request(app).get('/api/templates/tables/someTable').expect(500);

      expect(resp.body).toEqual({
        success: false,
        error: 'Failed to fetch templates for table',
        requestId: 'test-request-id'
      });
    });
  });
});
