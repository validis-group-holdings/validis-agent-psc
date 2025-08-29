/**
 * Global Test Setup - Shared mocks and setup for all tests
 */

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'test_db';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ANTHROPIC_API_KEY = 'test-api-key';
process.env.JWT_SECRET = 'test-jwt-secret';

// Mock database connection
jest.mock('../db/connection', () => ({
  getConnection: jest.fn().mockResolvedValue({
    request: jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({
        recordset: [{ id: 1, name: 'Test Record', client_id: 'test-client' }]
      }),
      input: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        recordset: []
      })
    }),
    close: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined)
  })
}));

// Mock Redis client
jest.mock('../db/redis', () => {
  const store = new Map();
  
  return {
    getRedisClient: jest.fn().mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => 
        Promise.resolve(store.get(key))
      ),
      set: jest.fn().mockImplementation((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      setEx: jest.fn().mockImplementation((key: string, ttl: number, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn().mockImplementation((key: string) => {
        const existed = store.has(key);
        store.delete(key);
        return Promise.resolve(existed ? 1 : 0);
      }),
      exists: jest.fn().mockImplementation((key: string) => 
        Promise.resolve(store.has(key) ? 1 : 0)
      ),
      keys: jest.fn().mockImplementation((pattern: string) => {
        const keys = Array.from(store.keys());
        if (pattern === '*') return Promise.resolve(keys);
        const regex = new RegExp(pattern.replace('*', '.*'));
        return Promise.resolve(keys.filter(key => regex.test(key)));
      }),
      flushDb: jest.fn().mockImplementation(() => {
        store.clear();
        return Promise.resolve('OK');
      }),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn().mockResolvedValue(undefined)
    })
  };
});

// Mock Anthropic API
jest.mock('@langchain/anthropic', () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'Mock AI response for testing'
    })
  }))
}));

// Mock upload table helpers
jest.mock('../db/uploadTableHelpers', () => ({
  executeSecureQuery: jest.fn().mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'Test Record', client_id: 'test-client' }],
    rowCount: 1,
    executionTime: 100
  }),
  verifyUploadAccess: jest.fn().mockResolvedValue(true),
  getUploadInfo: jest.fn().mockResolvedValue({
    upload_id: 'upload_test_202401',
    client_id: 'test-client',
    company_name: 'Test Company',
    period: '2024-01',
    status: 'active'
  }),
  getTableStatistics: jest.fn().mockResolvedValue({
    rowCount: 1000,
    indexCount: 5,
    avgRowSize: 128,
    totalSize: 128000,
    lastUpdated: new Date()
  })
}));

// Mock session manager
jest.mock('../session/manager', () => ({
  sessionManager: {
    getSession: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      clientId: 'test-client',
      mode: 'audit',
      currentUploadId: 'upload_test_202401',
      availableUploadIds: ['upload_test_202401'],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: false
    }),
    createSession: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      clientId: 'test-client',
      mode: 'audit',
      currentUploadId: 'upload_test_202401',
      availableUploadIds: ['upload_test_202401'],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: false
    }),
    applySessionConstraints: jest.fn().mockResolvedValue({
      errors: [],
      modification: {
        modifiedQuery: 'SELECT * FROM test',
        warnings: [],
        appliedConstraints: []
      }
    }),
    getSessionRecommendations: jest.fn().mockResolvedValue([])
  }
}));

// Mock mode manager
jest.mock('../modes', () => ({
  modeManager: {
    getModeConstraints: jest.fn().mockReturnValue({}),
    validateModeTransition: jest.fn().mockReturnValue({ isValid: true }),
    getSessionStats: jest.fn().mockReturnValue({
      mode: 'audit',
      sessionAge: 1000,
      lastActivity: new Date(),
      uploadContext: {
        current: 'upload_test_202401',
        available: 1
      },
      locked: true,
      recommendations: []
    }),
    getCurrentMode: jest.fn().mockReturnValue({
      validateQuery: jest.fn().mockResolvedValue({ isValid: true, errors: [], warnings: [] }),
      modifyQuery: jest.fn().mockResolvedValue({ modifiedQuery: 'SELECT * FROM test', warnings: [] }),
      getConstraints: jest.fn().mockReturnValue({}),
      getAvailableActions: jest.fn().mockReturnValue(['analyze', 'report'])
    }),
    initializeMode: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      clientId: 'test-client',
      mode: 'audit',
      currentUploadId: 'upload_test_202401',
      availableUploadIds: ['upload_test_202401'],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: true
    }),
    applyScopingToQuery: jest.fn().mockImplementation((query) => query),
    isSessionValid: jest.fn().mockReturnValue(true),
    updateSessionActivity: jest.fn().mockImplementation((ctx) => ({ ...ctx, lastActivity: new Date() }))
  },
  WorkflowModeFactory: class MockWorkflowModeFactory {
    createMode() { return { validateQuery: jest.fn(), modifyQuery: jest.fn() }; }
    getAvailableModes() { return ['audit', 'lending']; }
    validateModeConfig() { return true; }
  },
  WorkflowModeManager: class MockWorkflowModeManager {
    getCurrentMode() { return { validateQuery: jest.fn(), modifyQuery: jest.fn() }; }
    canSwitchMode() { return false; }
    initializeMode() { return Promise.resolve({ sessionId: 'test', clientId: 'test', mode: 'audit' }); }
  }
}))

// Global test timeout
jest.setTimeout(10000);

// Global beforeEach to clear mocks
beforeEach(() => {
  jest.clearAllMocks();
});