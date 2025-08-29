/**
 * Test Utilities and Helpers
 * 
 * Provides common utilities for mocking, setup, and validation
 * across the test suites.
 */

import { Request, Response } from 'express';
import { ModeContext, SessionContext, WorkflowMode } from '../../src/modes/types';

export interface MockRequest extends Partial<Request> {
  body: any;
  params: any;
  query: any;
  headers: any;
}

export interface MockResponse extends Partial<Response> {
  statusCode?: number;
  json: jest.Mock;
  status: jest.Mock;
  send: jest.Mock;
}

/**
 * Create mock Express request object
 */
export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides
  };
}

/**
 * Create mock Express response object
 */
export function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
  
  return res;
}

/**
 * Create mock ModeContext for testing
 */
export function createMockModeContext(overrides: Partial<ModeContext> = {}): ModeContext {
  return {
    clientId: 'test-client-123',
    uploadId: 'upload_test_202401',
    sessionId: 'session-123',
    mode: 'audit',
    lockedAt: new Date(),
    ...overrides
  };
}

/**
 * Create mock SessionContext for testing
 */
export function createMockSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'session-123',
    clientId: 'test-client-123',
    mode: 'audit' as WorkflowMode,
    currentUploadId: 'upload_test_202401',
    availableUploadIds: ['upload_test_202401'],
    companyContext: {
      name: 'Test Company',
      uploadId: 'upload_test_202401',
      period: '2024-01'
    },
    createdAt: new Date(),
    lastActivity: new Date(),
    locked: false,
    ...overrides
  };
}

/**
 * Mock Anthropic API response
 */
export function mockAnthropicResponse(content: string = 'Mock AI response') {
  return {
    content: [{ text: content }],
    model: 'claude-3-sonnet-20240229',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    }
  };
}

/**
 * Mock database connection
 */
export function createMockDbConnection() {
  return {
    request: jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({
        recordset: [
          { id: 1, name: 'Test Record' }
        ]
      }),
      input: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        recordset: []
      })
    }),
    close: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined)
  };
}

/**
 * Mock Redis client
 */
export function createMockRedisClient() {
  const store = new Map();
  
  return {
    get: jest.fn().mockImplementation((key: string) => 
      Promise.resolve(store.get(key))
    ),
    set: jest.fn().mockImplementation((key: string, value: string, options?: any) => {
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
      // Simple pattern matching for tests
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Promise.resolve(keys.filter(key => regex.test(key)));
    }),
    flushDb: jest.fn().mockImplementation(() => {
      store.clear();
      return Promise.resolve('OK');
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn().mockResolvedValue(undefined)
  };
}

/**
 * Setup test environment
 */
export function setupTestEnvironment() {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'test_db';
  process.env.DB_USER = 'test_user';
  process.env.DB_PASSWORD = 'test_password';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.ANTHROPIC_API_KEY = 'test-api-key';
  process.env.JWT_SECRET = 'test-jwt-secret';
}

/**
 * Cleanup test environment
 */
export function cleanupTestEnvironment() {
  jest.clearAllMocks();
  jest.restoreAllMocks();
}

/**
 * Wait for async operations to complete
 */
export function waitForAsync(ms: number = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate test SQL queries
 */
export const testQueries = {
  simple: "SELECT * FROM upload_test_202401 WHERE client_id = 'test-client'",
  complex: `
    SELECT 
      u.account_name,
      u.balance,
      u.transaction_date,
      COUNT(*) OVER() as total_count
    FROM upload_test_202401 u
    WHERE u.client_id = 'test-client'
      AND u.transaction_date >= '2024-01-01'
      AND u.balance > 1000
    ORDER BY u.transaction_date DESC
    LIMIT 100
  `,
  dangerous: "SELECT * FROM upload_test_202401; DROP TABLE users; --",
  crossClient: "SELECT * FROM upload_other_client WHERE amount > 1000",
  withJoins: `
    SELECT u.*, c.company_name 
    FROM upload_test_202401 u 
    JOIN companies c ON u.company_id = c.id
  `,
  performanceIssue: "SELECT * FROM upload_test_202401 WHERE description LIKE '%expensive%'",
  sqlInjection: "SELECT * FROM upload_test_202401 WHERE id = '1' OR '1'='1'"
};

/**
 * Test data generators
 */
export const generateTestData = {
  financialRecord: (overrides: any = {}) => ({
    id: Math.floor(Math.random() * 10000),
    account_name: 'Test Account',
    balance: Math.floor(Math.random() * 100000),
    transaction_date: '2024-01-15',
    client_id: 'test-client-123',
    upload_id: 'upload_test_202401',
    ...overrides
  }),

  uploadInfo: (overrides: any = {}) => ({
    upload_id: 'upload_test_202401',
    client_id: 'test-client-123',
    company_name: 'Test Company',
    period: '2024-01',
    status: 'active',
    created_at: new Date(),
    ...overrides
  }),

  auditResult: (overrides: any = {}) => ({
    query: testQueries.simple,
    result: [generateTestData.financialRecord()],
    metadata: {
      rowCount: 1,
      executionTime: 150,
      fromCache: false
    },
    ...overrides
  })
};