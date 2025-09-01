import { QueryValidator } from '../validator';

// Mock the uploadTableHelpers module
jest.mock('@/db/uploadTableHelpers', () => ({
  validateUploadTable: jest.fn()
}));

// Mock the config module
jest.mock('@/config', () => ({
  config: {
    queryLimits: {
      timeoutMs: 5000
    }
  }
}));

import { validateUploadTable } from '@/db/uploadTableHelpers';

describe('QueryValidator', () => {
  const mockValidateUploadTable = validateUploadTable as jest.MockedFunction<typeof validateUploadTable>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateUploadTable.mockResolvedValue(true);
  });

  describe('validate', () => {
    it('should validate a safe SELECT query with upload table and client_id filter', async () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockValidateUploadTable).toHaveBeenCalledWith('upload_table_client1', '123');
    });

    it('should reject non-SELECT queries', async () => {
      const query = 'UPDATE upload_table_client1 SET processed = 1 WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Only SELECT queries are allowed for data analysis');
    });

    it('should reject queries without upload tables', async () => {
      const query = 'SELECT * FROM regular_table WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Query must use upload tables as the primary entry point for data access');
    });

    it('should reject audit mode queries without client_id filter', async () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE status = \'active\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Query must include CLIENT_ID filtering for audit workflow mode');
    });

    it('should allow lending mode queries without client_id filter', async () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE status = \'active\'';
      const result = await QueryValidator.validate(query, '123', 'lending');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject queries with dangerous patterns', async () => {
      const query = 'SELECT * FROM upload_table_client1; DROP TABLE users;';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle upload table validation failures', async () => {
      mockValidateUploadTable.mockResolvedValue(false);
      
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Upload table \'upload_table_client1\' not found or not accessible for client 123');
    });

    it('should generate warnings for non-upload tables', async () => {
      const query = `
        SELECT u.*, r.name 
        FROM upload_table_client1 u 
        JOIN regular_table r ON u.id = r.upload_id 
        WHERE u.client_id = '123'
      `;
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.warnings).toContainEqual(expect.stringContaining('Query accesses non-upload tables: regular_table'));
    });

    it('should generate performance warnings', async () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE name LIKE \'%test%\' AND client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.warnings).toContainEqual(expect.stringContaining('LIKE with leading wildcard detected'));
    });
  });

  describe('quickValidate', () => {
    it('should quickly validate safe queries', () => {
      const query = 'SELECT * FROM upload_table WHERE client_id = \'123\'';
      const result = QueryValidator.quickValidate(query);
      
      expect(result.isValid).toBe(true);
    });

    it('should quickly reject dangerous operations', () => {
      const dangerousQueries = [
        'DROP TABLE users',
        'DELETE FROM upload_table',
        'INSERT INTO upload_table VALUES (1)',
        'UPDATE upload_table SET processed = 1'
      ];

      dangerousQueries.forEach(query => {
        const result = QueryValidator.quickValidate(query);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBeDefined();
      });
    });

    it('should reject multiple statements', () => {
      const query = 'SELECT * FROM table1; SELECT * FROM table2;';
      const result = QueryValidator.quickValidate(query);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Multiple SQL statements are not allowed');
    });
  });

  describe('sanitizeQuery', () => {
    it('should remove SQL comments', () => {
      const query = `
        SELECT * FROM table -- this is a comment
        WHERE id = 1 /* another comment */
      `;
      const sanitized = QueryValidator.sanitizeQuery(query);
      
      expect(sanitized).not.toContain('-- this is a comment');
      expect(sanitized).not.toContain('/* another comment */');
    });

    it('should remove multiple semicolons', () => {
      const query = 'SELECT * FROM table;;;';
      const sanitized = QueryValidator.sanitizeQuery(query);
      
      expect(sanitized).not.toContain(';;;');
    });

    it('should trim whitespace', () => {
      const query = '   SELECT * FROM table   ';
      const sanitized = QueryValidator.sanitizeQuery(query);
      
      expect(sanitized).toBe('SELECT * FROM table');
    });
  });

  describe('isUploadTableName', () => {
    it('should identify upload table patterns', () => {
      const uploadTableNames = [
        'upload_table_client1',
        'client_upload',
        'temp_upload',
        'data_upload_temp'
      ];

      uploadTableNames.forEach(tableName => {
        // Using private method through bracket notation for testing
        const isUpload = (QueryValidator as any).isUploadTableName(tableName);
        expect(isUpload).toBe(true);
      });
    });

    it('should not identify regular table names as upload tables', () => {
      const regularTableNames = [
        'users',
        'clients',
        'transactions',
        'regular_table'
      ];

      regularTableNames.forEach(tableName => {
        const isUpload = (QueryValidator as any).isUploadTableName(tableName);
        expect(isUpload).toBe(false);
      });
    });
  });

  describe('validateUploadTableUsage', () => {
    it('should validate queries with valid upload tables', async () => {
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(mockValidateUploadTable).toHaveBeenCalledWith('upload_table_client1', '123');
      expect(result.isValid).toBe(true);
    });

    it('should handle database validation errors gracefully', async () => {
      mockValidateUploadTable.mockRejectedValue(new Error('Database connection failed'));
      
      const query = 'SELECT * FROM upload_table_client1 WHERE client_id = \'123\'';
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Failed to validate upload table'));
    });
  });

  describe('validateComplexity', () => {
    it('should warn about high complexity queries', async () => {
      const complexQuery = `
        SELECT u.*, 
               (SELECT COUNT(*) FROM upload_table_2 WHERE client_id = u.client_id) as count1,
               (SELECT COUNT(*) FROM upload_table_3 WHERE client_id = u.client_id) as count2
        FROM upload_table_client1 u 
        JOIN table2 t2 ON u.id = t2.upload_id
        JOIN table3 t3 ON t2.id = t3.ref_id
        JOIN table4 t4 ON t3.id = t4.ref_id
        WHERE u.client_id = '123'
        GROUP BY u.id
        HAVING COUNT(*) > 5
        ORDER BY u.created_date DESC
      `;
      
      const result = await QueryValidator.validate(complexQuery, '123', 'audit');
      
      expect(result.warnings).toContainEqual(expect.stringContaining('High complexity query detected'));
    });

    it('should warn about queries with many tables', async () => {
      const query = `
        SELECT * 
        FROM upload_table_1 u1
        JOIN upload_table_2 u2 ON u1.id = u2.ref_id
        JOIN upload_table_3 u3 ON u2.id = u3.ref_id
        JOIN upload_table_4 u4 ON u3.id = u4.ref_id
        JOIN upload_table_5 u5 ON u4.id = u5.ref_id
        JOIN upload_table_6 u6 ON u5.id = u6.ref_id
        WHERE u1.client_id = '123'
      `;
      
      const result = await QueryValidator.validate(query, '123', 'audit');
      
      expect(result.warnings).toContainEqual(expect.stringContaining('Query joins'));
      expect(result.warnings).toContainEqual(expect.stringContaining('tables'));
    });
  });
});