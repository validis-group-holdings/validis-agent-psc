import { ParameterExtractor } from '../parameterExtractor';
import { QueryTemplate, QueryParameter } from '../../templates/common/types';
import { getLangChainModel } from '../../config/langchain';

// Mock the LangChain model
jest.mock('../../config/langchain');

describe('ParameterExtractor', () => {
  let extractor: ParameterExtractor;
  let mockModel: any;
  let sampleTemplate: QueryTemplate;

  beforeEach(() => {
    mockModel = {
      invoke: jest.fn()
    };
    (getLangChainModel as jest.Mock).mockReturnValue(mockModel);
    extractor = new ParameterExtractor();

    // Create a sample template for testing
    sampleTemplate = {
      id: 'test-template',
      name: 'Test Template',
      description: 'Test template for parameter extraction',
      category: 'audit',
      workflow: 'audit',
      parameters: [
        {
          name: 'threshold',
          type: 'number',
          required: true,
          description: 'Minimum amount threshold'
        },
        {
          name: 'startDate',
          type: 'date',
          required: true,
          description: 'Start date for analysis'
        },
        {
          name: 'includeWeekends',
          type: 'boolean',
          required: false,
          defaultValue: false,
          description: 'Include weekend transactions'
        },
        {
          name: 'accountType',
          type: 'string',
          required: false,
          defaultValue: 'all',
          description: 'Type of account to analyze'
        }
      ],
      sql: 'SELECT * FROM transactions WHERE amount > :threshold',
      estimatedRuntime: 5,
      complexity: 'medium',
      tags: ['financial', 'analysis']
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractParameters', () => {
    it('should extract parameters successfully', async () => {
      const mockResponse = {
        content: JSON.stringify({
          extractedParameters: {
            threshold: 10000,
            startDate: '2024-01-01',
            includeWeekends: true,
            accountType: 'checking'
          },
          missingRequired: [],
          confidence: 0.9,
          suggestions: [],
          reasoning: 'All parameters extracted from query'
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await extractor.extractParameters(
        'Show me transactions over $10,000 from checking accounts since January 1st 2024, including weekends',
        sampleTemplate
      );

      expect(result.extractedParameters.threshold).toBe(10000);
      expect(result.extractedParameters.startDate).toBe('2024-01-01');
      expect(result.extractedParameters.includeWeekends).toBe(true);
      expect(result.extractedParameters.accountType).toBe('checking');
      expect(result.missingRequired).toHaveLength(0);
      expect(result.confidence).toBe(0.9);
    });

    it('should identify missing required parameters', async () => {
      const mockResponse = {
        content: JSON.stringify({
          extractedParameters: {
            threshold: 5000
            // Missing startDate (required)
          },
          missingRequired: ['startDate'],
          confidence: 0.6,
          suggestions: ['Please specify the start date for analysis'],
          reasoning: 'Could not determine start date from query'
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await extractor.extractParameters(
        'Show me transactions over $5,000',
        sampleTemplate
      );

      expect(result.extractedParameters.threshold).toBe(5000);
      expect(result.missingRequired).toContain('startDate');
      expect(result.suggestions).toContain('Please specify the start date for analysis');
    });

    it('should handle type casting correctly', async () => {
      const mockResponse = {
        content: JSON.stringify({
          extractedParameters: {
            threshold: '15000', // String that should be converted to number
            startDate: 'today', // Relative date
            includeWeekends: 'true', // String boolean
            accountType: 'savings'
          },
          missingRequired: [],
          confidence: 0.8,
          suggestions: [],
          reasoning: 'Parameters extracted with type conversion'
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await extractor.extractParameters(
        'Show me savings transactions over $15,000 from today, including weekends',
        sampleTemplate
      );

      expect(typeof result.extractedParameters.threshold).toBe('number');
      expect(result.extractedParameters.threshold).toBe(15000);
      expect(typeof result.extractedParameters.includeWeekends).toBe('boolean');
      expect(result.extractedParameters.includeWeekends).toBe(true);
      expect(result.extractedParameters.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // ISO date format
    });

    it('should apply default values for optional parameters', async () => {
      const mockResponse = {
        content: JSON.stringify({
          extractedParameters: {
            threshold: 10000,
            startDate: '2024-01-01'
            // Missing optional parameters
          },
          missingRequired: [],
          confidence: 0.7,
          suggestions: [],
          reasoning: 'Required parameters extracted'
        })
      };

      mockModel.invoke.mockResolvedValue(mockResponse);

      const result = await extractor.extractParameters(
        'Show me transactions over $10,000 since January 1st',
        sampleTemplate
      );

      expect(result.extractedParameters.threshold).toBe(10000);
      expect(result.extractedParameters.startDate).toBe('2024-01-01');
      // Should not include defaults in extracted parameters initially
      expect('includeWeekends' in result.extractedParameters).toBe(false);
      expect('accountType' in result.extractedParameters).toBe(false);
    });

    it('should handle invalid JSON response', async () => {
      mockModel.invoke.mockResolvedValue({ content: 'Invalid JSON' });

      const result = await extractor.extractParameters(
        'Show me transactions',
        sampleTemplate
      );

      expect(result.reasoning).toContain('Fallback parameter extraction');
      expect(result.confidence).toBeLessThan(1.0);
    });

    it('should fallback when LLM fails', async () => {
      mockModel.invoke.mockRejectedValue(new Error('LLM error'));

      const result = await extractor.extractParameters(
        'Show me transactions over $5,000 from 2024-01-01',
        sampleTemplate
      );

      expect(result.reasoning).toContain('Fallback parameter extraction');
      expect(result.confidence).toBe(0.3); // Low confidence for fallback
    });
  });

  describe('type casting', () => {
    it('should cast string values correctly', () => {
      const param: QueryParameter = { name: 'test', type: 'string', required: true };
      const result = (extractor as any).castParameterValue('test value', param);
      expect(result).toBe('test value');
    });

    it('should cast number values correctly', () => {
      const param: QueryParameter = { name: 'test', type: 'number', required: true };
      
      expect((extractor as any).castParameterValue('123', param)).toBe(123);
      expect((extractor as any).castParameterValue(456, param)).toBe(456);
      
      // Should throw for invalid numbers
      expect(() => (extractor as any).castParameterValue('abc', param)).toThrow();
    });

    it('should cast boolean values correctly', () => {
      const param: QueryParameter = { name: 'test', type: 'boolean', required: true };
      
      expect((extractor as any).castParameterValue(true, param)).toBe(true);
      expect((extractor as any).castParameterValue('true', param)).toBe(true);
      expect((extractor as any).castParameterValue('yes', param)).toBe(true);
      expect((extractor as any).castParameterValue('1', param)).toBe(true);
      
      expect((extractor as any).castParameterValue(false, param)).toBe(false);
      expect((extractor as any).castParameterValue('false', param)).toBe(false);
      expect((extractor as any).castParameterValue('no', param)).toBe(false);
      expect((extractor as any).castParameterValue('0', param)).toBe(false);
    });

    it('should cast date values correctly', () => {
      const param: QueryParameter = { name: 'test', type: 'date', required: true };
      
      // ISO date
      expect((extractor as any).castParameterValue('2024-01-01', param)).toBe('2024-01-01');
      
      // Relative dates
      expect((extractor as any).castParameterValue('today', param)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((extractor as any).castParameterValue('ytd', param)).toMatch(/^\d{4}-01-01$/);
    });

    it('should use default values when casting fails', () => {
      const param: QueryParameter = { 
        name: 'test', 
        type: 'string', 
        required: false, 
        defaultValue: 'default' 
      };
      
      expect((extractor as any).castParameterValue(null, param)).toBe('default');
      expect((extractor as any).castParameterValue(undefined, param)).toBe('default');
    });
  });

  describe('validateRequiredParameters', () => {
    it('should validate required parameters correctly', () => {
      const parameters = {
        threshold: 10000,
        startDate: '2024-01-01'
      };

      const result = extractor.validateRequiredParameters(parameters, sampleTemplate);
      
      expect(result.isValid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should identify missing required parameters', () => {
      const parameters = {
        threshold: 10000
        // Missing startDate
      };

      const result = extractor.validateRequiredParameters(parameters, sampleTemplate);
      
      expect(result.isValid).toBe(false);
      expect(result.missing).toContain('startDate');
    });

    it('should handle null/undefined values', () => {
      const parameters = {
        threshold: 10000,
        startDate: null
      };

      const result = extractor.validateRequiredParameters(parameters, sampleTemplate);
      
      expect(result.isValid).toBe(false);
      expect(result.missing).toContain('startDate');
    });
  });

  describe('applyDefaults', () => {
    it('should apply default values for missing optional parameters', () => {
      const parameters = {
        threshold: 10000,
        startDate: '2024-01-01'
      };

      const result = extractor.applyDefaults(parameters, sampleTemplate);
      
      expect(result.threshold).toBe(10000);
      expect(result.startDate).toBe('2024-01-01');
      expect(result.includeWeekends).toBe(false); // Default value
      expect(result.accountType).toBe('all'); // Default value
    });

    it('should not override existing values', () => {
      const parameters = {
        threshold: 10000,
        startDate: '2024-01-01',
        includeWeekends: true, // Override default
        accountType: 'checking' // Override default
      };

      const result = extractor.applyDefaults(parameters, sampleTemplate);
      
      expect(result.includeWeekends).toBe(true); // Kept existing value
      expect(result.accountType).toBe('checking'); // Kept existing value
    });
  });

  describe('fallback extraction', () => {
    it('should extract numbers by pattern', () => {
      const result = (extractor as any).extractParameterByPattern(
        'transactions over 5000 dollars',
        { name: 'threshold', type: 'number' }
      );
      
      expect(result).toBe(5000);
    });

    it('should extract dates by pattern', () => {
      const result = (extractor as any).extractParameterByPattern(
        'from 2024-01-01 to today',
        { name: 'date', type: 'date' }
      );
      
      expect(result).toBe('2024-01-01');
    });

    it('should extract boolean values by context', () => {
      const includeResult = (extractor as any).extractParameterByPattern(
        'include weekend transactions',
        { name: 'includeWeekends', type: 'boolean' }
      );
      
      expect(includeResult).toBe(true);
    });

    it('should return null for no matches', () => {
      const result = (extractor as any).extractParameterByPattern(
        'some unrelated query',
        { name: 'threshold', type: 'number' }
      );
      
      expect(result).toBeNull();
    });
  });
});