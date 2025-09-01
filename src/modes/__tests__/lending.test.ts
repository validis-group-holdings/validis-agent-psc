/**
 * Lending Mode Strategy Tests
 */

// Don't use the mocked version for these tests
jest.unmock('../index');
jest.unmock('../lending');

import { LendingModeStrategy } from '../lending';
import { ModeContext, WorkflowMode } from '../types';
import * as uploadHelpers from '../../db/uploadTableHelpers';

// Mock the upload table helpers
jest.mock('../../db/uploadTableHelpers', () => ({
  getUploadTableInfo: jest.fn()
}));

const mockGetUploadTableInfo = uploadHelpers.getUploadTableInfo as jest.MockedFunction<typeof uploadHelpers.getUploadTableInfo>;

describe('LendingModeStrategy', () => {
  let lendingMode: LendingModeStrategy;
  let mockContext: ModeContext;

  beforeEach(() => {
    lendingMode = new LendingModeStrategy();
    mockContext = {
      clientId: 'test-client-123',
      uploadId: 'upload_test_202401',
      sessionId: 'session_123',
      mode: 'lending' as WorkflowMode,
      lockedAt: new Date()
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Default mock implementation with multiple active uploads
    mockGetUploadTableInfo.mockResolvedValue([
      {
        tableName: 'upload_company_a_202401',
        clientId: 'test-client-123',
        uploadDate: new Date('2024-01-15'),
        recordCount: 5000,
        fileType: 'csv',
        status: 'active'
      },
      {
        tableName: 'upload_company_b_202401',
        clientId: 'test-client-123',
        uploadDate: new Date('2024-01-10'),
        recordCount: 3000,
        fileType: 'csv',
        status: 'active'
      },
      {
        tableName: 'upload_company_c_202401',
        clientId: 'test-client-123',
        uploadDate: new Date('2024-01-05'),
        recordCount: 7000,
        fileType: 'csv',
        status: 'active'
      }
    ]);
  });

  describe('getConstraints', () => {
    it('should return lending mode constraints', () => {
      const constraints = lendingMode.getConstraints();
      
      expect(constraints.requiresUploadId).toBe(false);
      expect(constraints.allowsMultipleUploads).toBe(true);
      expect(constraints.requiresClientIdFilter).toBe(true);
      expect(constraints.allowsCrossClientQueries).toBe(false);
      expect(constraints.maxRowsPerQuery).toBe(50000);
      expect(constraints.maxHistoryDays).toBe(1095); // 3 years
      expect(constraints.restrictedOperations).toContain('DROP');
      expect(constraints.restrictedOperations).toContain('DELETE');
      expect(constraints.mandatoryFilters).toContain('client_id');
    });
  });

  describe('validateQuery', () => {
    it('should allow queries without upload context', async () => {
      const contextWithoutUpload = { ...mockContext, uploadId: undefined };
      const query = 'SELECT SUM(amount) FROM transactions GROUP BY company_id';
      
      const result = await lendingMode.validateQuery(query, contextWithoutUpload);
      
      expect(result.isValid).toBe(true);
    });

    it('should reject queries with prohibited operations', async () => {
      const query = 'DELETE FROM transactions WHERE amount < 1000';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Operation 'DELETE' is not allowed in lending mode");
    });

    it('should reject cross-client access attempts', async () => {
      const query = 'SELECT * FROM transactions WHERE client_id != "test-client-123"';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cross-client access is not allowed even in lending mode');
    });

    it('should warn about missing aggregation in portfolio queries', async () => {
      const query = 'SELECT * FROM portfolio_data';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Portfolio queries typically benefit from aggregation functions');
    });

    it('should warn about missing GROUP BY in portfolio queries', async () => {
      const query = 'SELECT SUM(amount) FROM portfolio_data';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Consider grouping portfolio data by company, time period, or other dimensions');
    });

    it('should reject prohibited sensitive columns', async () => {
      const query = 'SELECT ssn, personal_info FROM customer_data';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Column 'ssn' contains sensitive data and is prohibited");
      expect(result.errors).toContain("Column 'personal_info' contains sensitive data and is prohibited");
    });

    it('should warn about joins without constraints', async () => {
      const query = 'SELECT * FROM companies JOIN transactions';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Joins without proper constraints may be slow on large datasets');
    });

    it('should validate allowed table patterns', async () => {
      const query = 'SELECT * FROM internal_admin_table';
      
      const result = await lendingMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Table 'internal_admin_table' is not accessible in lending mode");
    });
  });

  describe('modifyQuery', () => {
    it('should add client_id filter when missing', async () => {
      const query = 'SELECT * FROM portfolio_data';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain("client_id = 'test-client-123'");
      expect(result.appliedConstraints).toContain('Added client_id filter');
    });

    it('should add upload_id scoping for focused analysis', async () => {
      const query = 'SELECT * FROM transactions';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain('upload_test_202401');
      expect(result.appliedConstraints).toContain('Added upload_id scoping for focused analysis');
    });

    it('should not add upload_id scoping for portfolio queries', async () => {
      const query = 'SELECT portfolio_id, SUM(amount) FROM portfolio_data GROUP BY portfolio_id';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).not.toContain('upload_test_202401');
      expect(result.appliedConstraints).not.toContain('Added upload_id scoping for focused analysis');
    });

    it('should add LIMIT clause with higher limit for lending', async () => {
      const query = 'SELECT * FROM portfolio_data';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain('LIMIT 50000');
      expect(result.appliedConstraints).toContain('Added LIMIT 50000');
    });

    it('should add optimization hints for portfolio queries', async () => {
      const query = 'SELECT SUM(amount) FROM portfolio_data GROUP BY company_id';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain('/* Portfolio query optimization */');
      expect(result.appliedConstraints).toContain('Added portfolio query optimization hints');
    });

    it('should warn about large result sets', async () => {
      const query = 'SELECT * FROM portfolio_data';
      
      const result = await lendingMode.modifyQuery(query, mockContext);
      
      expect(result.warnings).toContain('Large result sets may impact performance');
    });
  });

  describe('initializeSession', () => {
    it('should initialize session with portfolio context', async () => {
      const result = await lendingMode.initializeSession('test-client-123');
      
      expect(result.clientId).toBe('test-client-123');
      expect(result.availableUploadIds).toEqual([
        'upload_company_a_202401',
        'upload_company_b_202401', 
        'upload_company_c_202401'
      ]);
      expect(result.portfolioContext?.totalCompanies).toBe(3);
      expect(result.portfolioContext?.activeUploadIds).toEqual([
        'upload_company_a_202401',
        'upload_company_b_202401', 
        'upload_company_c_202401'
      ]);
    });

    it('should set company context when upload specified', async () => {
      const result = await lendingMode.initializeSession('test-client-123', 'upload_company_a_202401');
      
      expect(result.currentUploadId).toBe('upload_company_a_202401');
      expect(result.companyContext?.uploadId).toBe('upload_company_a_202401');
      expect(result.companyContext?.period).toBe('2024-01-15');
    });
  });

  describe('validateSession', () => {
    it('should require portfolio context', () => {
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'lending' as WorkflowMode,
        currentUploadId: undefined,
        availableUploadIds: [],
        portfolioContext: undefined,
        createdAt: new Date(),
        lastActivity: new Date(),
        locked: true
      };
      
      const result = lendingMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('No active uploads available for lending analysis');
      expect(result.errors).toContain('Portfolio context is required for lending mode');
    });

    it('should warn about small portfolio size', () => {
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'lending' as WorkflowMode,
        currentUploadId: undefined,
        availableUploadIds: ['upload_1', 'upload_2'],
        portfolioContext: {
          totalCompanies: 2,
          activeUploadIds: ['upload_1', 'upload_2']
        },
        createdAt: new Date(),
        lastActivity: new Date(),
        locked: true
      };
      
      const result = lendingMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Small portfolio size may limit the effectiveness of comparative analysis');
    });

    it('should warn about old sessions with longer timeout', () => {
      const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13 hours ago
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'lending' as WorkflowMode,
        currentUploadId: undefined,
        availableUploadIds: ['upload_1', 'upload_2', 'upload_3'],
        portfolioContext: {
          totalCompanies: 3,
          activeUploadIds: ['upload_1', 'upload_2', 'upload_3']
        },
        createdAt: oldDate,
        lastActivity: new Date(),
        locked: true
      };
      
      const result = lendingMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Session is getting old, consider refreshing portfolio context');
    });
  });

  describe('validateUploadContext', () => {
    it('should allow optional upload context', async () => {
      const result = await lendingMode.validateUploadContext(undefined, mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('No specific upload context - portfolio-wide analysis available');
    });

    it('should validate existing upload when provided', async () => {
      const result = await lendingMode.validateUploadContext('upload_company_a_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.uploadExists).toBe(true);
      expect(result.belongsToClient).toBe(true);
    });

    it('should allow inactive uploads with warning', async () => {
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_company_a_202401',
          clientId: 'test-client-123',
          uploadDate: new Date('2024-01-15'),
          recordCount: 5000,
          fileType: 'csv',
          status: 'archived'
        }
      ]);
      
      const result = await lendingMode.validateUploadContext('upload_company_a_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Upload 'upload_company_a_202401' is not active (status: archived) but can still be analyzed");
    });

    it('should warn about data freshness for lending decisions', async () => {
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_company_a_202401',
          clientId: 'test-client-123',
          uploadDate: oldDate,
          recordCount: 5000,
          fileType: 'csv',
          status: 'active'
        }
      ]);
      
      const result = await lendingMode.validateUploadContext('upload_company_a_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('This upload is more than 6 months old - consider data freshness for lending decisions');
    });
  });

  describe('getAvailableActions', () => {
    it('should return lending-specific actions', () => {
      const actions = lendingMode.getAvailableActions();
      
      expect(actions).toContain('financial_ratios');
      expect(actions).toContain('liquidity_analysis');
      expect(actions).toContain('portfolio_cash');
      expect(actions).toContain('covenant_compliance');
      expect(actions).not.toContain('unusual_patterns'); // Audit-specific
    });
  });

  describe('applyScoping', () => {
    it('should apply client scoping only for portfolio queries', () => {
      const portfolioQuery = 'SELECT SUM(amount) FROM portfolio_data GROUP BY company_id';
      mockContext.uploadId = undefined;
      
      const result = lendingMode.applyScoping(portfolioQuery, mockContext);
      
      expect(result).toContain("client_id = 'test-client-123'");
      expect(result).not.toContain('upload_test_202401');
    });

    it('should apply both client and upload scoping for focused queries', () => {
      const focusedQuery = 'SELECT * FROM transactions';
      
      const result = lendingMode.applyScoping(focusedQuery, mockContext);
      
      expect(result).toContain("client_id = 'test-client-123'");
      expect(result).toContain('upload_test_202401');
    });
  });

  describe('helper methods', () => {
    it('should identify portfolio queries correctly', () => {
      const portfolioQueries = [
        'SELECT * FROM portfolio_data',
        'SELECT SUM(amount) FROM data',
        'SELECT AVG(balance) FROM accounts GROUP BY company',
        'SELECT * FROM table1 UNION SELECT * FROM table2',
        'SELECT multiple companies data'
      ];

      portfolioQueries.forEach(query => {
        // Access private method through any cast for testing
        const isPortfolio = (lendingMode as any).isPortfolioQuery(query);
        expect(isPortfolio).toBe(true);
      });
    });

    it('should detect aggregation functions', () => {
      const aggregatedQueries = [
        'SELECT SUM(amount) FROM data',
        'SELECT AVG(balance) FROM accounts',
        'SELECT COUNT(*) FROM records',
        'SELECT MAX(value), MIN(value) FROM range'
      ];

      aggregatedQueries.forEach(query => {
        const hasAggregation = (lendingMode as any).hasAggregationFunction(query);
        expect(hasAggregation).toBe(true);
      });
    });

    it('should detect cross-client access attempts', () => {
      const crossClientQueries = [
        'SELECT * FROM data WHERE client_id != "current"',
        'SELECT * FROM data WHERE client_id <> "current"',
        'SELECT * FROM data WHERE not client_id = "current"',
        'SELECT * FROM data WHERE client_id IN ("a", "b", "c")'
      ];

      crossClientQueries.forEach(query => {
        const hasCrossClient = (lendingMode as any).hasCrossClientAccess(query);
        expect(hasCrossClient).toBe(true);
      });
    });
  });
});