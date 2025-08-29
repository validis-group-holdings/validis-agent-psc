import { QueryAgent, AgentQueryRequest } from '../queryAgent';
import { IntentClassifier } from '../intentClassifier';
import { ParameterExtractor } from '../parameterExtractor';
import { TemplateSelector } from '../templateSelector';
import { QueryValidator } from '../../safety/validator';
import { QueryGovernor } from '../../safety/governor';
import { QueryCostEstimator } from '../../safety/estimator';
import { executeTemplate } from '../../templates/executor';

// Mock all dependencies
jest.mock('../intentClassifier');
jest.mock('../parameterExtractor');
jest.mock('../templateSelector');
jest.mock('../../safety/validator');
jest.mock('../../safety/governor');
jest.mock('../../safety/estimator');
jest.mock('../../templates/executor');
jest.mock('../../templates');

describe('QueryAgent', () => {
  let agent: QueryAgent;
  let mockIntentClassifier: jest.Mocked<IntentClassifier>;
  let mockParameterExtractor: jest.Mocked<ParameterExtractor>;
  let mockTemplateSelector: jest.Mocked<TemplateSelector>;

  beforeEach(() => {
    // Setup mocks
    mockIntentClassifier = new IntentClassifier() as jest.Mocked<IntentClassifier>;
    mockParameterExtractor = new ParameterExtractor() as jest.Mocked<ParameterExtractor>;
    mockTemplateSelector = new TemplateSelector() as jest.Mocked<TemplateSelector>;

    (IntentClassifier as jest.Mock).mockImplementation(() => mockIntentClassifier);
    (ParameterExtractor as jest.Mock).mockImplementation(() => mockParameterExtractor);
    (TemplateSelector as jest.Mock).mockImplementation(() => mockTemplateSelector);

    agent = new QueryAgent();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processQuery', () => {
    const mockRequest: AgentQueryRequest = {
      query: 'Show me journal entries over $10,000',
      clientId: 'test-client',
      workflowMode: 'audit',
      uploadId: 'test-upload'
    };

    it('should process query successfully', async () => {
      // Mock intent classification
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear journal analysis intent',
        keywords: ['journal', 'entries']
      });

      // Mock template selection
      const mockTemplate = {
        id: 'journal-entries-threshold',
        name: 'Journal Entries Over Threshold',
        description: 'Analyze journal entries exceeding a specified amount',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [
          { name: 'threshold', type: 'number' as const, required: true, description: 'Amount threshold' }
        ],
        sql: 'SELECT * FROM journal_entries WHERE amount > :threshold',
        estimatedRuntime: 5,
        estimatedExecutionTime: 5000,
        complexity: 'low' as const,
        expectedColumns: ['id', 'amount', 'description'],
        tags: ['journal', 'threshold']
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Perfect match for journal analysis',
        alternatives: [],
        matchScore: 0.95
      });

      // Mock parameter extraction
      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: { threshold: 10000 },
        missingRequired: [],
        confidence: 0.8,
        suggestions: [],
        reasoning: 'Threshold extracted successfully'
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({ threshold: 10000 });

      // Mock safety layer
      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      (QueryGovernor.adaptiveGovernance as jest.Mock).mockReturnValue({
        isValid: true,
        modifiedQuery: null,
        warnings: []
      });

      (QueryCostEstimator.estimate as jest.Mock).mockResolvedValue({
        riskLevel: 'low',
        estimatedTime: 2000,
        recommendations: []
      });

      // Mock template execution
      (executeTemplate as jest.Mock).mockResolvedValue({
        templateId: 'journal-entries-threshold',
        success: true,
        data: [{ id: 1, amount: 15000, description: 'Large journal entry' }],
        executionTime: 1500,
        rowCount: 1
      });

      const result = await agent.processQuery(mockRequest);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.template?.id).toBe('journal-entries-threshold');
      expect(result.parameters).toEqual({ threshold: 10000 });
      expect(result.metadata?.confidence).toBeGreaterThan(0);
      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalledWith('Show me journal entries over $10,000', 'audit');
    });

    it('should handle missing required parameters', async () => {
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear intent',
        keywords: ['journal']
      });

      const mockTemplate = {
        id: 'journal-entries-threshold',
        name: 'Journal Entries Over Threshold',
        description: 'Test template',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [
          { name: 'threshold', type: 'number' as const, required: true, description: 'Amount threshold' }
        ],
        sql: 'SELECT * FROM journal_entries WHERE amount > :threshold',
        estimatedRuntime: 5,
        estimatedExecutionTime: 5000,
        expectedColumns: ['id', 'amount', 'description'],
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Template selected',
        alternatives: [],
        matchScore: 0.9
      });

      // Missing required parameter
      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: ['threshold'],
        confidence: 0.5,
        suggestions: ['Please specify the threshold amount'],
        reasoning: 'Could not extract threshold'
      });

      const result = await agent.processQuery(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
      expect(result.warnings).toContain('Please specify the threshold amount');
    });

    it('should handle safety validation failure', async () => {
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear intent',
        keywords: ['journal']
      });

      const mockTemplate = {
        id: 'journal-entries-threshold',
        name: 'Test Template',
        description: 'Test',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM journal_entries',
        estimatedRuntime: 5,
        estimatedExecutionTime: 5000,
        expectedColumns: ['id', 'client_id'],
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Template selected',
        alternatives: [],
        matchScore: 0.9
      });

      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: [],
        confidence: 0.8,
        suggestions: [],
        reasoning: 'No parameters needed'
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({});

      // Safety validation fails
      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: false,
        errors: ['Unsafe query detected'],
        warnings: ['Query may be risky']
      });

      const result = await agent.processQuery(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query failed safety validation');
      expect(result.warnings).toContain('Query may be risky');
    });

    it('should handle governance blocking', async () => {
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear intent',
        keywords: ['journal']
      });

      const mockTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'Test',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM test',
        estimatedRuntime: 5,
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Template selected',
        alternatives: [],
        matchScore: 0.9
      });

      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: [],
        confidence: 0.8,
        suggestions: [],
        reasoning: 'No parameters'
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({});

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      // Governance blocks the query
      (QueryGovernor.adaptiveGovernance as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Query blocked by policy'],
        warnings: ['High risk query']
      });

      const result = await agent.processQuery(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Query blocked by governance policies');
    });

    it('should handle template execution failure', async () => {
      // Setup successful mocks until template execution
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear intent',
        keywords: ['journal']
      });

      const mockTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'Test',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM test',
        estimatedRuntime: 5,
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Template selected',
        alternatives: [],
        matchScore: 0.9
      });

      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: [],
        confidence: 0.8,
        suggestions: [],
        reasoning: 'No parameters'
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({});

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      (QueryGovernor.adaptiveGovernance as jest.Mock).mockReturnValue({
        isValid: true,
        warnings: []
      });

      (QueryCostEstimator.estimate as jest.Mock).mockResolvedValue({
        riskLevel: 'low'
      });

      // Template execution fails
      (executeTemplate as jest.Mock).mockResolvedValue({
        templateId: 'test-template',
        success: false,
        error: 'Database connection failed',
        executionTime: 1000
      });

      const result = await agent.processQuery(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
    });

    it('should handle forced template', async () => {
      const requestWithForcedTemplate: AgentQueryRequest = {
        ...mockRequest,
        forceTemplate: 'specific-template-id'
      };

      const forcedTemplate = {
        id: 'specific-template-id',
        name: 'Specific Template',
        description: 'Forced template',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM specific',
        estimatedRuntime: 3,
        complexity: 'low' as const
      };

      mockTemplateSelector.getTemplateById.mockReturnValue(forcedTemplate);

      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'forced',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: [],
        reasoning: 'Forced template',
        keywords: []
      });

      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: [],
        confidence: 1.0,
        suggestions: [],
        reasoning: 'No parameters'
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({});

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      (QueryGovernor.adaptiveGovernance as jest.Mock).mockReturnValue({
        isValid: true,
        warnings: []
      });

      (QueryCostEstimator.estimate as jest.Mock).mockResolvedValue({
        riskLevel: 'low'
      });

      (executeTemplate as jest.Mock).mockResolvedValue({
        templateId: 'specific-template-id',
        success: true,
        data: [],
        executionTime: 800,
        rowCount: 0
      });

      const result = await agent.processQuery(requestWithForcedTemplate);

      expect(result.success).toBe(true);
      expect(result.template?.id).toBe('specific-template-id');
      expect(mockTemplateSelector.selectTemplate).not.toHaveBeenCalled();
    });

    it('should handle missing forced template', async () => {
      const requestWithForcedTemplate: AgentQueryRequest = {
        ...mockRequest,
        forceTemplate: 'non-existent-template'
      };

      mockTemplateSelector.getTemplateById.mockReturnValue(null);

      const result = await agent.processQuery(requestWithForcedTemplate);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Forced template not found');
    });

    it('should skip parameter extraction when requested', async () => {
      const requestWithSkip: AgentQueryRequest = {
        ...mockRequest,
        skipParameterExtraction: true
      };

      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'test',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['test-template'],
        reasoning: 'Test',
        keywords: []
      });

      const mockTemplate = {
        id: 'test-template',
        name: 'Test',
        description: 'Test',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM test',
        estimatedRuntime: 1,
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.9,
        reasoning: 'Test',
        alternatives: [],
        matchScore: 0.9
      });

      mockParameterExtractor.applyDefaults.mockReturnValue({});

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      (QueryGovernor.adaptiveGovernance as jest.Mock).mockReturnValue({
        isValid: true,
        warnings: []
      });

      (QueryCostEstimator.estimate as jest.Mock).mockResolvedValue({
        riskLevel: 'low'
      });

      (executeTemplate as jest.Mock).mockResolvedValue({
        templateId: 'test-template',
        success: true,
        data: [],
        executionTime: 500,
        rowCount: 0
      });

      const result = await agent.processQuery(requestWithSkip);

      expect(result.success).toBe(true);
      expect(mockParameterExtractor.extractParameters).not.toHaveBeenCalled();
      expect(result.analysis?.parameterExtraction.reasoning).toContain('Parameter extraction skipped');
    });
  });

  describe('analyzeQuery', () => {
    it('should analyze query without executing', async () => {
      mockIntentClassifier.classifyIntent.mockResolvedValue({
        intent: 'journal_analysis',
        confidence: 0.9,
        workflow: 'audit',
        suggestedTemplates: ['journal-entries-threshold'],
        reasoning: 'Clear intent',
        keywords: ['journal']
      });

      const mockTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'Test',
        category: 'audit' as const,
        workflow: 'audit' as const,
        parameters: [],
        sql: 'SELECT * FROM test',
        estimatedRuntime: 5,
        complexity: 'low' as const
      };

      mockTemplateSelector.selectTemplate.mockResolvedValue({
        selectedTemplate: mockTemplate,
        confidence: 0.8,
        reasoning: 'Good match',
        alternatives: [],
        matchScore: 0.85
      });

      mockParameterExtractor.extractParameters.mockResolvedValue({
        extractedParameters: {},
        missingRequired: [],
        confidence: 0.7,
        suggestions: [],
        reasoning: 'Analysis complete'
      });

      const result = await agent.analyzeQuery('Test query', 'audit');

      expect(result.intent.intent).toBe('journal_analysis');
      expect(result.templateRecommendation.selectedTemplate.id).toBe('test-template');
      expect(result.parameterRequirements.confidence).toBe(0.7);

      // Should not execute any templates
      expect(executeTemplate).not.toHaveBeenCalled();
    });
  });

  describe('validateQuery', () => {
    it('should validate query successfully', async () => {
      const validRequest: AgentQueryRequest = {
        query: 'Valid query',
        clientId: 'test-client',
        workflowMode: 'audit'
      };

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: ['Minor warning']
      });

      const result = await agent.validateQuery(validRequest);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.recommendations).toContain('Minor warning');
    });

    it('should detect validation issues', async () => {
      const invalidRequest: AgentQueryRequest = {
        query: '',
        clientId: '',
        workflowMode: 'invalid' as any
      };

      const result = await agent.validateQuery(invalidRequest);

      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues).toContain('Query cannot be empty');
      expect(result.issues).toContain('Client ID is required');
    });

    it('should handle very long queries', async () => {
      const longQuery = 'x'.repeat(1001);
      const request: AgentQueryRequest = {
        query: longQuery,
        clientId: 'test-client',
        workflowMode: 'audit'
      };

      (QueryValidator.validate as jest.Mock).mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      });

      const result = await agent.validateQuery(request);

      expect(result.recommendations).toContain('Consider breaking down very long queries');
    });
  });

  describe('getQuerySuggestions', () => {
    it('should return audit suggestions', () => {
      const suggestions = agent.getQuerySuggestions('journal', 'audit');

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.includes('journal'))).toBe(true);
    });

    it('should return lending suggestions', () => {
      const suggestions = agent.getQuerySuggestions('cash', 'lending');

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.includes('cash'))).toBe(true);
    });

    it('should limit suggestions to 5', () => {
      const suggestions = agent.getQuerySuggestions('transaction', 'audit');

      expect(suggestions.length).toBeLessThanOrEqual(5);
    });

    it('should handle empty partial query', () => {
      const suggestions = agent.getQuerySuggestions('', 'audit');

      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});