import { QueryParser } from '../parser';

describe('QueryParser', () => {
  describe('parse', () => {
    it('should parse a simple SELECT query correctly', () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = QueryParser.parse(query);
      
      expect(result.tables).toContain('upload_table_client1');
      expect(result.operations).toContain('SELECT');
      expect(result.hasUploadTable).toBe(true);
      expect(result.hasClientIdFilter).toBe(true);
      expect(result.isSelectOnly).toBe(true);
      expect(result.estimatedComplexity).toBe('low');
    });

    it('should detect JOIN operations', () => {
      const query = `
        SELECT u.*, c.name 
        FROM upload_table_client1 u 
        JOIN client_data c ON u.client_id = c.id 
        WHERE u.client_id = '123'
      `;
      const result = QueryParser.parse(query);
      
      expect(result.tables).toEqual(expect.arrayContaining(['upload_table_client1', 'client_data']));
      expect(result.operations).toContain('JOIN');
      expect(result.estimatedComplexity).toBe('medium');
    });

    it('should detect complex queries', () => {
      const query = `
        SELECT u.*, 
               (SELECT COUNT(*) FROM upload_table_client2 WHERE client_id = u.client_id) as related_count
        FROM upload_table_client1 u 
        WHERE u.client_id IN (SELECT id FROM clients WHERE status = 'active')
        ORDER BY u.upload_date DESC
      `;
      const result = QueryParser.parse(query);
      
      expect(result.operations).toContain('SUBQUERY');
      expect(result.operations).toContain('ORDER_BY');
      expect(result.estimatedComplexity).toBe('high');
    });

    it('should detect non-SELECT operations', () => {
      const query = 'UPDATE upload_table_client1 SET processed = 1 WHERE client_id = \'123\'';
      const result = QueryParser.parse(query);
      
      expect(result.isSelectOnly).toBe(false);
      expect(result.operations).toContain('UPDATE');
    });
  });

  describe('extractTables', () => {
    it('should extract table names from FROM clauses', () => {
      const query = 'SELECT * FROM upload_table_client1';
      const result = QueryParser.parse(query);
      
      expect(result.tables).toContain('upload_table_client1');
    });

    it('should extract table names from JOIN clauses', () => {
      const query = 'SELECT * FROM table1 t1 JOIN upload_table_client2 t2 ON t1.id = t2.id';
      const result = QueryParser.parse(query);
      
      expect(result.tables).toEqual(expect.arrayContaining(['table1', 'upload_table_client2']));
    });
  });

  describe('hasUploadTablePattern', () => {
    it('should detect upload table patterns', () => {
      const testCases = [
        'SELECT * FROM upload_table_client1',
        'SELECT * FROM client_upload',
        'SELECT * FROM data_upload_temp',
        'SELECT * FROM temp_upload'
      ];

      testCases.forEach(query => {
        const result = QueryParser.parse(query);
        expect(result.hasUploadTable).toBe(true);
      });
    });

    it('should not detect non-upload tables', () => {
      const query = 'SELECT * FROM regular_table WHERE id = 1';
      const result = QueryParser.parse(query);
      
      expect(result.hasUploadTable).toBe(false);
    });
  });

  describe('hasClientIdFilter', () => {
    it('should detect client_id filtering patterns', () => {
      const testCases = [
        'SELECT * FROM table WHERE client_id = \'123\'',
        'SELECT * FROM table WHERE id = 1 AND client_id = \'123\'',
        'SELECT * FROM table WHERE client_id IN (\'123\', \'456\')'
      ];

      testCases.forEach(query => {
        const result = QueryParser.parse(query);
        expect(result.hasClientIdFilter).toBe(true);
      });
    });

    it('should not detect missing client_id filters', () => {
      const query = 'SELECT * FROM table WHERE status = \'active\'';
      const result = QueryParser.parse(query);
      
      expect(result.hasClientIdFilter).toBe(false);
    });
  });

  describe('hasDangerousPatterns', () => {
    it('should detect SQL injection patterns', () => {
      const dangerousQueries = [
        'SELECT * FROM table; DROP TABLE users;',
        'SELECT * FROM table WHERE id = 1 OR \'1\'=\'1\'',
        'SELECT * FROM table /* comment */ WHERE id = 1',
        'EXEC xp_cmdshell \'dir\''
      ];

      dangerousQueries.forEach(query => {
        const patterns = QueryParser.hasDangerousPatterns(query);
        expect(patterns.length).toBeGreaterThan(0);
      });
    });

    it('should not flag safe queries', () => {
      const safeQuery = 'SELECT * FROM upload_table WHERE client_id = \'123\' AND status = \'active\'';
      const patterns = QueryParser.hasDangerousPatterns(safeQuery);
      
      expect(patterns).toHaveLength(0);
    });
  });

  describe('extractSelectColumns', () => {
    it('should extract column names from SELECT clause', () => {
      const query = 'SELECT id, name, email FROM users';
      const columns = QueryParser.extractSelectColumns(query);
      
      expect(columns).toEqual(['id', 'name', 'email']);
    });

    it('should handle SELECT * queries', () => {
      const query = 'SELECT * FROM users';
      const columns = QueryParser.extractSelectColumns(query);
      
      expect(columns).toEqual(['*']);
    });

    it('should handle column aliases', () => {
      const query = 'SELECT id, name AS full_name FROM users';
      const columns = QueryParser.extractSelectColumns(query);
      
      expect(columns).toContain('name');
    });
  });

  describe('estimateComplexity', () => {
    it('should rate simple queries as low complexity', () => {
      const query = 'SELECT * FROM upload_table WHERE client_id = \'123\'';
      const result = QueryParser.parse(query);
      
      expect(result.estimatedComplexity).toBe('low');
    });

    it('should rate queries with JOINs as medium complexity', () => {
      const query = `
        SELECT u.*, c.name 
        FROM upload_table u 
        JOIN clients c ON u.client_id = c.id 
        WHERE u.client_id = '123'
      `;
      const result = QueryParser.parse(query);
      
      expect(result.estimatedComplexity).toBe('medium');
    });

    it('should rate complex queries as high complexity', () => {
      const query = `
        SELECT u.*, 
               (SELECT COUNT(*) FROM related_table WHERE client_id = u.client_id) as count,
               CASE WHEN u.amount > 1000 THEN 'high' ELSE 'low' END as category
        FROM upload_table u 
        JOIN table2 t2 ON u.id = t2.upload_id
        JOIN table3 t3 ON t2.id = t3.ref_id
        WHERE u.client_id = '123'
        GROUP BY u.id
        HAVING COUNT(*) > 5
        ORDER BY u.created_date DESC
      `;
      const result = QueryParser.parse(query);
      
      expect(result.estimatedComplexity).toBe('high');
    });
  });
});