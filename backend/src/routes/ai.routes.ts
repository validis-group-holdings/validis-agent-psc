import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  sendChatCompletion,
  sendPrompt,
  analyzeFinancialData,
  streamChatCompletion
} from '../services/anthropic.service';
import { logger } from '../config/logger';

const router = Router();

// Validation schemas
const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
  })).min(1),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
});

const promptRequestSchema = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
});

const analyzeRequestSchema = z.object({
  data: z.any(),
  analysisType: z.enum(['journal_entries', 'anomalies', 'trends', 'reconciliation']),
});

/**
 * POST /api/ai/chat
 * Send a chat completion request
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validatedData = chatRequestSchema.parse(req.body);

    // Handle streaming response
    if (validatedData.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        for await (const chunk of streamChatCompletion(validatedData)) {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        logger.error('Streaming error:', error);
        res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
        res.end();
      }
      return;
    }

    // Regular non-streaming response
    const response = await sendChatCompletion(validatedData);

    res.json({
      success: true,
      data: response,
      requestId: req.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.errors,
        requestId: req.id,
      });
    }

    logger.error('Chat completion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chat request',
      requestId: req.id,
    });
  }
});

/**
 * POST /api/ai/prompt
 * Send a simple prompt (convenience endpoint)
 */
router.post('/prompt', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const { prompt, systemPrompt } = promptRequestSchema.parse(req.body);

    const response = await sendPrompt(prompt, systemPrompt);

    res.json({
      success: true,
      data: {
        content: response,
      },
      requestId: req.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.errors,
        requestId: req.id,
      });
    }

    logger.error('Prompt error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process prompt',
      requestId: req.id,
    });
  }
});

/**
 * POST /api/ai/analyze
 * Analyze financial data
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const { data, analysisType } = analyzeRequestSchema.parse(req.body);

    const response = await analyzeFinancialData(data, analysisType);

    res.json({
      success: true,
      data: response,
      requestId: req.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: error.errors,
        requestId: req.id,
      });
    }

    logger.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze data',
      requestId: req.id,
    });
  }
});

/**
 * GET /api/ai/test
 * Test the AI connection
 */
router.get('/test', async (req: Request, res: Response) => {
  try {
    const response = await sendPrompt(
      'Please respond with a JSON object containing: { status: "connected", message: "AI service is operational" }'
    );

    // Try to parse the response as JSON
    let parsedResponse;
    try {
      // Extract JSON from the response (Claude might add extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = { status: 'connected', message: response };
      }
    } catch {
      parsedResponse = { status: 'connected', message: response };
    }

    res.json({
      success: true,
      data: parsedResponse,
      requestId: req.id,
    });
  } catch (error) {
    logger.error('AI test error:', error);
    res.status(500).json({
      success: false,
      error: 'AI service test failed',
      requestId: req.id,
    });
  }
});

export default router;
