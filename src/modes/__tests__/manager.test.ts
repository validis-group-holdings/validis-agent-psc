/**
 * Mode Manager Tests
 */

import { WorkflowModeManager, WorkflowModeFactory } from '../index';
import { AuditModeStrategy } from '../audit';
import { LendingModeStrategy } from '../lending';
import { SessionContext, WorkflowMode } from '../types';
import * as uploadHelpers from '../../db/uploadTableHelpers';

// Mock dependencies
jest.mock('../../db/uploadTableHelpers', () => ({
  getUploadTableInfo: jest.fn()
}));

jest.mock('../../config', () => ({
  config: {
    workflowMode: 'audit' as WorkflowMode
  }
}));

const mockGetUploadTableInfo = uploadHelpers.getUploadTableInfo as jest.MockedFunction<typeof uploadHelpers.getUploadTableInfo>;

describe('WorkflowModeFactory', () => {
  let factory: WorkflowModeFactory;

  beforeEach(() => {
    factory = new WorkflowModeFactory();
  });

  describe('createMode', () => {
    it('should create audit mode strategy', () => {
      const strategy = factory.createMode('audit');
      expect(strategy).toBeInstanceOf(AuditModeStrategy);
    });

    it('should create lending mode strategy', () => {
      const strategy = factory.createMode('lending');
      expect(strategy).toBeInstanceOf(LendingModeStrategy);
    });

    it('should throw error for unsupported mode', () => {
      expect(() => {
        factory.createMode('invalid' as WorkflowMode);
      }).toThrow('Unsupported workflow mode: invalid');
    });
  });

  describe('getAvailableModes', () => {
    it('should return all available modes', () => {
      const modes = factory.getAvailableModes();
      expect(modes).toEqual(['audit', 'lending']);
    });
  });

  describe('validateModeConfig', () => {
    it('should validate supported modes', () => {
      expect(factory.validateModeConfig('audit')).toBe(true);
      expect(factory.validateModeConfig('lending')).toBe(true);
    });

    it('should reject unsupported modes', () => {
      expect(factory.validateModeConfig('invalid' as WorkflowMode)).toBe(false);
    });
  });
});

