import { QueryQueueManager } from '../queue';

// Mock dependencies
jest.mock('@/db/uploadTableHelpers', () => ({
  executeSecureQuery: jest.fn().mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'test' }],
    rowCount: 1,
    executionTime: 100
  })
}));

describe('QueryQueueManager', () => {
  let queueManager: QueryQueueManager;

  beforeEach(() => {
    // Create a new instance for each test
    QueryQueueManager['instance'] = undefined as any;
    queueManager = new QueryQueueManager(2, 10);
  });

  afterEach(() => {
    queueManager.stopProcessing();
  });

  describe('enqueueQuery', () => {
    it('should enqueue queries successfully', async () => {
      const result = await queueManager.enqueueQuery(
        'SELECT * FROM upload_table_test',
        'client123',
        'audit',
        5
      );

      expect(result.queryId).toBeDefined();
      expect(result.estimatedWait).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getQueueStats', () => {
    it('should return accurate queue statistics', () => {
      const stats = queueManager.getQueueStats();
      
      expect(stats.queued).toBeDefined();
      expect(stats.executing).toBeDefined();
      expect(stats.maxConcurrent).toBe(2);
      expect(stats.maxQueueSize).toBe(10);
    });
  });
});