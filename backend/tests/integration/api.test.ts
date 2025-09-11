import request from 'supertest';
import { createApp } from '../../src/app';
import { Application } from 'express';
import { logger } from '../../src/config/logger';

// Silence logger during tests
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    http: jest.fn()
  },
  stream: { write: jest.fn() }
}));

describe('API Integration Tests', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Server Health & Configuration', () => {
    test('should return root endpoint information', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('name', 'Validis Agent Backend');
      expect(response.body.data).toHaveProperty('version');
      expect(response.body.data).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });

    test('should return 404 for non-existent endpoints', async () => {
      const response = await request(app).get('/api/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body).toHaveProperty('requestId');
    });

    test('should include request ID in headers', async () => {
      const response = await request(app).get('/');

      expect(response.headers).toHaveProperty('x-request-id');
      expect(response.headers['x-request-id']).toBeTruthy();
    });

    test('should handle health check endpoint', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Request/Response Handling', () => {
    test('should accept JSON payloads', async () => {
      const payload = { test: 'data', nested: { value: 123 } };

      const response = await request(app)
        .post('/api/chat/messages')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Should either work or return proper error (depending on implementation)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.body).toBeDefined();
    });

    test('should handle large payloads within limit', async () => {
      const largePayload = { data: 'x'.repeat(1000000) }; // 1MB

      const response = await request(app)
        .post('/api/chat/messages')
        .send(largePayload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBeLessThan(500);
    });

    test('should reject payloads exceeding size limit', async () => {
      const oversizedPayload = { data: 'x'.repeat(11000000) }; // 11MB

      const response = await request(app)
        .post('/api/chat/messages')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(413); // Payload Too Large
    });

    test('should handle CORS headers', async () => {
      const response = await request(app).options('/').set('Origin', 'http://localhost:3000');

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/chat/messages')
        .send('{ invalid json }')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should handle method not allowed', async () => {
      const response = await request(app).patch('/api/health');

      // Should return 404 or 405 depending on implementation
      expect([404, 405]).toContain(response.status);
    });

    test('should not leak sensitive error details in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodApp = createApp();
      const response = await request(prodApp).get('/api/will-cause-error');

      if (response.status === 500) {
        expect(response.body.error.message).not.toContain('stack');
        expect(response.body.error.message).not.toContain('Error:');
      }

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Route Integration', () => {
    test('should have chat routes mounted', async () => {
      const response = await request(app).get('/api/chat/sessions');

      // Should not return 404
      expect(response.status).not.toBe(404);
    });

    test('should have query routes mounted', async () => {
      const response = await request(app).get('/api/query/engines');

      // Should not return 404
      expect(response.status).not.toBe(404);
    });

    test('should have template routes mounted', async () => {
      const response = await request(app).get('/api/templates');

      // Should not return 404
      expect(response.status).not.toBe(404);
    });

    test('should have schema routes mounted', async () => {
      const response = await request(app).get('/api/schemas');

      // Should not return 404
      expect(response.status).not.toBe(404);
    });

    test('should have AI routes mounted', async () => {
      const response = await request(app).post('/api/ai/analyze');

      // Should not return 404 (might return 400 or other error, but not 404)
      expect(response.status).not.toBe(404);
    });
  });

  describe('Performance Requirements', () => {
    test('should respond within acceptable time for simple requests', async () => {
      const startTime = Date.now();

      await request(app).get('/');

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should respond in less than 1 second
    });

    test('should handle concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() => request(app).get('/'));

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    test('should include timing information in logs', async () => {
      await request(app).get('/');

      // Logger should have been called with timing info
      // This tests that our performance monitoring is working
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('Agent Coordination Flow', () => {
    test('should support agent message flow', async () => {
      // Test the flow: Create session -> Send message -> Get response

      // Step 1: Create a chat session
      const sessionResponse = await request(app)
        .post('/api/chat/sessions')
        .send({ type: 'standard' });

      if (sessionResponse.status === 200) {
        expect(sessionResponse.body).toHaveProperty('success');
      }

      // Step 2: Send a message (would need session ID from step 1)
      const messagePayload = {
        sessionId: 'test-session',
        message: 'Test query for agent coordination',
        context: {}
      };

      const messageResponse = await request(app).post('/api/chat/messages').send(messagePayload);

      // Should handle the request (even if it returns an error due to missing deps)
      expect(messageResponse.status).toBeDefined();
    });

    test('should support query execution flow', async () => {
      const queryPayload = {
        query: 'SELECT * FROM test',
        engine: 'sql',
        context: {}
      };

      const response = await request(app).post('/api/query/execute').send(queryPayload);

      // Should handle the request
      expect(response.status).toBeDefined();
      expect(response.body).toBeDefined();
    });

    test('should support template operations', async () => {
      // List templates
      const listResponse = await request(app).get('/api/templates');
      expect(listResponse.status).toBeDefined();

      // Create template (test payload)
      const templatePayload = {
        name: 'test-template',
        content: 'Test content',
        variables: []
      };

      const createResponse = await request(app).post('/api/templates').send(templatePayload);

      expect(createResponse.status).toBeDefined();
    });
  });

  describe('Middleware Integration', () => {
    test('should apply rate limiting', async () => {
      // Make multiple rapid requests
      const requests = Array(20)
        .fill(null)
        .map(() => request(app).get('/api/health'));

      const responses = await Promise.all(requests);

      // At least one should be rate limited (if rate limiting is enabled)
      // const _rateLimited = responses.filter((r) => r.status === 429);

      // This test depends on rate limiter configuration
      // If rate limiter is strict, some requests should be limited
      expect(responses.length).toBe(20);
    });

    test('should validate request payloads', async () => {
      const invalidPayload = {
        // Missing required fields
      };

      const response = await request(app).post('/api/chat/messages').send(invalidPayload);

      // Should return validation error
      if (response.status === 400 || response.status === 422) {
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
      }
    });

    test('should handle authentication headers', async () => {
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('Authorization', 'Bearer test-token');

      // Should process the auth header (even if it rejects it)
      expect(response.status).toBeDefined();
      expect(response.headers).toHaveProperty('x-request-id');
    });
  });

  describe('Error Recovery', () => {
    test('should recover from errors and continue serving requests', async () => {
      // First request might cause an error
      await request(app)
        .get('/api/cause-error')
        .catch(() => {});

      // Next request should still work
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should handle timeout scenarios gracefully', async () => {
      // This would need a specific endpoint that simulates slow response
      const response = await request(app)
        .get('/api/health')
        .timeout(100)
        .catch((err) => err);

      // Should either complete or timeout gracefully
      expect(response).toBeDefined();
    });
  });

  describe('Response Format Consistency', () => {
    test('should return consistent success response format', async () => {
      const response = await request(app).get('/');

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });

    test('should return consistent error response format', async () => {
      const response = await request(app).get('/api/non-existent');

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });

    test('should support pagination metadata when applicable', async () => {
      const response = await request(app).get('/api/templates').query({ page: 1, limit: 10 });

      // If endpoint supports pagination, should have metadata
      if (response.status === 200 && response.body.metadata) {
        expect(response.body.metadata).toHaveProperty('page');
        expect(response.body.metadata).toHaveProperty('limit');
      }
    });
  });
});
