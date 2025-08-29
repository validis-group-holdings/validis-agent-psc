/**
 * Audit Mode Strategy Tests
 */

import { AuditModeStrategy } from '../audit';
import { ModeContext, WorkflowMode } from '../types';
import * as uploadHelpers from '../../db/uploadTableHelpers';

// Mock the upload table helpers
jest.mock('../../db/uploadTableHelpers', () => ({
  getUploadTableInfo: jest.fn()
}));

const mockGetUploadTableInfo = uploadHelpers.getUploadTableInfo as jest.MockedFunction<typeof uploadHelpers.getUploadTableInfo>;

describe('AuditModeStrategy', () => {
  let auditMode: AuditModeStrategy;
  let mockContext: ModeContext;

  beforeEach(() => {
    auditMode = new AuditModeStrategy();
    mockContext = {
      clientId: 'test-client-123',
      uploadId: 'upload_test_202401',
      sessionId: 'session_123',
      mode: 'audit' as WorkflowMode,
      lockedAt: new Date()
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Default mock implementation
    mockGetUploadTableInfo.mockResolvedValue([
      {
        tableName: 'upload_test_202401',
        clientId: 'test-client-123',
        uploadDate: new Date('2024-01-15'),
        recordCount: 1000,
        fileType: 'csv',
        status: 'active'
      },
      {
        tableName: 'upload_test_202312',
        clientId: 'test-client-123',
        uploadDate: new Date('2023-12-15'),
        recordCount: 800,
        fileType: 'csv',
        status: 'active'
      }
    ]);
  });

  describe('getConstraints', () => {
    it('should return audit mode constraints', () => {
      const constraints = auditMode.getConstraints();
      
      expect(constraints.requiresUploadId).toBe(true);
      expect(constraints.allowsMultipleUploads).toBe(false);
      expect(constraints.requiresClientIdFilter).toBe(true);
      expect(constraints.allowsCrossClientQueries).toBe(false);
      expect(constraints.maxRowsPerQuery).toBe(5000);
      expect(constraints.restrictedOperations).toContain('DROP');
      expect(constraints.restrictedOperations).toContain('DELETE');
      expect(constraints.mandatoryFilters).toContain('client_id');
    });
  });

  describe('validateQuery', () => {
    it('should reject query without upload context', async () => {
      const contextWithoutUpload = { ...mockContext, uploadId: undefined };
      const query = 'SELECT * FROM transactions';
      
      const result = await auditMode.validateQuery(query, contextWithoutUpload);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Audit mode requires a specific company context (upload_id)');
      expect(result.requiredContext?.uploadId).toBe('required');
    });

    it('should reject queries with prohibited operations', async () => {
      const query = 'DROP TABLE transactions';
      
      const result = await auditMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Operation 'DROP' is not allowed in audit mode");
    });

    it('should warn about missing client_id filter', async () => {
      const query = 'SELECT * FROM upload_test_202401';
      
      const result = await auditMode.validateQuery(query, mockContext);
      
      expect(result.warnings).toContain('Query will be automatically scoped to your client_id');
    });

    it('should warn about missing upload_id scoping', async () => {
      const query = 'SELECT * FROM transactions WHERE client_id = "test-client-123"';
      
      const result = await auditMode.validateQuery(query, mockContext);
      
      expect(result.warnings).toContain('Query will be automatically scoped to the current company context');
    });

    it('should validate allowed table patterns', async () => {
      const query = 'SELECT * FROM secret_admin_table';
      
      const result = await auditMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Table 'secret_admin_table' is not accessible in audit mode");
    });

    it('should pass validation for properly formatted query', async () => {
      const query = 'SELECT * FROM upload_test_202401 WHERE client_id = "test-client-123" LIMIT 100';
      
      const result = await auditMode.validateQuery(query, mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('modifyQuery', () => {
    it('should add client_id filter when missing', async () => {
      const query = 'SELECT * FROM upload_test_202401';
      
      const result = await auditMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain("client_id = 'test-client-123'");
      expect(result.appliedConstraints).toContain('Added client_id filter');
    });

    it('should add upload_id scoping when missing', async () => {
      const query = 'SELECT * FROM transactions';
      
      const result = await auditMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain('upload_test_202401');
      expect(result.appliedConstraints).toContain('Added upload_id scoping');
    });

    it('should add LIMIT clause when missing', async () => {
      const query = 'SELECT * FROM upload_test_202401';
      
      const result = await auditMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toContain('LIMIT 5000');
      expect(result.appliedConstraints).toContain('Added LIMIT 5000');
    });

    it('should not modify already properly scoped query', async () => {
      const query = 'SELECT * FROM upload_test_202401 WHERE client_id = "test-client-123" LIMIT 100';
      
      const result = await auditMode.modifyQuery(query, mockContext);
      
      expect(result.modifiedQuery).toBe(query);
      expect(result.appliedConstraints).toHaveLength(0);
    });
  });

  describe('initializeSession', () => {
    it('should initialize session with available uploads', async () => {
      const result = await auditMode.initializeSession('test-client-123', 'upload_test_202401');
      
      expect(result.clientId).toBe('test-client-123');
      expect(result.currentUploadId).toBe('upload_test_202401');
      expect(result.availableUploadIds).toEqual(['upload_test_202401', 'upload_test_202312']);
      expect(result.companyContext?.uploadId).toBe('upload_test_202401');
    });

    it('should handle initialization without specific upload', async () => {
      const result = await auditMode.initializeSession('test-client-123');
      
      expect(result.clientId).toBe('test-client-123');
      expect(result.currentUploadId).toBeUndefined();
      expect(result.availableUploadIds).toEqual(['upload_test_202401', 'upload_test_202312']);
    });
  });

  describe('validateSession', () => {
    it('should require upload context for audit mode', () => {
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'audit' as WorkflowMode,
        currentUploadId: undefined,
        availableUploadIds: ['upload_test_202401'],
        createdAt: new Date(),
        lastActivity: new Date(),
        locked: true
      };
      
      const result = auditMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Audit mode requires a specific company context to be selected');
    });

    it('should validate upload availability', () => {
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'audit' as WorkflowMode,
        currentUploadId: 'upload_missing',
        availableUploadIds: ['upload_test_202401'],
        createdAt: new Date(),
        lastActivity: new Date(),
        locked: true
      };
      
      const result = auditMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Selected company context is no longer available');
    });

    it('should warn about old sessions', () => {
      const oldDate = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9 hours ago
      const sessionContext = {
        sessionId: 'session_123',
        clientId: 'test-client-123',
        mode: 'audit' as WorkflowMode,
        currentUploadId: 'upload_test_202401',
        availableUploadIds: ['upload_test_202401'],
        createdAt: oldDate,
        lastActivity: new Date(),
        locked: true
      };
      
      const result = auditMode.validateSession(sessionContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Session is getting old, consider refreshing company context');
    });
  });

  describe('validateUploadContext', () => {
    it('should validate existing upload', async () => {
      const result = await auditMode.validateUploadContext('upload_test_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.uploadExists).toBe(true);
      expect(result.belongsToClient).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('should reject missing upload', async () => {
      const result = await auditMode.validateUploadContext('nonexistent_upload', mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.uploadExists).toBe(false);
      expect(result.errors).toContain("Upload 'nonexistent_upload' not found");
    });

    it('should reject upload from different client', async () => {
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_test_202401',
          clientId: 'different-client',
          uploadDate: new Date('2024-01-15'),
          recordCount: 1000,
          fileType: 'csv',
          status: 'active'
        }
      ]);
      
      const result = await auditMode.validateUploadContext('upload_test_202401', mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.belongsToClient).toBe(false);
      expect(result.errors).toContain("Upload 'upload_test_202401' does not belong to client 'test-client-123'");
    });

    it('should reject inactive upload', async () => {
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_test_202401',
          clientId: 'test-client-123',
          uploadDate: new Date('2024-01-15'),
          recordCount: 1000,
          fileType: 'csv',
          status: 'archived'
        }
      ]);
      
      const result = await auditMode.validateUploadContext('upload_test_202401', mockContext);
      
      expect(result.isValid).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.errors).toContain("Upload 'upload_test_202401' is not active (status: archived)");
    });

    it('should warn about small uploads', async () => {
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_test_202401',
          clientId: 'test-client-123',
          uploadDate: new Date('2024-01-15'),
          recordCount: 50,
          fileType: 'csv',
          status: 'active'
        }
      ]);
      
      const result = await auditMode.validateUploadContext('upload_test_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('This upload has relatively few records, results may be limited');
    });

    it('should warn about old uploads', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      mockGetUploadTableInfo.mockResolvedValueOnce([
        {
          tableName: 'upload_test_202401',
          clientId: 'test-client-123',
          uploadDate: oldDate,
          recordCount: 1000,
          fileType: 'csv',
          status: 'active'
        }
      ]);
      
      const result = await auditMode.validateUploadContext('upload_test_202401', mockContext);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('This upload is more than 90 days old');
    });
  });

  describe('getAvailableActions', () => {
    it('should return audit-specific actions', () => {
      const actions = auditMode.getAvailableActions();
      
      expect(actions).toContain('journal_entries');
      expect(actions).toContain('vendor_payments');
      expect(actions).toContain('unusual_patterns');
      expect(actions).toContain('compliance');
      expect(actions).not.toContain('portfolio_cash'); // Lending-specific
    });
  });

  describe('applyScoping', () => {
    it('should apply both client and upload scoping', () => {
      const query = 'SELECT * FROM transactions';
      
      const result = auditMode.applyScoping(query, mockContext);
      
      expect(result).toContain("client_id = 'test-client-123'");
      expect(result).toContain('upload_test_202401');
    });

    it('should not duplicate existing scoping', () => {
      const query = 'SELECT * FROM upload_test_202401 WHERE client_id = "test-client-123"';
      
      const result = auditMode.applyScoping(query, mockContext);
      
      expect(result).toBe(query); // Should remain unchanged
    });
  });
});