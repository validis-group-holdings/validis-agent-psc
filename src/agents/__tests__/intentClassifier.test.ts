import { IntentClassifier } from '../intentClassifier';
import { getLangChainModel } from '../../config/langchain';

// Mock the LangChain model
jest.mock('../../config/langchain');

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      invoke: jest.fn()
    };
    (getLangChainModel as jest.Mock).mockReturnValue(mockModel);
    classifier = new IntentClassifier();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('classifyIntent', () => {
    it('should classify audit intent correctly', async () => {
      const mockResponse = {
        content: JSON.stringify({
          intent: 'journal_analysis',
          confidence: 0.85,
          workflow: 'audit',
          suggestedTemplates: ['journal-entries-threshold'],
          reasoning: 'Query mentions journal entries and thresholds',
          keywords: ['journal', 'entries', 'threshold']
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await classifier.classifyIntent(
        'Show me journal entries over $10,000',
        'audit'
      );

      expect(result.intent).toBe('journal_analysis');
      expect(result.confidence).toBe(0.85);
      expect(result.workflow).toBe('audit');
      expect(result.suggestedTemplates).toContain('journal-entries-threshold');
      expect(result.keywords).toContain('journal');
    });

    it('should classify lending intent correctly', async () => {
      const mockResponse = {
        content: JSON.stringify({
          intent: 'cash_flow_analysis',
          confidence: 0.9,
          workflow: 'lending',
          suggestedTemplates: ['cash-flow-analysis'],
          reasoning: 'Query asks about cash flow patterns',
          keywords: ['cash', 'flow', 'analysis']
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await classifier.classifyIntent(
        'Analyze cash flow patterns',
        'lending'
      );

      expect(result.intent).toBe('cash_flow_analysis');
      expect(result.confidence).toBe(0.9);
      expect(result.workflow).toBe('lending');
      expect(result.suggestedTemplates).toContain('cash-flow-analysis');
    });

    it('should handle low confidence classifications', async () => {
      const mockResponse = {
        content: JSON.stringify({
          intent: 'general_audit',
          confidence: 0.3,
          workflow: 'audit',
          suggestedTemplates: ['account-balance-reconciliation'],
          reasoning: 'Unclear query intent',
          keywords: ['account', 'balance']
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await classifier.classifyIntent(
        'Something about accounts',
        'audit'
      );

      expect(result.confidence).toBe(0.3);
      expect(result.intent).toBe('general_audit');
    });

    it('should fallback when LLM fails', async () => {
      mockModel.invoke.mockRejectedValue(new Error('LLM error'));

      const result = await classifier.classifyIntent(
        'Show me journal entries',
        'audit'
      );

      expect(result.confidence).toBeLessThan(1.0);
      expect(result.reasoning).toContain('Fallback classification');
      expect(result.workflow).toBe('audit');
    });

    it('should validate result structure', async () => {
      const invalidResponse = {
        content: JSON.stringify({
          intent: 'journal_analysis',
          confidence: 'invalid', // Should be number
          workflow: 'audit'
          // Missing required fields
        })
      };

      mockModel.invoke.mockResolvedValue(invalidResponse);

      const result = await classifier.classifyIntent(
        'Show me journal entries',
        'audit'
      );

      // Should fallback when validation fails
      expect(result.reasoning).toContain('Fallback classification');
    });

    it('should handle workflow mismatch', async () => {
      const mockResponse = {
        content: JSON.stringify({
          intent: 'journal_analysis',
          confidence: 0.85,
          workflow: 'lending', // Wrong workflow
          suggestedTemplates: ['journal-entries-threshold'],
          reasoning: 'Query mentions journal entries',
          keywords: ['journal']
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await classifier.classifyIntent(
        'Show me journal entries',
        'audit'
      );

      // Should fallback when workflow doesn't match
      expect(result.reasoning).toContain('Fallback classification');
    });
  });

  describe('getAvailableIntents', () => {
    it('should return audit intents', () => {
      const intents = classifier.getAvailableIntents('audit');
      
      expect(intents).toContain('journal_analysis');
      expect(intents).toContain('timing_analysis');
      expect(intents).toContain('compliance_check');
      expect(intents).not.toContain('cash_flow_analysis');
    });

    it('should return lending intents', () => {
      const intents = classifier.getAvailableIntents('lending');
      
      expect(intents).toContain('cash_flow_analysis');
      expect(intents).toContain('financial_ratios');
      expect(intents).toContain('risk_assessment');
      expect(intents).not.toContain('journal_analysis');
    });
  });

  describe('getTemplatesByKeywords', () => {
    it('should find templates by keywords', () => {
      const keywords = ['cash', 'flow'];
      const templates = classifier.getTemplatesByKeywords(keywords, 'lending');
      
      expect(templates).toHaveLength(3); // Limited to 3 results
      expect(templates.every(id => typeof id === 'string')).toBe(true);
    });

    it('should return empty array for no keyword matches', () => {
      const keywords = ['nonexistent', 'keywords'];
      const templates = classifier.getTemplatesByKeywords(keywords, 'audit');
      
      expect(templates).toHaveLength(0);
    });

    it('should handle empty keywords', () => {
      const keywords: string[] = [];
      const templates = classifier.getTemplatesByKeywords(keywords, 'audit');
      
      expect(templates).toHaveLength(0);
    });
  });

  describe('fallback classification', () => {
    it('should extract keywords from query', async () => {
      mockModel.invoke.mockRejectedValue(new Error('LLM error'));

      const result = await classifier.classifyIntent(
        'Show me large vendor payments from last month',
        'audit'
      );

      expect(result.keywords).toContain('vendor');
      expect(result.keywords).toContain('payments');
      // The keyword extraction may vary based on implementation
      expect(result.keywords.length).toBeGreaterThan(2);
      expect(result.keywords).not.toContain('from'); // Should filter short words
    });

    it('should suggest relevant templates', async () => {
      mockModel.invoke.mockRejectedValue(new Error('LLM error'));

      const result = await classifier.classifyIntent(
        'Find duplicate transactions',
        'audit'
      );

      expect(result.suggestedTemplates).toHaveLength(1);
      expect(result.suggestedTemplates[0]).toBeTruthy();
    });
  });
});