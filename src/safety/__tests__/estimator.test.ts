import { QueryCostEstimator } from '../estimator';

// Mock the uploadTableHelpers module
jest.mock('@/db/uploadTableHelpers', () => ({
  getTableStatistics: jest.fn()
}));

const { getTableStatistics } = require('@/db/uploadTableHelpers');

describe('QueryCostEstimator', () => {
  const mockGetTableStatistics = getTableStatistics as jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock for table statistics
    mockGetTableStatistics.mockResolvedValue({
      tableName: 'upload_table_test',
      rowCount: 10000,
      lastUpdated: new Date(),
      hasIndexes: true,
      avgRowSize: 500
    });
  });

  describe('quickCostCheck', () => {
    it('should accept simple queries', () => {
      const result = QueryCostEstimator.quickCostCheck(
        'SELECT * FROM upload_table_test WHERE CLIENT_ID = "client123"'
      );

      expect(result.isAcceptable).toBe(true);
      expect(result.estimatedComplexity).toBe('low');
    });

    it('should reject queries with too many tables', () => {
      const query = `
        SELECT * FROM table1
        JOIN table2 ON table1.id = table2.id
        JOIN table3 ON table2.id = table3.id
        JOIN table4 ON table3.id = table4.id
        JOIN table5 ON table4.id = table5.id
        JOIN table6 ON table5.id = table6.id
        JOIN table7 ON table6.id = table7.id
        JOIN table8 ON table7.id = table8.id
      `;

      const result = QueryCostEstimator.quickCostCheck(query);
      
      expect(result.isAcceptable).toBe(false);
      expect(result.reason).toContain('too many tables');
    });

    it('should reject multi-table queries without WHERE clause', () => {
      const query = 'SELECT * FROM upload_table_test JOIN another_table ON upload_table_test.id = another_table.id';

      const result = QueryCostEstimator.quickCostCheck(query);
      
      expect(result.isAcceptable).toBe(false);
      expect(result.reason).toContain('Multi-table query without WHERE clause');
    });
  });

  describe('estimate', () => {
    it('should provide cost estimates for simple queries', async () => {
      const result = await QueryCostEstimator.estimate(
        'SELECT * FROM upload_table_test WHERE CLIENT_ID = "client123"'
      );

      expect(result.estimatedRows).toBeGreaterThan(0);
      expect(result.estimatedTime).toBeGreaterThan(0);
      expect(result.riskLevel).toEqual(expect.any(String));
      expect(result.recommendations).toEqual(expect.any(Array));
    });

    it('should handle table statistics errors gracefully', async () => {
      mockGetTableStatistics.mockResolvedValue(null);

      const result = await QueryCostEstimator.estimate(
        'SELECT * FROM upload_table_test WHERE CLIENT_ID = "client123"'
      );

      // Should still provide estimates with defaults
      expect(result.estimatedRows).toBeGreaterThan(0);
      expect(result.estimatedTime).toBeGreaterThan(0);
      expect(result.riskLevel).toEqual(expect.any(String));
    });
  });
});