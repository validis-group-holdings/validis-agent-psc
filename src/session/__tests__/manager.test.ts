/**
 * Session Manager Tests
 */

import { SessionManager } from '../manager';
import { SessionContext, WorkflowMode } from '../../modes/types';
import * as modeIndex from '../../modes';
import * as uploadHelpers from '../../db/uploadTableHelpers';

// Mock dependencies
jest.mock('../../db/redis', () => ({
  RedisService: {
    getInstance: jest.fn(() => ({
      del: jest.fn(),
      setex: jest.fn(),
      get: jest.fn(),
      keys: jest.fn().mockResolvedValue([])
    }))
  }
}));

jest.mock('../../modes', () => ({
  modeManager: {
    initializeMode: jest.fn(),
    isSessionValid: jest.fn(),
    updateSessionActivity: jest.fn(),
    setUploadContext: jest.fn(),
    validateQuery: jest.fn(),
    applyModeConstraints: jest.fn(),
    getModeRecommendations: jest.fn()
  }
}));

jest.mock('../../db/uploadTableHelpers', () => ({
  getUploadTableInfo: jest.fn()
}));

const mockRedis = {
  del: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  keys: jest.fn()
};

const mockModeManager = modeIndex.modeManager as jest.Mocked<typeof modeIndex.modeManager>;
const mockGetUploadTableInfo = uploadHelpers.getUploadTableInfo as jest.MockedFunction<typeof uploadHelpers.getUploadTableInfo>;

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockSessionContext: SessionContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup Redis mock
    (RedisService.getInstance as jest.Mock).mockReturnValue(mockRedis);
    mockRedis.keys.mockResolvedValue([]);
    mockRedis.get.mockResolvedValue(null);

    // Setup mode manager mocks
    mockModeManager.initializeMode.mockImplementation(async (mode, sessionId, clientId, uploadId) => ({
      sessionId,
      clientId,
      mode,
      currentUploadId: uploadId,
      availableUploadIds: ['upload1', 'upload2'],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: true
    }));

    mockModeManager.isSessionValid.mockReturnValue(true);
    mockModeManager.updateSessionActivity.mockImplementation((context) => ({
      ...context,
      lastActivity: new Date()
    }));
    mockModeManager.getModeRecommendations.mockReturnValue(['Test recommendation']);

    // Create session manager instance
    sessionManager = new SessionManager({
      sessionTimeout: 60000, // 1 minute for testing
      maxSessionsPerClient: 3,
      cleanupInterval: 30000, // 30 seconds for testing
      persistentStorage: false // Disable for testing
    });

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
  });

  afterEach(async () => {
    // Clean up to prevent test interference
    await sessionManager.emergencyCleanup();
    await sessionManager.shutdown();
  });

  describe('createSession', () => {
    it('should create new session successfully', async () => {
      const session = await sessionManager.createSession('client-123', 'audit', 'upload-123');
      
      expect(session.clientId).toBe('client-123');
      expect(session.mode).toBe('audit');
      expect(session.currentUploadId).toBe('upload-123');
      expect(session.locked).toBe(true);
      expect(mockModeManager.initializeMode).toHaveBeenCalledWith('audit', expect.any(String), 'client-123', 'upload-123');
    });

    it('should create session without upload ID', async () => {
      const session = await sessionManager.createSession('client-123', 'lending');
      
      expect(session.clientId).toBe('client-123');
      expect(session.mode).toBe('lending');
      expect(session.currentUploadId).toBeUndefined();
      expect(mockModeManager.initializeMode).toHaveBeenCalledWith('lending', expect.any(String), 'client-123', undefined);
    });

    it('should enforce session limits per client', async () => {
      // Create maximum sessions for a client
      for (let i = 0; i < 3; i++) {
        await sessionManager.createSession('client-123', 'audit');
      }
      
      // This should remove the oldest session
      const session = await sessionManager.createSession('client-123', 'audit');
      
      expect(session).toBeDefined();
      expect(session.clientId).toBe('client-123');
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session', async () => {
      const createdSession = await sessionManager.createSession('client-123', 'audit');
      
      const retrievedSession = await sessionManager.getSession(createdSession.sessionId);
      
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession?.sessionId).toBe(createdSession.sessionId);
      expect(retrievedSession?.clientId).toBe('client-123');
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('non-existent-session');
      
      expect(session).toBeNull();
    });

    it('should remove invalid sessions', async () => {
      const createdSession = await sessionManager.createSession('client-123', 'audit');
      
      // Mock session as invalid
      mockModeManager.isSessionValid.mockReturnValueOnce(false);
      
      const retrievedSession = await sessionManager.getSession(createdSession.sessionId);
      
      expect(retrievedSession).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update session activity', async () => {
      const originalSession = await sessionManager.createSession('client-123', 'audit');
      
      // Wait a bit and then update
      await new Promise(resolve => setTimeout(resolve, 10));
      const updatedSession = await sessionManager.updateSession(originalSession);
      
      expect(updatedSession.lastActivity.getTime()).toBeGreaterThan(originalSession.lastActivity.getTime());
      expect(mockModeManager.updateSessionActivity).toHaveBeenCalledWith(originalSession);
    });
  });

  describe('setSessionUploadContext', () => {
    it('should set upload context for existing session', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      
      mockModeManager.setUploadContext.mockResolvedValueOnce({
        ...session,
        currentUploadId: 'new-upload-123'
      });
      
      const updatedSession = await sessionManager.setSessionUploadContext(session.sessionId, 'new-upload-123');
      
      expect(updatedSession.currentUploadId).toBe('new-upload-123');
      expect(mockModeManager.setUploadContext).toHaveBeenCalledWith(session, 'new-upload-123');
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.setSessionUploadContext('non-existent', 'upload-123')
      ).rejects.toThrow('Session non-existent not found');
    });
  });

  describe('removeSession', () => {
    it('should remove existing session', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      
      const removed = await sessionManager.removeSession(session.sessionId);
      
      expect(removed).toBe(true);
      
      // Verify session is gone
      const retrievedSession = await sessionManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const removed = await sessionManager.removeSession('non-existent');
      
      expect(removed).toBe(false);
    });
  });

  describe('getClientSessions', () => {
    it('should return all sessions for a client', async () => {
      const session1 = await sessionManager.createSession('client-123', 'audit');
      const session2 = await sessionManager.createSession('client-123', 'lending');
      await sessionManager.createSession('client-456', 'audit'); // Different client
      
      const clientSessions = await sessionManager.getClientSessions('client-123');
      
      expect(clientSessions).toHaveLength(2);
      expect(clientSessions.map(s => s.sessionId)).toContain(session1.sessionId);
      expect(clientSessions.map(s => s.sessionId)).toContain(session2.sessionId);
    });

    it('should sort sessions by activity (most recent first)', async () => {
      const session1 = await sessionManager.createSession('client-123', 'audit');
      await new Promise(resolve => setTimeout(resolve, 10));
      const session2 = await sessionManager.createSession('client-123', 'lending');
      
      const clientSessions = await sessionManager.getClientSessions('client-123');
      
      expect(clientSessions[0].sessionId).toBe(session2.sessionId); // Most recent first
      expect(clientSessions[1].sessionId).toBe(session1.sessionId);
    });
  });

  describe('getStats', () => {
    it('should return session statistics', async () => {
      await sessionManager.createSession('client-123', 'audit');
      await sessionManager.createSession('client-123', 'lending');
      await sessionManager.createSession('client-456', 'audit');
      
      const stats = sessionManager.getStats();
      
      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByMode.audit).toBe(2);
      expect(stats.sessionsByMode.lending).toBe(1);
      expect(stats.oldestSession).toBeDefined();
      expect(stats.averageSessionAge).toBeGreaterThan(0);
    });

    it('should handle empty session state', () => {
      const stats = sessionManager.getStats();
      
      expect(stats.totalSessions).toBe(0);
      expect(stats.activeSessions).toBe(0);
      expect(stats.oldestSession).toBeNull();
      expect(stats.averageSessionAge).toBe(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should clean up expired sessions', async () => {
      // Create session that will be expired
      const session = await sessionManager.createSession('client-123', 'audit');
      
      // Manually expire the session by mocking isSessionValid
      mockModeManager.isSessionValid.mockReturnValue(false);
      
      const cleanedCount = await sessionManager.cleanupExpiredSessions();
      
      expect(cleanedCount).toBe(1);
      
      // Reset mock and verify session is gone
      mockModeManager.isSessionValid.mockReturnValue(true);
      const retrievedSession = await sessionManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should not clean up valid sessions', async () => {
      await sessionManager.createSession('client-123', 'audit');
      await sessionManager.createSession('client-456', 'lending');
      
      const cleanedCount = await sessionManager.cleanupExpiredSessions();
      
      expect(cleanedCount).toBe(0);
      expect(sessionManager.getStats().totalSessions).toBe(2);
    });
  });

  describe('validateSessionQuery', () => {
    it('should validate query with session context', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      const query = 'SELECT * FROM transactions';
      
      mockModeManager.validateQuery.mockResolvedValueOnce({
        isValid: true,
        errors: [],
        warnings: ['Test warning']
      });
      
      const result = await sessionManager.validateSessionQuery(session.sessionId, query);
      
      expect(result.isValid).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.warnings).toContain('Test warning');
      expect(mockModeManager.validateQuery).toHaveBeenCalledWith(query, session);
    });

    it('should handle non-existent session', async () => {
      const result = await sessionManager.validateSessionQuery('non-existent', 'SELECT * FROM test');
      
      expect(result.isValid).toBe(false);
      expect(result.session).toBeNull();
      expect(result.errors).toContain('Session not found or expired');
    });
  });

  describe('applySessionConstraints', () => {
    it('should apply constraints with session context', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      const query = 'SELECT * FROM transactions';
      
      mockModeManager.applyModeConstraints.mockResolvedValueOnce({
        originalQuery: query,
        modifiedQuery: query + ' WHERE client_id = "client-123"',
        appliedConstraints: ['Added client_id filter'],
        warnings: [],
        errors: []
      });
      
      const result = await sessionManager.applySessionConstraints(session.sessionId, query);
      
      expect(result.session).toBeDefined();
      expect(result.modification.modifiedQuery).toContain('client_id');
      expect(result.errors).toHaveLength(0);
      expect(mockModeManager.applyModeConstraints).toHaveBeenCalledWith(query, session);
    });

    it('should handle constraint application errors', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      
      mockModeManager.applyModeConstraints.mockResolvedValueOnce({
        originalQuery: 'SELECT * FROM transactions',
        modifiedQuery: 'SELECT * FROM transactions',
        appliedConstraints: [],
        warnings: [],
        errors: ['Constraint error']
      });
      
      const result = await sessionManager.applySessionConstraints(session.sessionId, 'SELECT * FROM transactions');
      
      expect(result.errors).toContain('Constraint error');
    });
  });

  describe('getSessionRecommendations', () => {
    it('should get recommendations for valid session', async () => {
      const session = await sessionManager.createSession('client-123', 'audit');
      
      const recommendations = await sessionManager.getSessionRecommendations(session.sessionId);
      
      expect(recommendations).toContain('Test recommendation');
      expect(mockModeManager.getModeRecommendations).toHaveBeenCalledWith(session);
    });

    it('should handle non-existent session', async () => {
      const recommendations = await sessionManager.getSessionRecommendations('non-existent');
      
      expect(recommendations).toContain('Session not found or expired');
    });
  });

  describe('emergencyCleanup', () => {
    it('should remove all sessions', async () => {
      await sessionManager.createSession('client-123', 'audit');
      await sessionManager.createSession('client-456', 'lending');
      
      expect(sessionManager.getStats().totalSessions).toBe(2);
      
      const cleanedCount = await sessionManager.emergencyCleanup();
      
      expect(cleanedCount).toBe(2);
      expect(sessionManager.getStats().totalSessions).toBe(0);
    });
  });

  describe('persistent storage', () => {
    let persistentSessionManager: SessionManager;

    beforeEach(() => {
      persistentSessionManager = new SessionManager({
        sessionTimeout: 60000,
        maxSessionsPerClient: 3,
        cleanupInterval: 30000,
        persistentStorage: true
      });
    });

    afterEach(async () => {
      await persistentSessionManager.emergencyCleanup();
      await persistentSessionManager.shutdown();
    });

    it('should persist session to Redis when enabled', async () => {
      const session = await persistentSessionManager.createSession('client-123', 'audit');
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `session:${session.sessionId}`,
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should load session from Redis', async () => {
      const mockSessionData = {
        sessionId: 'persisted-session',
        clientId: 'client-123',
        mode: 'audit',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        locked: true
      };
      
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSessionData));
      
      const session = await persistentSessionManager.getSession('persisted-session');
      
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe('persisted-session');
      expect(mockRedis.get).toHaveBeenCalledWith('session:persisted-session');
    });

    it('should remove session from Redis when deleted', async () => {
      const session = await persistentSessionManager.createSession('client-123', 'audit');
      
      await persistentSessionManager.removeSession(session.sessionId);
      
      expect(mockRedis.del).toHaveBeenCalledWith(`session:${session.sessionId}`);
    });
  });

  describe('graceful shutdown', () => {
    it('should persist sessions during shutdown when persistence enabled', async () => {
      const persistentManager = new SessionManager({
        sessionTimeout: 60000,
        maxSessionsPerClient: 3,
        cleanupInterval: 30000,
        persistentStorage: true
      });
      
      await persistentManager.createSession('client-123', 'audit');
      await persistentManager.createSession('client-456', 'lending');
      
      await persistentManager.shutdown();
      
      // Should have persisted both sessions
      expect(mockRedis.setex).toHaveBeenCalledTimes(4); // 2 creates + 2 shutdown persists
    });
  });

  describe('error handling', () => {
    it('should handle Redis errors gracefully during persistence', async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error('Redis connection failed'));
      
      const persistentManager = new SessionManager({
        persistentStorage: true
      });
      
      // Should not throw despite Redis error
      const session = await persistentManager.createSession('client-123', 'audit');
      
      expect(session).toBeDefined();
      await persistentManager.shutdown();
    });

    it('should handle mode manager errors during session creation', async () => {
      mockModeManager.initializeMode.mockRejectedValueOnce(new Error('Mode initialization failed'));
      
      await expect(
        sessionManager.createSession('client-123', 'invalid' as WorkflowMode)
      ).rejects.toThrow('Mode initialization failed');
    });

    it('should handle corrupted session data from Redis', async () => {
      mockRedis.get.mockResolvedValueOnce('invalid-json{');
      
      const persistentManager = new SessionManager({
        persistentStorage: true
      });
      
      const session = await persistentManager.getSession('corrupted-session');
      
      expect(session).toBeNull();
      await persistentManager.shutdown();
    });
  });
});