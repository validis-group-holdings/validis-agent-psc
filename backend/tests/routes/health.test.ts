import request from 'supertest';
import express from 'express';
import healthRoutes from '../../src/routes/health';

describe('Health Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', healthRoutes);
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('services');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
    });
  });

  describe('GET /api/health/liveness', () => {
    it('should return alive status', async () => {
      const response = await request(app)
        .get('/api/health/liveness')
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body).toEqual({
        status: 'alive',
        timestamp: expect.any(String)
      });
    });
  });

  describe('GET /api/health/readiness', () => {
    it('should return readiness status', async () => {
      const response = await request(app)
        .get('/api/health/readiness')
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('checks');
      expect(typeof response.body.ready).toBe('boolean');
    });
  });
});
