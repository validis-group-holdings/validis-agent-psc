import Anthropic from '@anthropic-ai/sdk';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const config: AnthropicConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096'),
  temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.7')
};

let anthropicClient: Anthropic | null = null;

export function initializeAnthropic(): Anthropic {
  if (anthropicClient) {
    return anthropicClient;
  }

  if (!config.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  logger.info('Initializing Anthropic client...');

  anthropicClient = new Anthropic({
    apiKey: config.apiKey
  });

  logger.info('Anthropic client initialized successfully');

  return anthropicClient;
}

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized. Call initializeAnthropic() first.');
  }
  return anthropicClient;
}

export function getAnthropicConfig(): AnthropicConfig {
  return { ...config };
}

export async function createCompletion(prompt: string, options?: Partial<{
  maxTokens: number;
  temperature: number;
  model: string;
}>): Promise<string> {
  const client = getAnthropicClient();

  try {
    const response = await client.messages.create({
      model: options?.model || config.model,
      max_tokens: options?.maxTokens || config.maxTokens,
      temperature: options?.temperature || config.temperature,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    if (response.content[0].type === 'text') {
      return response.content[0].text;
    }

    throw new Error('Unexpected response format from Anthropic API');
  } catch (error) {
    logger.error('Error creating completion:', error);
    throw error;
  }
}

export default {
  initializeAnthropic,
  getAnthropicClient,
  getAnthropicConfig,
  createCompletion
};