describe('WorkflowModeManager', () => {
  let manager: WorkflowModeManager;
  let mockSessionContext: SessionContext;

  beforeEach(() => {
    manager = new WorkflowModeManager();
    mockSessionContext = {
      sessionId: 'test-session-123',
      clientId: 'test-client-123',
      mode: 'audit',
      currentUploadId: 'upload_test_202401',
      availableUploadIds: ['upload_test_202401', 'upload_test_202312'],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: true
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Default mock for upload info
    mockGetUploadTableInfo.mockResolvedValue([
      {
        tableName: 'upload_test_202401',
        clientId: 'test-client-123',
        uploadDate: new Date('2024-01-15'),
        recordCount: 1000,
        fileType: 'csv',
        status: 'active'
      }
    ]);
  });

  describe('getCurrentMode', () => {
    it('should return default mode when none set', () => {
      const mode = manager.getCurrentMode();
      expect(mode).toBeInstanceOf(AuditModeStrategy);
    });

    it('should return current strategy after initialization', async () => {
      await manager.initializeMode('lending', 'session-123', 'client-123');
      const mode = manager.getCurrentMode();
      expect(mode).toBeInstanceOf(LendingModeStrategy);
    });
  });

  describe('canSwitchMode', () => {
    it('should prevent mode switching by default', () => {
      expect(manager.canSwitchMode()).toBe(false);
    });

    it('should prevent switching after session lock', async () => {
      await manager.initializeMode('audit', 'session-123', 'client-123');
      expect(manager.canSwitchMode()).toBe(false);
    });
  });

  describe('initializeMode', () => {
    it('should initialize audit mode successfully', async () => {
      const sessionContext = await manager.initializeMode('audit', 'session-123', 'client-123', 'upload_test_202401');
      
      expect(sessionContext.mode).toBe('audit');
      expect(sessionContext.clientId).toBe('client-123');
      expect(sessionContext.sessionId).toBe('session-123');
      expect(sessionContext.currentUploadId).toBe('upload_test_202401');
      expect(sessionContext.locked).toBe(true);
    });

    it('should initialize lending mode successfully', async () => {
      const sessionContext = await manager.initializeMode('lending', 'session-123', 'client-123');
      
      expect(sessionContext.mode).toBe('lending');
      expect(sessionContext.clientId).toBe('client-123');
      expect(sessionContext.sessionId).toBe('session-123');
      expect(sessionContext.locked).toBe(true);
    });

    it('should throw error for invalid mode', async () => {
      await expect(
        manager.initializeMode('invalid' as WorkflowMode, 'session-123', 'client-123')
      ).rejects.toThrow('Invalid workflow mode: invalid');
    });

    it('should lock session after initialization', async () => {
      await manager.initializeMode('audit', 'session-123', 'client-123');
      expect(manager.canSwitchMode()).toBe(false);
    });
  });

  describe('validateQuery', () => {
    it('should validate query using current mode strategy', async () => {
      const query = 'SELECT * FROM transactions';
      
      const result = await manager.validateQuery(query, mockSessionContext);
      
      expect(result.isValid).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should handle validation errors gracefully', async () => {
      const query = 'DROP TABLE transactions';
      
      const result = await manager.validateQuery(query, mockSessionContext);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('applyModeConstraints', () => {
    it('should apply constraints using current mode strategy', async () => {
      const query = 'SELECT * FROM transactions';
      
      const result = await manager.applyModeConstraints(query, mockSessionContext);
      
      expect(result.originalQuery).toBe(query);
      expect(result.modifiedQuery).toBeDefined();
      expect(result.appliedConstraints).toBeDefined();
    });

    it('should preserve original query in modification result', async () => {
      const query = 'SELECT * FROM transactions LIMIT 100';
      
      const result = await manager.applyModeConstraints(query, mockSessionContext);
      
      expect(result.originalQuery).toBe(query);
    });
  });

  describe('getModeRecommendations', () => {
    it('should return audit-specific recommendations', async () => {
      await manager.initializeMode('audit', 'session-123', 'client-123');
      mockSessionContext.mode = 'audit';
      
      const recommendations = manager.getModeRecommendations(mockSessionContext);
      
      expect(recommendations.some(r => r.includes('audit'))).toBe(true);
      expect(recommendations.some(r => r.includes('Available actions'))).toBe(true);
    });

    it('should return lending-specific recommendations', async () => {
      await manager.initializeMode('lending', 'session-123', 'client-123');
      const lendingContext = { 
        ...mockSessionContext, 
        mode: 'lending' as WorkflowMode,
        portfolioContext: { totalCompanies: 5, activeUploadIds: ['a', 'b', 'c', 'd', 'e'] }
      };
      
      const recommendations = manager.getModeRecommendations(lendingContext);
      
      expect(recommendations.some(r => r.includes('lending'))).toBe(true);
      expect(recommendations.some(r => r.includes('portfolio'))).toBe(true);
    });

    it('should warn about session timeout', () => {
      const oldContext = {
        ...mockSessionContext,
        createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000) // 10 hours ago
      };
      
      const recommendations = manager.getModeRecommendations(oldContext);
      
      expect(recommendations.some(r => r.includes('timeout'))).toBe(true);
    });
  });

  describe('getModeConstraints', () => {
    it('should return constraints for specified mode', () => {
      const auditConstraints = manager.getModeConstraints('audit');
      const lendingConstraints = manager.getModeConstraints('lending');
      
      expect(auditConstraints.requiresUploadId).toBe(true);
      expect(lendingConstraints.requiresUploadId).toBe(false);
      
      expect(auditConstraints.maxRowsPerQuery).toBe(5000);
      expect(lendingConstraints.maxRowsPerQuery).toBe(50000);
    });

    it('should return current mode constraints when no mode specified', () => {
      const constraints = manager.getModeConstraints();
      expect(constraints).toBeDefined();
      expect(constraints.maxRowsPerQuery).toBeDefined();
    });
  });

  describe('applyScopingToQuery', () => {
    it('should apply mode-specific scoping', () => {
      const query = 'SELECT * FROM transactions';
      
      const scopedQuery = manager.applyScopingToQuery(query, mockSessionContext);
      
      expect(scopedQuery).toContain("client_id = 'test-client-123'");
    });

    it('should not modify already scoped queries', () => {
      const query = 'SELECT * FROM upload_test_202401 WHERE client_id = "test-client-123"';
      
      const scopedQuery = manager.applyScopingToQuery(query, mockSessionContext);
      
      expect(scopedQuery).toBe(query);
    });
  });

  describe('getSessionStats', () => {
    it('should return comprehensive session statistics', () => {
      const stats = manager.getSessionStats(mockSessionContext);
      
      expect(stats.mode).toBe('audit');
      expect(stats.sessionAge).toBeGreaterThan(0);
      expect(stats.uploadContext).toBeDefined();
      expect(stats.uploadContext.current).toBe('upload_test_202401');
      expect(stats.uploadContext.available).toBe(2);
      expect(stats.locked).toBe(true);
      expect(stats.recommendations).toBeDefined();
    });

    it('should include portfolio context for lending mode', () => {
      const lendingContext = { 
        ...mockSessionContext, 
        mode: 'lending' as WorkflowMode,
        portfolioContext: { totalCompanies: 3, activeUploadIds: ['a', 'b', 'c'] }
      };
      
      const stats = manager.getSessionStats(lendingContext);
      
      expect(stats.portfolioContext).toBeDefined();
      expect(stats.portfolioContext.totalCompanies).toBe(3);
    });
  });

  describe('updateSessionActivity', () => {
    it('should update last activity timestamp', () => {
      const originalActivity = mockSessionContext.lastActivity;
      
      // Wait a bit to ensure different timestamp
      const updatedContext = manager.updateSessionActivity(mockSessionContext);
      
      expect(updatedContext.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should preserve other session properties', () => {
      const updatedContext = manager.updateSessionActivity(mockSessionContext);
      
      expect(updatedContext.sessionId).toBe(mockSessionContext.sessionId);
      expect(updatedContext.clientId).toBe(mockSessionContext.clientId);
      expect(updatedContext.mode).toBe(mockSessionContext.mode);
      expect(updatedContext.locked).toBe(mockSessionContext.locked);
    });
  });

  describe('isSessionValid', () => {
    it('should validate active sessions', () => {
      const isValid = manager.isSessionValid(mockSessionContext);
      expect(isValid).toBe(true);
    });

    it('should invalidate very old sessions', () => {
      const oldContext = {
        ...mockSessionContext,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000)
      };
      
      const isValid = manager.isSessionValid(oldContext);
      expect(isValid).toBe(false);
    });

    it('should invalidate unlocked sessions', () => {
      const unlockedContext = {
        ...mockSessionContext,
        locked: false
      };
      
      const isValid = manager.isSessionValid(unlockedContext);
      expect(isValid).toBe(false);
    });

    it('should invalidate inactive sessions', () => {
      const inactiveContext = {
        ...mockSessionContext,
        lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
      };
      
      const isValid = manager.isSessionValid(inactiveContext);
      expect(isValid).toBe(false);
    });
  });

  describe('setUploadContext', () => {
    it('should set upload context successfully', async () => {
      const updatedContext = await manager.setUploadContext(mockSessionContext, 'upload_test_202401');
      
      expect(updatedContext.currentUploadId).toBe('upload_test_202401');
      expect(updatedContext.lastActivity.getTime()).toBeGreaterThan(mockSessionContext.lastActivity.getTime());
    });

    it('should validate upload context before setting', async () => {
      await expect(
        manager.setUploadContext(mockSessionContext, 'nonexistent_upload')
      ).rejects.toThrow('Invalid upload context');
    });
  });

  describe('reset', () => {
    it('should reset manager state', async () => {
      await manager.initializeMode('lending', 'session-123', 'client-123');
      expect(manager.canSwitchMode()).toBe(false);
      
      manager.reset();
      
      expect(manager.canSwitchMode()).toBe(true);
      // After reset, should return to default mode
      expect(manager.getCurrentMode()).toBeInstanceOf(AuditModeStrategy);
    });
  });

  describe('getModeConfig', () => {
    it('should return mode configuration', () => {
      const config = manager.getModeConfig();
      
      expect(config.defaultMode).toBe('audit');
      expect(config.allowModeSwitching).toBe(false);
      expect(config.sessionTimeout).toBeGreaterThan(0);
      expect(config.maxSessionsPerClient).toBeGreaterThan(0);
    });

    it('should return copy of config to prevent mutations', () => {
      const config1 = manager.getModeConfig();
      const config2 = manager.getModeConfig();
      
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });
});