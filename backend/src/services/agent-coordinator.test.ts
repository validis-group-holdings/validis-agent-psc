/**
 * Tests for Agent Coordinator Service
 */

import { jest } from '@jest/globals';
import { AgentCoordinator } from './agent-coordinator';
import {
  AgentCoordinationRequest,
  AgentCoordinationResponse,
  AgentCoordinationError,
  AgentWarning
} from '../types/agent.types';
import {
  OrchestratorAgent,
  AgentType,
  IntentType
} from '../agents/orchestrator';
import { LendingAgent } from '../agents/lending';
import { AuditAgent } from '../agents/audit';
import { QueryOptimizer } from '../agents/optimizer';

// Mock the agents
jest.mock('../agents/orchestrator');
jest.mock('../agents/lending');
jest.mock('../agents/audit');
jest.mock('../agents/optimizer');

describe('AgentCoordinator', () => {
  let coordinator: AgentCoordinator;
  let mockOrchestrator: jest.Mocked<OrchestratorAgent>;
  let mockLendingAgent: jest.Mocked<LendingAgent>;
  let mockAuditAgent: jest.Mocked<AuditAgent>;
  let mockOptimizer: jest.Mocked<QueryOptimizer>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create coordinator instance
    coordinator = new AgentCoordinator({
      defaultTimeout: 5000,
      maxRetries: 1,
      enableOptimization: true,
      enableCaching: true,
      cacheTimeout: 60000,
      debug: false
    });

    // Get mocked instances
    mockOrchestrator = (coordinator as any).orchestrator as jest.Mocked<OrchestratorAgent>;
    mockLendingAgent = (coordinator as any).lendingAgent as jest.Mocked<LendingAgent>;
    mockAuditAgent = (coordinator as any).auditAgent as jest.Mocked<AuditAgent>;
    mockOptimizer = (coordinator as any).optimizer as jest.Mocked<QueryOptimizer>;
  });

  afterEach(() => {
    coordinator.shutdown();
  });

  describe('Request Validation', () => {
    it('should reject empty query', async () => {
      const request: AgentCoordinationRequest = {
        query: '',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors).toContain('Query cannot be empty');
    });

    it('should reject missing sessionId', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: '',
        clientId: 'test-client'
      };

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors).toContain('Session ID is required');
    });

    it('should reject missing clientId', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: ''
      };

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors).toContain('Client ID is required');
    });

    it('should validate timeout range', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client',
        options: {
          timeout: 500 // Too low
        }
      };

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors?.[0]).toContain('Timeout must be between');
    });
  });

  describe('Orchestration Flow', () => {
    it('should successfully route to lending agent', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio credit analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock orchestrator response
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis requested',
            keywords: ['portfolio', 'credit']
          },
          requiresClarification: false,
          explanation: 'Routing to lending agent'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      // Mock lending agent response
      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount'],
        explanation: 'Portfolio query generated'
      } as any);

      // Mock optimizer response
      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT company, amount FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [{
          type: 'add_filter',
          applied: true,
          description: 'Added client_id filter'
        }],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: ['idx_client_id'],
          scanType: 'index_scan',
          score: 85,
          warnings: [],
          recommendations: []
        },
        warnings: [],
        explanation: 'Query optimized'
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(response.routing.targetAgent).toBe(AgentType.LENDING);
      expect(response.routing.intent).toBe(IntentType.LENDING);
      expect(response.routing.confidence).toBe(0.9);
      expect(response.finalSql).toBe('SELECT company, amount FROM portfolio WHERE client_id = ?');
      expect(response.domainResponse).toBeDefined();
      expect(response.optimizationResponse).toBeDefined();
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(1);
      expect(mockLendingAgent.processQuery).toHaveBeenCalledTimes(1);
      expect(mockOptimizer.optimize).toHaveBeenCalledTimes(1);
    });

    it('should successfully route to audit agent', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me journal entries for ABC Company',
        sessionId: 'test-session',
        clientId: 'test-client',
        companyName: 'ABC Company'
      };

      // Mock orchestrator response
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.AUDIT,
          intent: {
            intent: IntentType.AUDIT,
            confidence: 0.95,
            reasoning: 'Company-specific audit requested',
            keywords: ['journal', 'company']
          },
          requiresClarification: false,
          explanation: 'Routing to audit agent'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      // Mock audit agent response
      mockAuditAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM journal_entries WHERE company = ?',
        confidence: 0.9,
        queryType: 'journal_analysis',
        involvedTables: ['journal_entries'],
        expectedColumns: ['date', 'description', 'amount'],
        explanation: 'Journal entries query generated',
        auditRisks: [{
          level: 'medium',
          category: 'unusual_activity',
          description: 'Weekend entries detected',
          recommendation: 'Review weekend transactions'
        }]
      } as any);

      // Mock optimizer response
      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM journal_entries WHERE company = ?',
        optimizedSql: 'SELECT date, description, amount FROM journal_entries WHERE company = ? AND client_id = ? LIMIT 1000',
        isValid: true,
        isSafe: true,
        optimizations: [{
          type: 'add_limit',
          applied: true,
          description: 'Added row limit'
        }],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: ['idx_company'],
          scanType: 'index_scan',
          score: 90,
          warnings: [],
          recommendations: []
        },
        warnings: [],
        explanation: 'Query optimized'
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(response.routing.targetAgent).toBe(AgentType.AUDIT);
      expect(response.routing.intent).toBe(IntentType.AUDIT);
      expect(response.warnings).toBeDefined();
      expect(response.warnings?.some(w => w.code.includes('AUDIT_RISK'))).toBe(true);
      expect(mockAuditAgent.processQuery).toHaveBeenCalledTimes(1);
    });

    it('should handle clarification needed', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me the analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock orchestrator response requiring clarification
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.ORCHESTRATOR,
          intent: {
            intent: IntentType.AMBIGUOUS,
            confidence: 0.4,
            reasoning: 'Query is ambiguous',
            keywords: ['analysis']
          },
          requiresClarification: true,
          clarificationPrompt: 'Please specify if you need portfolio or audit analysis',
          explanation: 'Need more information'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(response.routing.requiresClarification).toBe(true);
      expect(response.explanation).toContain('Please specify');
      expect(mockLendingAgent.processQuery).not.toHaveBeenCalled();
      expect(mockAuditAgent.processQuery).not.toHaveBeenCalled();
      expect(mockOptimizer.optimize).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle orchestrator failure', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      mockOrchestrator.orchestrate.mockRejectedValue(new Error('Orchestrator failed'));

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]).toContain('Failed to understand your query');
    });

    it('should handle domain agent failure', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock successful orchestration
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      // Mock lending agent failure
      mockLendingAgent.processQuery.mockRejectedValue(new Error('Database connection failed'));

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors?.[0]).toContain('Failed to process your query');
    });

    it('should handle optimization failure gracefully', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock successful orchestration
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      // Mock successful lending response
      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount'],
        explanation: 'Query generated'
      } as any);

      // Mock optimizer failure
      mockOptimizer.optimize.mockRejectedValue(new Error('Optimization failed'));

      const response = await coordinator.coordinate(request);

      // Should still succeed with original SQL
      expect(response.success).toBe(true);
      expect(response.finalSql).toBe('SELECT * FROM portfolio');
      expect(response.warnings?.some(w => w.code === 'OPTIMIZATION_FAILED')).toBe(true);
    });

    it('should handle timeout', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client',
        options: {
          timeout: 1000 // 1 second timeout
        }
      };

      // Mock orchestrator with delay
      mockOrchestrator.orchestrate.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 2000))
      );

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(response.errors?.[0]).toContain('timed out');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock orchestrator to fail once then succeed
      let callCount = 0;
      mockOrchestrator.orchestrate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({
          routing: {
            targetAgent: AgentType.LENDING,
            intent: {
              intent: IntentType.LENDING,
              confidence: 0.9,
              reasoning: 'Portfolio analysis',
              keywords: ['portfolio']
            },
            requiresClarification: false,
            explanation: 'Routing to lending'
          },
          context: {
            sessionId: 'test-session',
            messages: [],
            metadata: {}
          }
        } as any);
      });

      // Mock lending success
      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount']
      } as any);

      // Mock optimizer success
      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT * FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: [],
          scanType: 'index_scan',
          score: 80,
          warnings: [],
          recommendations: []
        },
        warnings: []
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it('should fail after max retries', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock orchestrator to always fail
      mockOrchestrator.orchestrate.mockRejectedValue(new Error('Persistent failure'));

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(false);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(2); // Initial + 1 retry (maxRetries=1)
    });
  });

  describe('Caching', () => {
    it('should cache successful responses', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock successful flow
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount']
      } as any);

      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT * FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: [],
          scanType: 'index_scan',
          score: 80,
          warnings: [],
          recommendations: []
        },
        warnings: []
      } as any);

      // First call - should hit all agents
      const response1 = await coordinator.coordinate(request);
      expect(response1.success).toBe(true);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(1);

      // Second call with same query - should use cache
      const response2 = await coordinator.coordinate(request);
      expect(response2.success).toBe(true);
      expect(response2.finalSql).toBe(response1.finalSql);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should not cache failed responses', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      mockOrchestrator.orchestrate.mockRejectedValue(new Error('Failed'));

      // First call - fails
      const response1 = await coordinator.coordinate(request);
      expect(response1.success).toBe(false);

      // Second call - should try again, not use cache
      const response2 = await coordinator.coordinate(request);
      expect(response2.success).toBe(false);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(4); // 2 calls * 2 (initial + retry)
    });

    it('should clear cache on demand', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock successful flow
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount']
      } as any);

      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT * FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: [],
          scanType: 'index_scan',
          score: 80,
          warnings: [],
          recommendations: []
        },
        warnings: []
      } as any);

      // First call
      await coordinator.coordinate(request);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(1);

      // Clear cache
      coordinator.clearCache();

      // Second call - should hit agents again
      await coordinator.coordinate(request);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Health Monitoring', () => {
    it('should report health status', () => {
      const health = coordinator.getHealthStatus();

      expect(health.has('orchestrator')).toBe(true);
      expect(health.has('lending')).toBe(true);
      expect(health.has('audit')).toBe(true);
      expect(health.has('optimizer')).toBe(true);

      const orchestratorHealth = health.get('orchestrator');
      expect(orchestratorHealth?.status).toBeDefined();
      expect(orchestratorHealth?.lastCheck).toBeDefined();
    });

    it('should track metrics', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client'
      };

      // Mock successful flow
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount']
      } as any);

      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT * FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: [],
          scanType: 'index_scan',
          score: 80,
          warnings: [],
          recommendations: []
        },
        warnings: []
      } as any);

      await coordinator.coordinate(request);

      const metrics = coordinator.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
    });
  });

  describe('Options Handling', () => {
    it('should skip optimization when requested', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client',
        options: {
          skipOptimization: true
        }
      };

      // Mock orchestrator and lending
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending'
        },
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount']
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(response.finalSql).toBe('SELECT * FROM portfolio');
      expect(mockOptimizer.optimize).not.toHaveBeenCalled();
    });

    it('should include explanation when requested', async () => {
      const request: AgentCoordinationRequest = {
        query: 'Show me portfolio analysis',
        sessionId: 'test-session',
        clientId: 'test-client',
        options: {
          includeExplanation: true
        }
      };

      // Mock full flow
      mockOrchestrator.orchestrate.mockResolvedValue({
        routing: {
          targetAgent: AgentType.LENDING,
          intent: {
            intent: IntentType.LENDING,
            confidence: 0.9,
            reasoning: 'Portfolio analysis',
            keywords: ['portfolio']
          },
          requiresClarification: false,
          explanation: 'Routing to lending for portfolio analysis'
        },
        response: 'I will analyze your portfolio',
        context: {
          sessionId: 'test-session',
          messages: [],
          metadata: {}
        }
      } as any);

      mockLendingAgent.processQuery.mockResolvedValue({
        sql: 'SELECT * FROM portfolio',
        confidence: 0.85,
        queryType: 'portfolio_analysis',
        involvedTables: ['portfolio'],
        expectedColumns: ['company', 'amount'],
        explanation: 'Generating portfolio analysis query'
      } as any);

      mockOptimizer.optimize.mockResolvedValue({
        originalSql: 'SELECT * FROM portfolio',
        optimizedSql: 'SELECT * FROM portfolio WHERE client_id = ?',
        isValid: true,
        isSafe: true,
        optimizations: [],
        performanceAnalysis: {
          usesIndexes: true,
          indexesUsed: [],
          scanType: 'index_scan',
          score: 80,
          warnings: [],
          recommendations: []
        },
        warnings: [],
        explanation: 'Added security filters'
      } as any);

      const response = await coordinator.coordinate(request);

      expect(response.success).toBe(true);
      expect(response.explanation).toBeDefined();
      expect(response.explanation).toContain('portfolio');
    });
  });

  describe('Initialization and Shutdown', () => {
    it('should initialize all agents', async () => {
      await coordinator.initialize();

      expect(mockLendingAgent.initialize).toHaveBeenCalled();
      expect(mockAuditAgent.initialize).toHaveBeenCalled();
    });

    it('should handle initialization failure', async () => {
      mockLendingAgent.initialize.mockRejectedValue(new Error('DB connection failed'));

      await expect(coordinator.initialize()).rejects.toThrow();
    });

    it('should shutdown cleanly', async () => {
      await coordinator.shutdown();

      const activeFlows = coordinator.getActiveFlows();
      expect(activeFlows.length).toBe(0);
    });
  });
});
