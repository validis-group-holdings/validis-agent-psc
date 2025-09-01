import './setup';
import { QueryAgent, AgentQueryRequest } from '../queryAgent';
import { createMockQueryRequest, expectValidQueryResponse, measureExecutionTime } from './setup';
import { initializeLangChain } from '../../config/langchain';

// This integration test focuses on testing the complete agent pipeline
// with realistic scenarios, without mocking internal components
describe('Agent Pipeline Integration', () => {
  let agent: QueryAgent;

  beforeAll(async () => {
    // Initialize LangChain for real integration tests
    initializeLangChain();
    // Initialize the agent without mocks to test real integration
    agent = new QueryAgent();
  });

  describe('End-to-End Query Processing', () => {
    // Skip these tests in CI environments where LLM API calls aren't available
    const skipLLMTests = process.env.CI === 'true' || !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'test-anthropic-key';

    (skipLLMTests ? describe.skip : describe)('Real LLM Integration', () => {
      it('should process a simple audit query end-to-end', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          query: 'Show me journal entries over $10,000 from last month',
          workflowMode: 'audit'
        });

        const { result, executionTime } = await measureExecutionTime(async () => {
          return await agent.processQuery(request);
        });

        expectValidQueryResponse(result);
        expect(executionTime).toBeLessThan(30000); // 30 second timeout for real API calls
        
        if (result.success) {
          expect(result.template?.id).toBeTruthy();
          expect(result.analysis?.intent.confidence).toBeGreaterThan(0.3);
        } else {
          // If it fails, it should be due to missing parameters or database issues
          expect(result.error).toBeTruthy();
        }
      }, 30000); // 30 second timeout

      it('should process a simple lending query end-to-end', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          query: 'Analyze cash flow patterns for the last quarter',
          workflowMode: 'lending'
        });

        const { result, executionTime } = await measureExecutionTime(async () => {
          return await agent.processQuery(request);
        });

        expectValidQueryResponse(result);
        expect(executionTime).toBeLessThan(30000);

        if (result.success) {
          expect(result.template?.workflow).toBe('lending');
        }
      }, 30000);

      it('should handle ambiguous queries gracefully', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          query: 'Show me some data',
          workflowMode: 'audit'
        });

        const result = await agent.processQuery(request);

        expectValidQueryResponse(result);
        
        // Should either succeed with low confidence or fail with helpful error
        if (result.success) {
          expect(result.metadata?.confidence).toBeLessThan(0.7);
        } else {
          expect(result.error).toContain('parameters');
          expect(result.analysis).toBeTruthy();
        }
      });

      it('should provide helpful analysis for incomplete queries', async () => {
        const result = await agent.analyzeQuery('find transactions', 'audit');

        expect(result.intent.intent).toBeTruthy();
        expect(result.templateRecommendation.selectedTemplate).toBeTruthy();
        expect(result.parameterRequirements).toBeTruthy();
      });
    });

    describe('Fallback Mechanisms', () => {
      it('should handle template selection with fallback', async () => {
        // This test uses mocked LLM to test fallback behavior
        const mockAgent = new QueryAgent();
        
        // Mock the classifier to simulate LLM failure
        const originalClassifyIntent = (mockAgent as any).intentClassifier.classifyIntent;
        (mockAgent as any).intentClassifier.classifyIntent = jest.fn().mockRejectedValue(new Error('LLM error'));

        const request: AgentQueryRequest = createMockQueryRequest({
          query: 'journal entries over 5000',
          workflowMode: 'audit'
        });

        const result = await mockAgent.processQuery(request);

        expectValidQueryResponse(result);
        
        // Should use fallback classification
        if (result.analysis?.intent) {
          expect(result.analysis.intent.reasoning).toContain('Fallback');
        }
      });

      it('should provide query suggestions when processing fails', () => {
        const suggestions = agent.getQuerySuggestions('journal', 'audit');

        expect(Array.isArray(suggestions)).toBe(true);
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.toLowerCase().includes('journal'))).toBe(true);
      });
    });

    describe('Performance and Reliability', () => {
      it('should complete query analysis within reasonable time', async () => {
        const start = Date.now();
        
        const result = await agent.analyzeQuery('Show me vendor payments', 'audit');
        
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(10000); // 10 second max for analysis
        expect(result.intent).toBeTruthy();
      });

      it('should handle multiple concurrent analyses', async () => {
        const queries = [
          'journal entries over threshold',
          'cash flow analysis',
          'vendor payment patterns',
          'revenue trend analysis'
        ];

        const workflows: ('audit' | 'lending')[] = ['audit', 'lending', 'audit', 'lending'];
        
        const promises = queries.map((query, index) => 
          agent.analyzeQuery(query, workflows[index])
        );

        const results = await Promise.all(promises);

        expect(results).toHaveLength(4);
        results.forEach(result => {
          expect(result.intent).toBeTruthy();
          expect(result.templateRecommendation).toBeTruthy();
        });
      });

      it('should validate queries efficiently', async () => {
        const validRequest: AgentQueryRequest = createMockQueryRequest({
          query: 'Valid audit query with proper structure',
          workflowMode: 'audit'
        });

        const invalidRequest: AgentQueryRequest = createMockQueryRequest({
          query: '', // Invalid empty query
          clientId: '', // Invalid empty client ID
          workflowMode: 'audit'
        });

        const [validResult, invalidResult] = await Promise.all([
          agent.validateQuery(validRequest),
          agent.validateQuery(invalidRequest)
        ]);

        expect(validResult.isValid).toBe(true);
        expect(invalidResult.isValid).toBe(false);
        expect(invalidResult.issues.length).toBeGreaterThan(0);
      });
    });

    describe('Error Handling and Edge Cases', () => {
      it('should handle missing client ID gracefully', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          clientId: '',
          query: 'Show me journal entries'
        });

        const result = await agent.validateQuery(request);

        expect(result.isValid).toBe(false);
        expect(result.issues).toContain('Client ID is required');
      });

      it('should handle invalid workflow mode', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          workflowMode: 'invalid' as any,
          query: 'Test query'
        });

        const result = await agent.validateQuery(request);

        expect(result.isValid).toBe(false);
        expect(result.issues.some(issue => issue.includes('workflow'))).toBe(true);
      });

      it('should handle very long queries', async () => {
        const longQuery = 'Show me '.repeat(200) + 'journal entries'; // Very long query
        const request: AgentQueryRequest = createMockQueryRequest({
          query: longQuery
        });

        const result = await agent.validateQuery(request);

        expect(result.recommendations.some(rec => 
          rec.includes('breaking down') || rec.includes('long queries')
        )).toBe(true);
      });

      it('should provide meaningful error messages', async () => {
        const request: AgentQueryRequest = createMockQueryRequest({
          query: 'nonsensical query with random words xyz abc',
          workflowMode: 'audit'
        });

        const result = await agent.processQuery(request);

        expectValidQueryResponse(result);
        
        if (!result.success) {
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe('string');
          expect(result.error!.length).toBeGreaterThan(10); // Meaningful error message
        }
      });
    });

    describe('Template and Parameter Integration', () => {
      it('should correctly match intent to template', async () => {
        const auditQueries = [
          'journal entries over 10000',
          'weekend transactions',
          'vendor payments analysis'
        ];

        for (const query of auditQueries) {
          const analysis = await agent.analyzeQuery(query, 'audit');
          
          expect(analysis.templateRecommendation.selectedTemplate.workflow).toBe('audit');
          expect(analysis.intent.workflow).toBe('audit');
        }
      });

      it('should extract parameters when possible', async () => {
        const queryWithNumbers = 'Show me journal entries over $15,000 from January 2024';
        
        const analysis = await agent.analyzeQuery(queryWithNumbers, 'audit');
        
        // Should attempt to extract numeric threshold and date
        expect(analysis.parameterRequirements).toBeTruthy();
        
        // The extraction quality depends on the specific template selected
        const hasExtractedParams = Object.keys(analysis.parameterRequirements.extractedParameters).length > 0;
        const hasMissingParams = analysis.parameterRequirements.missingRequired.length > 0;
        
        // Should either extract parameters or identify missing ones
        expect(hasExtractedParams || hasMissingParams).toBe(true);
      });

      it('should handle templates with different complexity levels', async () => {
        const simpleQuery = 'journal entries';
        const complexQuery = 'comprehensive audit analysis of all journal entries over $5000 from Q1 2024 with weekend inclusion and account type breakdown';

        const [simpleAnalysis, complexAnalysis] = await Promise.all([
          agent.analyzeQuery(simpleQuery, 'audit'),
          agent.analyzeQuery(complexQuery, 'audit')
        ]);

        // Both should succeed but may have different complexity matches
        expect(simpleAnalysis.templateRecommendation.selectedTemplate).toBeTruthy();
        expect(complexAnalysis.templateRecommendation.selectedTemplate).toBeTruthy();
        
        // Complex query might extract more parameters
        const simpleParamCount = Object.keys(simpleAnalysis.parameterRequirements.extractedParameters).length;
        const complexParamCount = Object.keys(complexAnalysis.parameterRequirements.extractedParameters).length;
        
        expect(complexParamCount).toBeGreaterThanOrEqual(simpleParamCount);
      });
    });

    describe('Workflow-Specific Behavior', () => {
      it('should provide different suggestions for different workflows', () => {
        const auditSuggestions = agent.getQuerySuggestions('transaction', 'audit');
        const lendingSuggestions = agent.getQuerySuggestions('transaction', 'lending');

        expect(auditSuggestions).not.toEqual(lendingSuggestions);
        
        // Audit suggestions should be more focused on compliance/fraud detection
        const auditText = auditSuggestions.join(' ').toLowerCase();
        expect(
          auditText.includes('weekend') || 
          auditText.includes('unusual') || 
          auditText.includes('compliance')
        ).toBe(true);
        
        // Lending suggestions should be more focused on financial health
        const lendingText = lendingSuggestions.join(' ').toLowerCase();
        expect(
          lendingText.includes('cash') || 
          lendingText.includes('ratio') || 
          lendingText.includes('analysis')
        ).toBe(true);
      });

      it('should respect workflow boundaries in template selection', async () => {
        const auditQuery = 'Show me compliance violations';
        const lendingQuery = 'Calculate debt ratios';

        const [auditAnalysis, lendingAnalysis] = await Promise.all([
          agent.analyzeQuery(auditQuery, 'audit'),
          agent.analyzeQuery(lendingQuery, 'lending')
        ]);

        expect(auditAnalysis.templateRecommendation.selectedTemplate.workflow).toBe('audit');
        expect(lendingAnalysis.templateRecommendation.selectedTemplate.workflow).toBe('lending');
      });
    });
  });
});