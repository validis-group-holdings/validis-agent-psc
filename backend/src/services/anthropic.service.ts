import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { logger } from '../config/logger';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

/**
 * Send a chat completion request to Claude
 */
export async function sendChatCompletion(options: ChatOptions): Promise<ChatResponse> {
  try {
    const {
      messages,
      systemPrompt,
      maxTokens = env.ANTHROPIC_MAX_TOKENS,
      temperature = env.ANTHROPIC_TEMPERATURE,
    } = options;

    logger.info('Sending chat completion request to Claude', {
      messageCount: messages.length,
      maxTokens,
      temperature,
    });

    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    logger.info('Received response from Claude', {
      usage: response.usage,
      stopReason: response.stop_reason,
    });

    // Extract text content from the response
    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return {
      content: textContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason,
    };
  } catch (error) {
    logger.error('Error in chat completion:', error);
    throw error;
  }
}

/**
 * Send a simple prompt to Claude (convenience function)
 */
export async function sendPrompt(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const response = await sendChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt,
  });

  return response.content;
}

/**
 * Analyze financial data using Claude
 */
export async function analyzeFinancialData(
  data: any,
  analysisType: 'journal_entries' | 'anomalies' | 'trends' | 'reconciliation'
): Promise<ChatResponse> {
  const systemPrompts = {
    journal_entries: `You are a financial auditor specialized in analyzing journal entries.
      Identify unusual patterns, potential errors, and areas requiring further investigation.
      Focus on: amount patterns, timing issues, account combinations, and documentation quality.`,

    anomalies: `You are a forensic accountant specialized in detecting financial anomalies.
      Look for: unusual transactions, round number patterns, timing manipulations, and statistical outliers.
      Provide risk scores and specific recommendations for investigation.`,

    trends: `You are a financial analyst specialized in trend analysis.
      Identify: seasonal patterns, growth trends, unusual fluctuations, and predictive insights.
      Provide both statistical and contextual analysis.`,

    reconciliation: `You are an accounting specialist focused on reconciliation.
      Identify: matching issues, timing differences, missing entries, and balance discrepancies.
      Suggest specific reconciliation adjustments.`,
  };

  const prompt = `Analyze the following financial data:\n\n${JSON.stringify(data, null, 2)}`;

  return sendChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: systemPrompts[analysisType],
  });
}

/**
 * Stream chat completion for real-time responses
 */
export async function* streamChatCompletion(
  options: ChatOptions
): AsyncGenerator<string, void, unknown> {
  try {
    const {
      messages,
      systemPrompt,
      maxTokens = env.ANTHROPIC_MAX_TOKENS,
      temperature = env.ANTHROPIC_TEMPERATURE,
    } = options;

    logger.info('Starting streaming chat completion');

    const stream = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }

    logger.info('Streaming completed');
  } catch (error) {
    logger.error('Error in streaming chat completion:', error);
    throw error;
  }
}

/**
 * Test the Anthropic connection
 */
export async function testAnthropicConnection(): Promise<boolean> {
  try {
    const response = await sendPrompt('Hello! Please respond with "Connection successful".');
    return response.includes('Connection successful') || response.includes('connection successful');
  } catch (error) {
    logger.error('Anthropic connection test failed:', error);
    return false;
  }
}
