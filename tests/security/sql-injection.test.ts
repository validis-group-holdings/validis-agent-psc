/**
 * SQL Injection Prevention Tests
 * 
 * Comprehensive testing of SQL injection prevention mechanisms
 * including pattern detection, parameterization, and sanitization.
 */

import request from 'supertest';
import express from 'express';
import { setupTestEnvironment, cleanupTestEnvironment, createMockDbConnection, createMockRedisClient } from '../utils/test-helpers';
import { securityTestData } from '../utils/test-data';

jest.mock('../../src/db/connection');
jest.mock('../../src/db/redis');
jest.mock('@langchain/anthropic');

describe('SQL Injection Prevention Tests', () => {
  let app: express.Application;
  let mockDb: any;
  let mockRedis: any;

  beforeAll(async () => {
    setupTestEnvironment();
    
    mockDb = createMockDbConnection();
    mockRedis = createMockRedisClient();
    
    const { getConnection } = require('../../src/db/connection');
    const { getRedisClient } = require('../../src/db/redis');
    
    getConnection.mockResolvedValue(mockDb);
    getRedisClient.mockReturnValue(mockRedis);
    
    const { default: createApp } = require('../../src/server');
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe('Basic SQL Injection Patterns', () => {
    const baseRequest = {
      clientId: 'security-test-client',
      sessionId: 'security-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    securityTestData.sqlInjectionPayloads.forEach((payload, index) => {
      it(`should block SQL injection payload ${index + 1}: ${payload}`, async () => {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Show account balances where account = '${payload}'`
          })
          .expect(400);

        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('dangerous'),
          blocked: true,
          reason: expect.stringContaining('injection'),
          securityViolation: 'SQL_INJECTION'
        });
      });
    });

    it('should detect comment-based injection attempts', async () => {
      const commentInjections = [
        "'; SELECT * FROM users; --",
        "' OR 1=1; -- comment",
        "'; DROP TABLE accounts; /* comment */",
        "' UNION SELECT password FROM users -- inject"
      ];

      for (const injection of commentInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Find transactions where description = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('comment_injection');
      }
    });

    it('should detect union-based injection attempts', async () => {
      const unionInjections = [
        "' UNION SELECT username, password FROM users",
        "' UNION ALL SELECT * FROM sensitive_data",
        "1' UNION SELECT NULL, version() --",
        "' OR '1'='1' UNION SELECT * FROM admin_users"
      ];

      for (const injection of unionInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Show data where id = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('union_injection');
      }
    });

    it('should detect boolean-based injection attempts', async () => {
      const booleanInjections = [
        "' OR '1'='1",
        "' OR 1=1",
        "' AND '1'='2' OR '1'='1",
        "admin' OR '1'='1' --",
        "' OR 'x'='x"
      ];

      for (const injection of booleanInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Find user where username = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('boolean_injection');
      }
    });
  });

  describe('Advanced Injection Techniques', () => {
    const baseRequest = {
      clientId: 'advanced-security-client',
      sessionId: 'advanced-security-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should detect time-based blind injection', async () => {
      const timeBasedInjections = [
        "'; WAITFOR DELAY '00:00:05'; --",
        "' AND (SELECT COUNT(*) FROM users WHERE username='admin' AND SUBSTRING(password,1,1)='a') > 0 WAITFOR DELAY '00:00:05'",
        "'; IF (1=1) WAITFOR DELAY '00:00:05' --",
        "1' AND SLEEP(5) --"
      ];

      for (const injection of timeBasedInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `SELECT * FROM upload_test_202401 WHERE amount = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('time_based');
      }
    });

    it('should detect error-based injection', async () => {
      const errorBasedInjections = [
        "' AND (SELECT COUNT(*) FROM (SELECT 1 UNION SELECT 2 UNION SELECT 3) AS x GROUP BY x HAVING x > 1) > 0",
        "' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT version()), 0x7e))",
        "' AND (SELECT * FROM (SELECT COUNT(*), CONCAT(version(), FLOOR(RAND(0)*2)) x FROM information_schema.tables GROUP BY x) a)",
        "'; SELECT * FROM non_existent_table; --"
      ];

      for (const injection of errorBasedInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Find records where status = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('error_based');
      }
    });

    it('should detect second-order injection attempts', async () => {
      const secondOrderInjections = [
        "normal_user'; INSERT INTO logs (message) VALUES ('injected'); --",
        "test@email.com'; UPDATE accounts SET balance = 999999 WHERE id = 1; --",
        "Regular Name'; CREATE USER hacker IDENTIFIED BY 'password'; --"
      ];

      for (const injection of secondOrderInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Show customer data where email = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('second_order');
      }
    });
  });

  describe('Injection in Different Contexts', () => {
    const baseRequest = {
      clientId: 'context-security-client',
      sessionId: 'context-security-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should detect injection in WHERE clauses', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "SELECT * FROM upload_test_202401 WHERE account_name = 'Cash' OR '1'='1'"
        })
        .expect(400);

      expect(response.body.securityViolation).toBe('SQL_INJECTION');
      expect(response.body.context).toBe('WHERE_CLAUSE');
    });

    it('should detect injection in ORDER BY clauses', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "SELECT * FROM upload_test_202401 ORDER BY amount; DROP TABLE users; --"
        })
        .expect(400);

      expect(response.body.securityViolation).toBe('SQL_INJECTION');
      expect(response.body.context).toBe('ORDER_BY_CLAUSE');
    });

    it('should detect injection in HAVING clauses', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "SELECT account_name, SUM(amount) FROM upload_test_202401 GROUP BY account_name HAVING SUM(amount) > 1000 OR '1'='1'"
        })
        .expect(400);

      expect(response.body.securityViolation).toBe('SQL_INJECTION');
      expect(response.body.context).toBe('HAVING_CLAUSE');
    });

    it('should detect injection in function parameters', async () => {
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "SELECT * FROM upload_test_202401 WHERE SUBSTRING(account_name, 1, 5) = 'Cash' OR 1=1 --'"
        })
        .expect(400);

      expect(response.body.securityViolation).toBe('SQL_INJECTION');
      expect(response.body.context).toBe('FUNCTION_PARAMETER');
    });
  });

  describe('Encoded and Obfuscated Injection', () => {
    const baseRequest = {
      clientId: 'obfuscation-client',
      sessionId: 'obfuscation-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should detect URL-encoded injection attempts', async () => {
      const encodedInjections = [
        "Cash%27%20OR%20%271%27%3D%271", // 'Cash' OR '1'='1'
        "%27%3B%20DROP%20TABLE%20users%3B%20--", // '; DROP TABLE users; --
        "%27%20UNION%20SELECT%20*%20FROM%20admin", // ' UNION SELECT * FROM admin
      ];

      for (const injection of encodedInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `SELECT * FROM upload_test_202401 WHERE account_name = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('encoded');
      }
    });

    it('should detect hex-encoded injection attempts', async () => {
      const hexInjections = [
        "0x4f52202731273d2731", // OR '1'='1'  
        "0x3b2044524f50205441424c4520757365727320", // ; DROP TABLE users
        "0x27204f522027783d2778", // ' OR 'x'='x
      ];

      for (const injection of hexInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `SELECT * FROM upload_test_202401 WHERE HEX(account_name) = ${injection}`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('hex_encoded');
      }
    });

    it('should detect case variation evasion attempts', async () => {
      const caseVariations = [
        "' oR '1'='1",
        "' UnIoN sElEcT * FrOm users",
        "'; dRoP tAbLe accounts; --",
        "' aNd '1'='1"
      ];

      for (const injection of caseVariations) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Find transactions where description = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('case_variation');
      }
    });
  });

  describe('Whitespace and Comment Evasion', () => {
    const baseRequest = {
      clientId: 'evasion-client',
      sessionId: 'evasion-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should detect whitespace evasion attempts', async () => {
      const whitespaceEvasions = [
        "'/**/OR/**/1=1",
        "'  OR  '1'='1",
        "'%20OR%201=1",
        "'%09OR%091=1", // Tab characters
        "'%0aOR%0a1=1"  // Newline characters
      ];

      for (const injection of whitespaceEvasions) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `SELECT * FROM upload_test_202401 WHERE status = ${injection}`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('whitespace_evasion');
      }
    });

    it('should detect comment-based evasion', async () => {
      const commentEvasions = [
        "'/*comment*/OR/*another*/1=1",
        "'--comment%0aOR 1=1",
        "'#comment%0aOR 1=1",
        "'/**/UNION/**/SELECT/**/*"
      ];

      for (const injection of commentEvasions) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Show data where field = ${injection}`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.pattern).toContain('comment_evasion');
      }
    });
  });

  describe('Database-Specific Injection Patterns', () => {
    const baseRequest = {
      clientId: 'db-specific-client',
      sessionId: 'db-specific-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should detect SQL Server specific injections', async () => {
      const sqlServerInjections = [
        "'; EXEC xp_cmdshell('dir'); --",
        "'; EXEC sp_executesql N'SELECT * FROM users'; --",
        "'; WAITFOR DELAY '00:00:05'; --",
        "' AND (SELECT SYSTEM_USER) = 'sa'",
        "'; INSERT INTO OPENROWSET('SQLOLEDB','server';'uid';'pwd','SELECT * FROM users')"
      ];

      for (const injection of sqlServerInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `SELECT * FROM upload_test_202401 WHERE notes = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.dbSpecific).toBe('SQL_SERVER');
      }
    });

    it('should detect MySQL specific injections', async () => {
      const mysqlInjections = [
        "' AND SLEEP(5) --",
        "' UNION SELECT LOAD_FILE('/etc/passwd') --",
        "' INTO OUTFILE '/tmp/hack.txt' --",
        "' AND (SELECT COUNT(*) FROM information_schema.tables) > 0",
        "'; SET @sql = 'DROP TABLE users'; PREPARE stmt FROM @sql; EXECUTE stmt; --"
      ];

      for (const injection of mysqlInjections) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query: `Find records where comment = '${injection}'`
          })
          .expect(400);

        expect(response.body.securityViolation).toBe('SQL_INJECTION');
        expect(response.body.dbSpecific).toBe('MYSQL');
      }
    });
  });

  describe('Legitimate Query Validation', () => {
    const baseRequest = {
      clientId: 'legitimate-client',
      sessionId: 'legitimate-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    beforeEach(() => {
      mockDb.request().query.mockResolvedValue({
        recordset: [
          { id: 1, account_name: 'Cash', balance: 10000 },
          { id: 2, account_name: 'Accounts Receivable', balance: 25000 }
        ]
      });
    });

    it('should allow legitimate queries with string literals', async () => {
      const legitimateQueries = [
        "SELECT * FROM upload_test_202401 WHERE account_name = 'Cash and Cash Equivalents'",
        "SELECT * FROM upload_test_202401 WHERE description LIKE 'Invoice%'",
        "SELECT * FROM upload_test_202401 WHERE notes = 'Year-end adjustment'",
        "SELECT COUNT(*) FROM upload_test_202401 WHERE status = 'active'"
      ];

      for (const query of legitimateQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      }
    });

    it('should allow complex but safe queries', async () => {
      const complexQueries = [
        `SELECT 
          account_name,
          SUM(amount) as total_amount,
          COUNT(*) as transaction_count
        FROM upload_test_202401 
        WHERE client_id = 'legitimate-client'
          AND transaction_date >= '2024-01-01'
        GROUP BY account_name
        HAVING SUM(amount) > 1000
        ORDER BY total_amount DESC`,
        
        `SELECT 
          t1.account_name,
          t2.balance_change
        FROM upload_test_202401 t1
        INNER JOIN (
          SELECT account_id, SUM(amount) as balance_change
          FROM transactions
          GROUP BY account_id
        ) t2 ON t1.id = t2.account_id
        WHERE t1.client_id = 'legitimate-client'`
      ];

      for (const query of complexQueries) {
        const response = await request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            query
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('Security Event Logging', () => {
    const baseRequest = {
      clientId: 'logging-client',
      sessionId: 'logging-session',
      mode: 'audit' as const,
      uploadId: 'upload_test_202401'
    };

    it('should log injection attempts with full context', async () => {
      const injection = "'; DROP TABLE users; --";
      
      await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: `SELECT * FROM upload_test_202401 WHERE account = '${injection}'`
        })
        .expect(400);

      // Verify comprehensive logging
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/security:incident:/),
        expect.stringContaining(JSON.stringify({
          type: 'SQL_INJECTION',
          clientId: 'logging-client',
          sessionId: 'logging-session',
          payload: injection,
          timestamp: expect.any(String),
          ipAddress: expect.any(String),
          userAgent: expect.any(String)
        })),
        expect.any(Object)
      );
    });

    it('should increment attack counters', async () => {
      await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          query: "SELECT * FROM upload_test_202401 WHERE id = '1' OR '1'='1'"
        })
        .expect(400);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/counter:attacks:logging-client/),
        expect.any(String),
        expect.objectContaining({ EX: expect.any(Number) })
      );
    });

    it('should trigger escalation after repeated attempts', async () => {
      // Simulate multiple injection attempts
      const attacks = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/query')
          .send({
            ...baseRequest,
            sessionId: `escalation-session-${i}`,
            query: `SELECT * FROM upload_test_202401 WHERE id = '${i}' OR '1'='1'`
          })
          .expect(400)
      );

      await Promise.all(attacks);

      // Next legitimate query should also be blocked due to escalation
      const response = await request(app)
        .post('/api/query')
        .send({
          ...baseRequest,
          sessionId: 'legitimate-after-escalation',
          query: "SELECT COUNT(*) FROM upload_test_202401"
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('client temporarily blocked'),
        escalation: true,
        blockDuration: expect.any(Number)
      });
    });
  });

  describe('Real-time Threat Detection', () => {
    it('should detect coordinated injection campaigns', async () => {
      const campaignPayloads = [
        "' OR 1=1 --",
        "' UNION SELECT * FROM users --",
        "'; DROP TABLE accounts; --",
        "' AND (SELECT COUNT(*) FROM admin) > 0 --"
      ];

      // Send coordinated attacks from different sessions
      const attacks = campaignPayloads.map((payload, i) =>
        request(app)
          .post('/api/query')
          .send({
            clientId: 'campaign-client',
            sessionId: `campaign-session-${i}`,
            mode: 'audit',
            uploadId: 'upload_test_202401',
            query: `SELECT * FROM upload_test_202401 WHERE field = '${payload}'`
          })
          .expect(400)
      );

      await Promise.all(attacks);

      // Verify campaign detection
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/threat:campaign:/),
        expect.stringContaining('coordinated_injection'),
        expect.any(Object)
      );
    });

    it('should adapt detection sensitivity based on threat level', async () => {
      // First, establish baseline with normal queries
      mockDb.request().query.mockResolvedValue({ recordset: [] });
      
      await request(app)
        .post('/api/query')
        .send({
          clientId: 'adaptive-client',
          sessionId: 'baseline-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: "SELECT * FROM upload_test_202401 LIMIT 10"
        })
        .expect(200);

      // Then send a suspicious query
      await request(app)
        .post('/api/query')
        .send({
          clientId: 'adaptive-client',
          sessionId: 'suspicious-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: "SELECT * FROM upload_test_202401 WHERE '1'='1'"
        })
        .expect(400);

      // Now even borderline queries should be scrutinized more carefully
      const response = await request(app)
        .post('/api/query')
        .send({
          clientId: 'adaptive-client',
          sessionId: 'borderline-session',
          mode: 'audit',
          uploadId: 'upload_test_202401',
          query: "SELECT * FROM upload_test_202401 WHERE account_name = 'Cash' AND balance > 0"
        })
        .expect(200);

      expect(response.body.metadata.securityScanLevel).toBe('ENHANCED');
    });
  });
});