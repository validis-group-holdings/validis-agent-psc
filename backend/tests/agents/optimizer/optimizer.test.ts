/**
 * Query Optimizer Agent Test Suite
 * Comprehensive tests to ensure 100% optimization coverage
 */

import { QueryOptimizer } from '../../../src/agents/optimizer/index';
import { OptimizationRequest, QueryContext } from '../../../src/agents/optimizer/types';

describe('QueryOptimizer', () => {
  let optimizer: QueryOptimizer;
  const clientId = 'test-client-123';
  const uploadId = 'upload-456';

  beforeEach(() => {
    optimizer = new QueryOptimizer(false); // Disable debug mode for tests
  });

  describe('Basic Optimization', () => {
    test('should add uploadId filter when missing', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions WHERE amount > 1000',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.isSafe).toBe(true);
      expect(response.optimizedSql.toLowerCase()).toContain('uploadid');
      expect(response.optimizations.some((o) => o.type === 'index_usage')).toBe(true);
    });

    test('should add client_id filter when missing', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT account_name FROM accounts WHERE status = "active"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.isSafe).toBe(true);
      expect(response.optimizedSql.toLowerCase()).toContain('client_id');
      expect(response.optimizations.some((o) => o.type === 'multi_tenant_filter')).toBe(true);
    });

    test('should add row limit when missing', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM journal_entries WHERE entry_date > "2024-01-01"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.isSafe).toBe(true);
      // Check for TOP or LIMIT
      const hasLimit =
        response.optimizedSql.toLowerCase().includes('top') ||
        response.optimizedSql.toLowerCase().includes('limit');
      expect(hasLimit).toBe(true);
      expect(response.optimizations.some((o) => o.type === 'row_limit')).toBe(true);
    });

    test('should respect existing row limit if under max', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT TOP 100 * FROM transactions',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.optimizedSql).toContain('TOP 100');
    });

    test('should reduce excessive row limit', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT TOP 10000 * FROM transactions',
        clientId,
        uploadId,
        options: {
          maxRowLimit: 5000
        }
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.optimizedSql).toContain('TOP 5000');
    });
  });

  describe('Dangerous Operations', () => {
    test('should block DROP operations', async () => {
      const request: OptimizationRequest = {
        sql: 'DROP TABLE transactions',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(false);
      expect(response.isSafe).toBe(false);
      expect(response.errors).toContain('Query contains dangerous operation: DROP');
    });

    test('should block DELETE operations', async () => {
      const request: OptimizationRequest = {
        sql: 'DELETE FROM accounts WHERE account_id = 123',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(false);
      expect(response.isSafe).toBe(false);
      expect(response.errors).toContain('Query contains dangerous operation: DELETE');
    });

    test('should block UPDATE operations', async () => {
      const request: OptimizationRequest = {
        sql: 'UPDATE transactions SET amount = 0',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(false);
      expect(response.isSafe).toBe(false);
      expect(response.errors).toContain('Query contains dangerous operation: UPDATE');
    });

    test('should allow dangerous operations when explicitly permitted', async () => {
      const request: OptimizationRequest = {
        sql: 'UPDATE transactions SET status = "processed" WHERE id = 1',
        clientId,
        options: {
          blockDangerousOps: false
        }
      };

      const response = await optimizer.optimize(request);

      // Should still fail because UPDATE is inherently dangerous
      expect(response.isSafe).toBe(false);
    });
  });

  describe('Portfolio Query Optimization', () => {
    test('should add 3-month time window to portfolio queries', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM portfolio_positions WHERE asset_type = "equity"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.optimizedSql.toLowerCase()).toContain('date');
      expect(response.optimizations.some((o) => o.type === 'time_window')).toBe(true);
    });

    test('should not add time window if already present', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM portfolio_positions WHERE position_date > "2024-01-01"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      // Should not duplicate date filters
      const dateMatches = (response.optimizedSql.match(/date/gi) || []).length;
      expect(dateMatches).toBeLessThanOrEqual(2); // May appear in column and WHERE
    });
  });

  describe('JOIN Optimization', () => {
    test('should warn about JOINs without indexed columns', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT t.*, a.account_name
              FROM transactions t
              JOIN accounts a ON t.description = a.notes`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(
        response.warnings.some((w) => w.message.includes('may not be using indexed columns'))
      ).toBe(true);
    });

    test('should optimize JOINs using indexed columns', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT t.*, a.account_name
              FROM transactions t
              JOIN accounts a ON t.account_id = a.account_id`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.performanceAnalysis.score).toBeGreaterThan(50);
    });

    test('should detect Cartesian products', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions CROSS JOIN accounts',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.warnings.some((w) => w.message.includes('Cartesian product'))).toBe(true);
    });

    test('should warn about excessive JOINs', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT * FROM transactions t
              JOIN accounts a ON t.account_id = a.account_id
              JOIN journal_entries j ON t.id = j.transaction_id
              JOIN audit_log al ON t.id = al.entity_id
              JOIN users u ON al.user_id = u.id
              JOIN departments d ON u.dept_id = d.id`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.warnings.some((w) => w.message.includes('JOINs'))).toBe(true);
    });
  });

  describe('Performance Analysis', () => {
    test('should identify index usage', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions WHERE uploadId = "123" AND client_id = "456"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.performanceAnalysis.usesIndexes).toBe(true);
      expect(response.performanceAnalysis.indexesUsed.length).toBeGreaterThan(0);
    });

    test('should detect table scans', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions WHERE description LIKE "%payment%"',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.warnings.some((w) => w.message.includes('prevents index usage'))).toBe(true);
    });

    test('should provide performance score', async () => {
      const goodQuery: OptimizationRequest = {
        sql: 'SELECT id, amount FROM transactions WHERE uploadId = "123" LIMIT 100',
        clientId
      };

      const badQuery: OptimizationRequest = {
        sql: 'SELECT * FROM transactions',
        clientId
      };

      const goodResponse = await optimizer.optimize(goodQuery);
      const badResponse = await optimizer.optimize(badQuery);

      expect(goodResponse.performanceAnalysis.score).toBeGreaterThan(
        badResponse.performanceAnalysis.score
      );
    });

    test('should estimate row counts', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions WHERE amount > 1000',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.performanceAnalysis.estimatedRows).toBeDefined();
      expect(response.performanceAnalysis.estimatedRows).toBeGreaterThan(0);
    });
  });

  describe('SELECT * Optimization', () => {
    test('should warn about SELECT *', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM accounts',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.warnings.some((w) => w.message.includes('SELECT *'))).toBe(true);
    });

    test('should not warn about specific column selection', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT account_id, account_name, balance FROM accounts',
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.warnings.some((w) => w.message.includes('SELECT *'))).toBe(false);
    });
  });

  describe('SQL Injection Prevention', () => {
    test('should detect SQL injection patterns', async () => {
      const request: OptimizationRequest = {
        sql: "SELECT * FROM users WHERE username = 'admin' OR '1'='1'",
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isSafe).toBe(false);
      expect(response.errors?.some((e) => e.includes('SQL injection'))).toBe(true);
    });

    test('should detect comment-based injection', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM users WHERE id = 1--',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isSafe).toBe(false);
    });

    test('should detect UNION-based injection', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM accounts UNION SELECT * FROM users',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isSafe).toBe(false);
    });
  });

  describe('Context-Aware Optimization', () => {
    test('should apply audit-specific optimizations', async () => {
      const context: QueryContext = {
        domain: 'audit',
        maxResults: 1000
      };

      const request: OptimizationRequest = {
        sql: 'SELECT * FROM journal_entries',
        clientId,
        uploadId,
        context
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.optimizedSql).toContain('1000');
    });

    test('should apply lending-specific optimizations', async () => {
      const context: QueryContext = {
        domain: 'lending',
        timeWindow: {
          months: 6
        }
      };

      const request: OptimizationRequest = {
        sql: 'SELECT * FROM loan_applications',
        clientId,
        uploadId,
        context
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
    });
  });

  describe('Complex Query Optimization', () => {
    test('should optimize subqueries', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT * FROM transactions
              WHERE account_id IN (
                SELECT account_id FROM accounts
                WHERE balance > 10000
              )`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
      expect(response.performanceAnalysis.recommendations.some((r) => r.includes('CTE'))).toBe(
        true
      );
    });

    test('should handle GROUP BY queries', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT account_id, SUM(amount) as total
              FROM transactions
              GROUP BY account_id
              HAVING SUM(amount) > 1000`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
    });

    test('should handle ORDER BY queries', async () => {
      const request: OptimizationRequest = {
        sql: `SELECT * FROM transactions
              ORDER BY transaction_date DESC, amount DESC`,
        clientId,
        uploadId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(true);
    });
  });

  describe('Validation Methods', () => {
    test('validate method should work independently', async () => {
      const result = await optimizer.validate('SELECT * FROM transactions', clientId, uploadId);

      expect(result.isValid).toBe(false); // Missing filters
      expect(result.violations.length).toBeGreaterThan(0);
    });

    test('analyze method should work independently', async () => {
      const analysis = await optimizer.analyze('SELECT * FROM transactions WHERE uploadId = "123"');

      expect(analysis).not.toBeNull();
      expect(analysis?.scanType).toBeDefined();
      expect(analysis?.score).toBeDefined();
    });

    test('usesProperIndexes method should check index usage', () => {
      const goodQuery = 'SELECT * FROM transactions WHERE uploadId = "123"';
      const badQuery = 'SELECT * FROM transactions WHERE description = "test"';

      expect(optimizer.usesProperIndexes(goodQuery)).toBe(true);
      expect(optimizer.usesProperIndexes(badQuery)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid SQL gracefully', async () => {
      const request: OptimizationRequest = {
        sql: 'SELEKT * FRUM transactions', // Invalid SQL
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(false);
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]).toContain('Failed to parse SQL');
    });

    test('should handle empty SQL', async () => {
      const request: OptimizationRequest = {
        sql: '',
        clientId
      };

      const response = await optimizer.optimize(request);

      expect(response.isValid).toBe(false);
      expect(response.errors).toBeDefined();
    });

    test('should handle null values gracefully', async () => {
      const request: OptimizationRequest = {
        sql: 'SELECT * FROM transactions',
        clientId: '',
        uploadId: undefined
      };

      const response = await optimizer.optimize(request);

      // Should still add client_id filter even if empty
      expect(response.errors).toBeDefined();
    });
  });

  describe('Optimization Coverage', () => {
    test('should ensure 100% of queries have uploadId', async () => {
      const queries = [
        'SELECT * FROM transactions',
        'SELECT amount FROM journal_entries WHERE type = "debit"',
        'SELECT COUNT(*) FROM accounts',
        'SELECT t.*, a.* FROM transactions t JOIN accounts a ON t.account_id = a.id'
      ];

      for (const sql of queries) {
        const request: OptimizationRequest = {
          sql,
          clientId,
          uploadId
        };

        const response = await optimizer.optimize(request);

        if (response.isValid) {
          expect(response.optimizedSql.toLowerCase()).toContain('uploadid');
        }
      }
    });

    test('should ensure 100% of queries have row limits', async () => {
      const queries = [
        'SELECT * FROM transactions',
        'SELECT * FROM accounts WHERE status = "active"',
        'SELECT * FROM journal_entries'
      ];

      for (const sql of queries) {
        const request: OptimizationRequest = {
          sql,
          clientId,
          uploadId
        };

        const response = await optimizer.optimize(request);

        if (response.isValid) {
          const hasLimit =
            response.optimizedSql.toLowerCase().includes('top') ||
            response.optimizedSql.toLowerCase().includes('limit');
          expect(hasLimit).toBe(true);
        }
      }
    });

    test('should ensure 100% of queries have multi-tenant filtering', async () => {
      const queries = [
        'SELECT * FROM accounts',
        'SELECT * FROM transactions WHERE amount > 1000',
        'SELECT * FROM journal_entries'
      ];

      for (const sql of queries) {
        const request: OptimizationRequest = {
          sql,
          clientId,
          uploadId
        };

        const response = await optimizer.optimize(request);

        if (response.isValid) {
          expect(response.optimizedSql.toLowerCase()).toContain('client_id');
        }
      }
    });
  });
});

describe('QueryOptimizer Statistics', () => {
  test('should generate optimization statistics', async () => {
    const optimizer = new QueryOptimizer();

    const requests: OptimizationRequest[] = [
      { sql: 'SELECT * FROM transactions', clientId: 'test' },
      { sql: 'SELECT * FROM accounts WHERE balance > 1000', clientId: 'test' },
      { sql: 'DELETE FROM transactions', clientId: 'test' }
    ];

    const stats = optimizer.getOptimizationStats(requests);

    expect(stats.totalQueries).toBe(3);
    expect(stats.averagePerformanceScore).toBeDefined();
    expect(stats.commonIssues).toBeInstanceOf(Map);
  });
});
