// Jest setup file for safety tests

// Mock the config module
jest.mock('@/config', () => ({
  config: {
    redis: {
      url: 'redis://localhost:6379',
      password: undefined
    },
    queryLimits: {
      timeoutMs: 5000,
      maxResults: 1000
    }
  }
}));

// Mock the uploadTableHelpers module
jest.mock('@/db/uploadTableHelpers', () => ({
  validateUploadTable: jest.fn().mockResolvedValue(true)
}));

// Global test timeout
jest.setTimeout(10000);