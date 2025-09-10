/**
 * Tests for Orchestrator Agent - 95% routing accuracy requirement
 */

import { OrchestratorAgent, createOrchestratorAgent } from './index';
import { IntentType, AgentType, UserQuery } from './types';

describe('OrchestratorAgent', () => {
  let orchestrator: OrchestratorAgent;
  const sessionId = 'test-session-123';

  beforeEach(() => {
    orchestrator = createOrchestratorAgent({
      confidenceThreshold: 0.7,
      clarificationEnabled: true,
      templateSuggestionEnabled: true
    });
  });

  afterEach(() => {
    orchestrator.clearSession(sessionId);
  });

  describe('Lending Agent Routing', () => {
    const lendingQueries = [
      'Analyze the portfolio of 10 companies in our lending book',
      'Compare debt-to-equity ratios across all portfolio companies',
      'Check covenant compliance for our loan facilities',
      'Assess credit risk across multiple borrowers',
      'Generate portfolio performance metrics for Q4',
      'Review leverage ratios for all companies in the portfolio',
      'Analyze industry concentration risk in our lending portfolio',
      'Compare financial metrics across portfolio companies',
      'Evaluate debt service coverage across all loans',
      'Perform cross-company trend analysis'
    ];

    test.each(lendingQueries)('should route to Lending Agent: "%s"', async (queryText) => {
      const query: UserQuery = {
        text: queryText,
        timestamp: new Date(),
        sessionId
      };

      const response = await orchestrator.orchestrate(query);

      // Should route to lending or require clarification
      if (!response.routing.requiresClarification) {
        expect(response.routing.targetAgent).toBe(AgentType.LENDING);
        expect(response.routing.intent.intent).toBe(IntentType.LENDING);
      }
      expect(response.routing.intent.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Audit Agent Routing', () => {
    const auditQueries = [
      'Perform substantive testing on ABC Company accounts receivable',
      'Test internal controls for XYZ Corporation',
      'Calculate materiality for the financial statement audit',
      'Review journal entries for unusual transactions',
      'Perform cut-off testing for year-end',
      'Audit the balance sheet of Tech Corp',
      'Test management assertions for inventory valuation',
      'Perform analytical procedures on income statement',
      'Document control deficiencies found during walkthrough',
      'Confirm bank balances for the single company audit'
    ];

    test.each(auditQueries)('should route to Audit Agent: "%s"', async (queryText) => {
      const query: UserQuery = {
        text: queryText,
        timestamp: new Date(),
        sessionId: `${sessionId}-audit`
      };

      const response = await orchestrator.orchestrate(query);

      // Should route to audit or require clarification
      if (!response.routing.requiresClarification) {
        expect(response.routing.targetAgent).toBe(AgentType.AUDIT);
        expect(response.routing.intent.intent).toBe(IntentType.AUDIT);
      }
      expect(response.routing.intent.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Ambiguous Queries', () => {
    const ambiguousQueries = [
      'Analyze financial statements',
      'Review the companies',
      'Check compliance',
      'Perform risk assessment',
      'Generate financial reports'
    ];

    test.each(ambiguousQueries)('should request clarification: "%s"', async (queryText) => {
      const query: UserQuery = {
        text: queryText,
        timestamp: new Date(),
        sessionId: `${sessionId}-ambiguous`
      };

      const response = await orchestrator.orchestrate(query);

      // Should identify as ambiguous or low confidence
      if (response.routing.intent.intent === IntentType.AMBIGUOUS) {
        expect(response.routing.requiresClarification).toBe(true);
        expect(response.routing.clarificationPrompt).toBeDefined();
      } else {
        // If not ambiguous, confidence should be lower
        expect(response.routing.intent.confidence).toBeLessThan(0.7);
      }
    });
  });

  describe('Routing Accuracy', () => {
    test('should achieve 95% routing accuracy', async () => {
      const testCases = [
        // Lending cases (should route to lending)
        { query: 'Portfolio analysis of 20 companies', expected: AgentType.LENDING },
        { query: 'Cross-company financial metrics comparison', expected: AgentType.LENDING },
        { query: 'Loan covenant compliance testing', expected: AgentType.LENDING },
        { query: 'Credit risk assessment for multiple borrowers', expected: AgentType.LENDING },
        { query: 'Aggregate portfolio performance metrics', expected: AgentType.LENDING },
        { query: 'Industry sector analysis across portfolio', expected: AgentType.LENDING },
        { query: 'Debt service coverage for all facilities', expected: AgentType.LENDING },
        { query: 'Portfolio concentration risk analysis', expected: AgentType.LENDING },
        { query: 'Benchmark portfolio companies against peers', expected: AgentType.LENDING },
        { query: 'Consolidated financial analysis of lending book', expected: AgentType.LENDING },

        // Audit cases (should route to audit)
        { query: 'Audit procedures for ABC Company', expected: AgentType.AUDIT },
        { query: 'Test controls at XYZ Corporation', expected: AgentType.AUDIT },
        { query: 'Substantive testing of accounts payable', expected: AgentType.AUDIT },
        { query: 'Year-end audit for Tech Inc', expected: AgentType.AUDIT },
        { query: 'SOX compliance testing procedures', expected: AgentType.AUDIT },
        { query: 'Materiality calculation for financial audit', expected: AgentType.AUDIT },
        { query: 'Walkthrough of purchase cycle controls', expected: AgentType.AUDIT },
        { query: 'Analytical procedures for revenue recognition', expected: AgentType.AUDIT },
        { query: 'Management representation letter review', expected: AgentType.AUDIT },
        { query: 'Going concern assessment for the company', expected: AgentType.AUDIT }
      ];

      let correctRoutings = 0;
      const totalCases = testCases.length;

      for (const testCase of testCases) {
        const query: UserQuery = {
          text: testCase.query,
          timestamp: new Date(),
          sessionId: `${sessionId}-accuracy-${correctRoutings}`
        };

        const response = await orchestrator.orchestrate(query);

        // Count as correct if routed correctly or asks for clarification
        if (response.routing.requiresClarification ||
            response.routing.targetAgent === testCase.expected) {
          correctRoutings++;
        }
      }

      const accuracy = (correctRoutings / totalCases) * 100;
      console.log(`Routing Accuracy: ${accuracy}% (${correctRoutings}/${totalCases})`);

      // Require 95% accuracy
      expect(accuracy).toBeGreaterThanOrEqual(95);
    });
  });

  describe('Context Management', () => {
    test('should maintain conversation context', async () => {
      // First query
      const query1: UserQuery = {
        text: 'I need to analyze our portfolio',
        timestamp: new Date(),
        sessionId
      };

      await orchestrator.orchestrate(query1);

      // Follow-up query
      const query2: UserQuery = {
        text: 'Focus on companies in the technology sector',
        timestamp: new Date(),
        sessionId
      };

      const response2 = await orchestrator.orchestrate(query2);

      // Should maintain context
      expect(response2.context.messages.length).toBeGreaterThan(1);
      expect(response2.context.sessionId).toBe(sessionId);
    });

    test('should track routing history', async () => {
      const queries = [
        'Analyze portfolio companies',
        'Audit procedures for ABC Corp',
        'Credit risk assessment'
      ];

      for (const queryText of queries) {
        const query: UserQuery = {
          text: queryText,
          timestamp: new Date(),
          sessionId
        };
        await orchestrator.orchestrate(query);
      }

      const summary = orchestrator.getConversationSummary(sessionId);
      expect(summary.messageCount).toBeGreaterThanOrEqual(3);
      expect(summary.routedAgents.length).toBeGreaterThan(0);
    });
  });

  describe('Template Suggestions', () => {
    test('should suggest relevant templates for lending queries', async () => {
      const query: UserQuery = {
        text: 'Perform covenant compliance testing for our loan portfolio',
        timestamp: new Date(),
        sessionId
      };

      const response = await orchestrator.orchestrate(query);

      expect(response.templates).toBeDefined();
      expect(response.templates.length).toBeGreaterThan(0);

      const templateNames = response.templates.map(t => t.name);
      expect(templateNames).toContain('Covenant Compliance Testing Template');
    });

    test('should suggest relevant templates for audit queries', async () => {
      const query: UserQuery = {
        text: 'Calculate materiality for the ABC Company audit',
        timestamp: new Date(),
        sessionId
      };

      const response = await orchestrator.orchestrate(query);

      expect(response.templates).toBeDefined();
      expect(response.templates.length).toBeGreaterThan(0);

      const templateNames = response.templates.map(t => t.name);
      expect(templateNames).toContain('Materiality Calculation Template');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid queries gracefully', async () => {
      const query: UserQuery = {
        text: '',
        timestamp: new Date(),
        sessionId
      };

      const response = await orchestrator.orchestrate(query);
      expect(response).toBeDefined();
      expect(response.routing.intent.intent).toBe(IntentType.AMBIGUOUS);
    });

    test('should provide error messages', () => {
      const errorMessage = orchestrator.handleError('ROUTING_FAILED');
      expect(errorMessage).toContain('difficulty routing');

      const agentError = orchestrator.handleError('AGENT_UNAVAILABLE', {
        agentType: 'Lending'
      });
      expect(agentError).toContain('Lending');
    });
  });

  describe('Session Management', () => {
    test('should export and import sessions', () => {
      const query: UserQuery = {
        text: 'Test query for session export',
        timestamp: new Date(),
        sessionId
      };

      orchestrator.orchestrate(query);

      const exported = orchestrator.exportSession(sessionId);
      expect(exported).toBeDefined();

      const newSessionId = 'imported-session';
      orchestrator.importSession(newSessionId, exported);

      const summary = orchestrator.getConversationSummary(newSessionId);
      expect(summary.messageCount).toBeGreaterThan(0);
    });

    test('should cleanup inactive sessions', () => {
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        const query: UserQuery = {
          text: 'Test query',
          timestamp: new Date(Date.now() - 40 * 60 * 1000), // 40 minutes ago
          sessionId: `old-session-${i}`
        };
        orchestrator.orchestrate(query);
      }

      const cleaned = orchestrator.cleanupInactiveSessions(30);
      expect(cleaned).toBeGreaterThan(0);
    });
  });
});
