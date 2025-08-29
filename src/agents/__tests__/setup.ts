/**
 * Test setup for agent components
 * 
 * This file configures the testing environment for the agent pipeline tests.
 * It sets up mocks and shared utilities used across all agent tests.
 */

import { config } from 'dotenv';

// Load environment variables for testing
config();

// Mock environment variables if not set
if (!process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
}

if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://localhost:6379';
}

// Set test environment
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  const originalConsole = { ...console };
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    Object.assign(console, originalConsole);
  });
}

// Global test timeout
jest.setTimeout(10000);

// Mock configuration module
jest.mock('../../config', () => ({
  config: {
    anthropic: {
      apiKey: 'test-anthropic-key',
      model: 'claude-3-sonnet-20240229'
    },
    database: {
      url: 'postgresql://test:test@localhost:5432/test_db'
    },
    redis: {
      url: 'redis://localhost:6379'
    },
    server: {
      port: 3000,
      environment: 'test'
    }
  }
}));

// Mock database connections
jest.mock('../../db/connection', () => ({
  executeQuery: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('../../db/redis', () => ({
  getRedisClient: jest.fn(),
  cacheKey: jest.fn(),
  getCachedData: jest.fn(),
  setCachedData: jest.fn()
}));

// Mock upload table helpers
jest.mock('../../db/uploadTableHelpers', () => ({
  getClientUploadTables: jest.fn(),
  validateUploadAccess: jest.fn(),
  formatUploadTableQuery: jest.fn()
}));

// Global test utilities
export const createMockTemplate = (overrides: any = {}) => ({
  id: 'test-template',
  name: 'Test Template',
  description: 'A test template for unit testing',
  category: 'audit',
  workflow: 'audit',
  parameters: [],
  sql: 'SELECT * FROM test_table WHERE client_id = :clientId',
  estimatedRuntime: 5,
  complexity: 'low',
  tags: ['test'],
  ...overrides
});

export const createMockQueryRequest = (overrides: any = {}) => ({
  query: 'Test query',
  clientId: 'test-client-123',
  workflowMode: 'audit',
  uploadId: 'test-upload-456',
  ...overrides
});

export const createMockIntentResult = (overrides: any = {}) => ({
  intent: 'test_analysis',
  confidence: 0.8,
  workflow: 'audit',
  suggestedTemplates: ['test-template'],
  reasoning: 'Test reasoning',
  keywords: ['test', 'analysis'],
  ...overrides
});

export const createMockTemplateSelectionResult = (overrides: any = {}) => ({
  selectedTemplate: createMockTemplate(),
  confidence: 0.8,
  reasoning: 'Test template selection',
  alternatives: [],
  matchScore: 0.85,
  ...overrides
});

export const createMockParameterExtractionResult = (overrides: any = {}) => ({
  extractedParameters: {},
  missingRequired: [],
  confidence: 0.8,
  suggestions: [],
  reasoning: 'Test parameter extraction',
  ...overrides
});

// Mock LangChain messages for consistent testing
export const mockLangChainResponse = (content: any) => ({
  content: typeof content === 'string' ? content : JSON.stringify(content)
});

// Test data generators
export const generateTestQuery = (type: 'audit' | 'lending', complexity: 'simple' | 'complex' = 'simple') => {
  const auditQueries = {
    simple: 'Show me journal entries over $10,000',
    complex: 'Analyze journal entries over $10,000 from January 2024 to March 2024, including weekend transactions and round amounts, grouped by account type'
  };

  const lendingQueries = {
    simple: 'Show me cash flow analysis',
    complex: 'Perform comprehensive cash flow analysis for the last 12 months, including seasonal adjustments, working capital impact, and debt service coverage ratios'
  };

  return type === 'audit' ? auditQueries[complexity] : lendingQueries[complexity];
};

// Error simulation utilities
export const simulateLLMError = () => {
  throw new Error('Simulated LLM API error');
};

export const simulateNetworkError = () => {
  throw new Error('Network timeout');
};

export const simulateValidationError = () => ({
  isValid: false,
  errors: ['Simulated validation error'],
  warnings: ['Simulated validation warning']
});

// Assertion helpers
export const expectValidQueryResponse = (response: any) => {
  expect(response).toHaveProperty('success');
  expect(response).toHaveProperty('executionTime');
  expect(typeof response.executionTime).toBe('number');
  
  if (response.success) {
    expect(response).toHaveProperty('template');
    expect(response).toHaveProperty('parameters');
    expect(response).toHaveProperty('metadata');
  } else {
    expect(response).toHaveProperty('error');
    expect(typeof response.error).toBe('string');
  }
};

export const expectValidAnalysisResponse = (response: any) => {
  expect(response).toHaveProperty('intent');
  expect(response).toHaveProperty('templateRecommendation');
  expect(response).toHaveProperty('parameterRequirements');
  
  expect(response.intent).toHaveProperty('intent');
  expect(response.intent).toHaveProperty('confidence');
  expect(typeof response.intent.confidence).toBe('number');
  expect(response.intent.confidence).toBeGreaterThanOrEqual(0);
  expect(response.intent.confidence).toBeLessThanOrEqual(1);
};

export const expectValidTemplateSelectionResult = (result: any) => {
  expect(result).toHaveProperty('selectedTemplate');
  expect(result).toHaveProperty('confidence');
  expect(result).toHaveProperty('reasoning');
  expect(result).toHaveProperty('matchScore');
  
  expect(result.selectedTemplate).toHaveProperty('id');
  expect(result.selectedTemplate).toHaveProperty('name');
  expect(result.selectedTemplate).toHaveProperty('workflow');
};

// Performance test utilities
export const measureExecutionTime = async (fn: () => Promise<any>) => {
  const start = Date.now();
  const result = await fn();
  const executionTime = Date.now() - start;
  return { result, executionTime };
};

export const expectReasonableExecutionTime = (executionTime: number, maxMs: number = 5000) => {
  expect(executionTime).toBeLessThan(maxMs);
  expect(executionTime).toBeGreaterThan(0);
};

console.log('🧪 Agent test setup complete');

// This is a setup file, not a test file - Jest shouldn't complain about no tests
export {};