// Mock the config module
jest.mock('@/config', () => ({
  config: {
    queryLimits: {
      timeoutMs: 5000
    }
  }
}));

import { QueryGovernor } from '../governor';

describe('QueryGovernor', () => {
  describe('govern', () => {
    it('should inject TOP clause for queries without limits', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.govern(query, '123', 'audit', 100);
      
      expect(result.isValid).toBe(true);
      expect(result.modifiedQuery).toContain('SELECT TOP 100');
      expect(result.warnings).toContain(expect.stringContaining('Added TOP clause'));
    });

    it('should not modify queries that already have TOP clause', () => {
      const query = 'SELECT TOP 50 * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.govern(query, '123', 'audit', 100);
      
      expect(result.modifiedQuery).toBeUndefined();
    });

    it('should inject client_id filter for audit mode when missing', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE status = \'active\'';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.isValid).toBe(true);
      expect(result.modifiedQuery).toContain('client_id = \'123\'');
      expect(result.warnings).toContain(expect.stringContaining('Added CLIENT_ID filtering'));
    });

    it('should not inject client_id filter when already present', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      // Should still inject TOP clause but not client_id
      const warnings = result.warnings.filter(w => w.includes('CLIENT_ID'));
      expect(warnings).toHaveLength(0);
    });

    it('should inject query timeout hints', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).toContain('OPTION (QUERY_GOVERNOR_COST_LIMIT');
      expect(result.warnings).toContain(expect.stringContaining('Added query timeout hints'));
    });

    it('should not modify queries with existing OPTION clause', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\' OPTION (MAXDOP 1)';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      const timeoutWarnings = result.warnings.filter(w => w.includes('timeout hints'));
      expect(timeoutWarnings).toHaveLength(0);
    });

    it('should provide performance suggestions', () => {
      const query = `
        SELECT u.*, c.name 
        FROM upload_table_client1 u 
        JOIN clients c ON u.client_id = c.id 
        WHERE u.client_id = '123'
        ORDER BY u.created_date DESC
      `;
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      const perfWarnings = result.warnings.filter(w => w.includes('Performance:'));
      expect(perfWarnings.length).toBeGreaterThan(0);
    });

    it('should handle lending mode differently than audit mode', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE status = \'active\'';
      const auditResult = QueryGovernor.govern(query, '123', 'audit');
      const lendingResult = QueryGovernor.govern(query, '123', 'lending');
      
      // Audit mode should inject client_id, lending mode should not
      expect(auditResult.modifiedQuery).toContain('client_id = \'123\'');
      expect(lendingResult.modifiedQuery).not.toContain('client_id = \'123\'');
    });
  });

  describe('injectTopClause', () => {
    it('should inject TOP clause in correct position', () => {
      const testCases = [
        {
          input: 'SELECT * FROM table',
          expected: 'SELECT TOP 100 * FROM table'
        },
        {
          input: 'SELECT DISTINCT name FROM table',
          expected: 'SELECT TOP 100 DISTINCT name FROM table'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = QueryGovernor.govern(input, '123', 'audit', 100);
        expect(result.modifiedQuery).toBe(expected);
      });
    });

    it('should not inject TOP for non-SELECT queries', () => {
      const query = 'UPDATE table SET processed = 1';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).not.toContain('TOP');
    });
  });

  describe('injectClientIdFilter', () => {
    it('should add WHERE clause when none exists', () => {
      const query = 'SELECT * FROM upload_table_client1';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).toContain('WHERE client_id = \'123\'');
    });

    it('should add to existing WHERE clause', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE status = \'active\'';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).toContain('client_id = \'123\' AND (status = \'active\')');
    });

    it('should handle queries with ORDER BY correctly', () => {
      const query = 'SELECT * FROM upload_table_client1 ORDER BY created_date';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).toContain('WHERE client_id = \'123\' ORDER BY created_date');
    });

    it('should handle queries with GROUP BY correctly', () => {
      const query = 'SELECT COUNT(*) FROM upload_table_client1 GROUP BY category';
      const result = QueryGovernor.govern(query, '123', 'audit');
      
      expect(result.modifiedQuery).toContain('WHERE client_id = \'123\' GROUP BY category');
    });
  });

  describe('adaptiveGovernance', () => {
    it('should be more restrictive under high system load', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      
      const lowLoadResult = QueryGovernor.adaptiveGovernance(query, 'low', '123', 'audit');
      const highLoadResult = QueryGovernor.adaptiveGovernance(query, 'high', '123', 'audit');
      
      // High load should have more restrictive limits
      expect(highLoadResult.modifiedQuery).toContain('TOP 100');
      expect(lowLoadResult.modifiedQuery).toContain('TOP 1000');
    });

    it('should block complex queries under high load', () => {
      const complexQuery = `
        SELECT u.*, 
               (SELECT COUNT(*) FROM upload_table_2 WHERE client_id = u.client_id),
               (SELECT COUNT(*) FROM upload_table_3 WHERE client_id = u.client_id)
        FROM upload_table_client1 u 
        JOIN table2 t2 ON u.id = t2.upload_id
        JOIN table3 t3 ON t2.id = t3.ref_id
        JOIN table4 t4 ON t3.id = t4.ref_id
        WHERE u.client_id = '123'
      `;
      
      const lowLoadResult = QueryGovernor.adaptiveGovernance(complexQuery, 'low', '123', 'audit');
      const criticalLoadResult = QueryGovernor.adaptiveGovernance(complexQuery, 'critical', '123', 'audit');
      
      expect(lowLoadResult.isValid).toBe(true);
      expect(criticalLoadResult.isValid).toBe(false);
      expect(criticalLoadResult.errors).toContain(expect.stringContaining('Query blocked due to critical system load'));
    });
  });

  describe('enforceEmergencyLimits', () => {
    it('should apply very restrictive limits', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.enforceEmergencyLimits(query);
      
      expect(result).toContain('TOP 10');
      expect(result).toContain('QUERY_GOVERNOR_COST_LIMIT 5');
    });
  });

  describe('sanitizeForSafety', () => {
    it('should remove dangerous elements', () => {
      const query = `
        SELECT * FROM table -- comment
        WHERE id = 1; /* another comment */
      `;
      const sanitized = QueryGovernor.sanitizeForSafety(query);
      
      expect(sanitized).not.toContain('-- comment');
      expect(sanitized).not.toContain('/* another comment */');
      expect(sanitized).not.toContain(';');
      expect(sanitized).toBe('SELECT * FROM table WHERE id = 1');
    });
  });

  describe('needsGovernance', () => {
    it('should identify queries that need governance', () => {
      const query = 'SELECT * FROM regular_table WHERE status = \'active\'';
      const result = QueryGovernor.needsGovernance(query);
      
      expect(result.needs).toBe(true);
      expect(result.reasons).toContain('No result limit specified');
      expect(result.reasons).toContain('Missing CLIENT_ID filtering');
      expect(result.interventions).toContain('Add TOP clause');
      expect(result.interventions).toContain('Add CLIENT_ID filter');
    });

    it('should identify queries that don\'t need governance', () => {
      const query = 'SELECT TOP 100 * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryGovernor.needsGovernance(query);
      
      expect(result.needs).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should identify high complexity queries', () => {
      const complexQuery = `
        SELECT u.*, 
               (SELECT COUNT(*) FROM upload_table_2 WHERE client_id = u.client_id)
        FROM upload_table_client1 u 
        JOIN table2 t2 ON u.id = t2.upload_id
        JOIN table3 t3 ON t2.id = t3.ref_id
        WHERE u.client_id = '123'
        GROUP BY u.id
        HAVING COUNT(*) > 5
        ORDER BY u.created_date DESC
      `;
      
      const result = QueryGovernor.needsGovernance(complexQuery);
      
      expect(result.needs).toBe(true);
      expect(result.reasons).toContain('High query complexity');
      expect(result.interventions).toContain('Add performance hints');
    });
  });
});