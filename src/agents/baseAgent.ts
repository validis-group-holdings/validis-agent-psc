import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface AgentMessage {
  type: string;
  data: any;
  source: string;
  timestamp: string;
}

export interface AgentContext {
  sessionId: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
  uploadId: string;
}

export interface AgentResult {
  success: boolean;
  data?: any;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  metadata: {
    agentName: string;
    agentId?: string;
    timestamp: string;
    processingTime: number;
  };
}

export interface ProcessOptions {
  timeout?: number;
  retries?: number;
}

export abstract class BaseAgent extends EventEmitter {
  protected id: string;
  protected name: string;

  constructor(name: string) {
    super();
    this.id = uuidv4();
    this.name = name;
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  abstract execute(message: AgentMessage, context: AgentContext): Promise<AgentResult>;
  
  abstract validate(message: AgentMessage): boolean;

  async process(
    message: AgentMessage, 
    context: AgentContext, 
    options: ProcessOptions = {}
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const { timeout = 5000, retries = 0 } = options;

    try {
      this.emit('processing:start', {
        agentId: this.id,
        agentName: this.name,
        message
      });

      // Validation
      if (!this.validate(message)) {
        const error = {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR'
        };
        
        this.emit('processing:error', { error, agentId: this.id });
        
        return {
          success: false,
          error,
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          }
        };
      }

      // Execute with timeout
      let result: AgentResult;
      let lastError: Error | null = null;
      let attempts = 0;

      while (attempts <= retries) {
        try {
          attempts++;
          
          result = await this.executeWithTimeout(
            message, 
            context, 
            timeout
          );
          
          if (result.success) {
            break;
          }
          
          // Retry on TIMEOUT or EXECUTION_ERROR (which could be transient)
          if (result.error?.code === 'TIMEOUT' || result.error?.code === 'EXECUTION_ERROR') {
            lastError = new Error(result.error?.message || 'Unknown error');
            
            if (attempts <= retries) {
              await this.delay(Math.min(1000 * attempts, 3000));
            }
          } else {
            // For other error codes (like VALIDATION_ERROR), don't retry
            break;
          }
        } catch (error) {
          lastError = error as Error;
          
          if (attempts > retries) {
            throw error;
          }
          
          // Only delay if we're going to retry
          if (attempts <= retries) {
            await this.delay(Math.min(1000 * attempts, 3000));
          } else {
            break; // Exit loop if no more retries
          }
        }
      }

      if (lastError && !result!) {
        throw lastError;
      }

      this.emit('processing:complete', {
        agentId: this.id,
        agentName: this.name,
        result: result!
      });

      return result!;
    } catch (error) {
      const errorObj = {
        message: (error as Error).message,
        code: (error as any).code || 'EXECUTION_ERROR'
      };

      this.emit('processing:error', { 
        error: errorObj, 
        agentId: this.id 
      });

      return {
        success: false,
        error: errorObj,
        metadata: {
          agentName: this.name,
          agentId: this.id,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  private async executeWithTimeout(
    message: AgentMessage,
    context: AgentContext,
    timeout: number
  ): Promise<AgentResult> {
    const startTime = Date.now();
    return new Promise(async (resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: {
            message: `Agent execution timed out after ${timeout}ms`,
            code: 'TIMEOUT'
          },
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: timeout
          }
        });
      }, timeout);

      try {
        const result = await this.execute(message, context);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: {
            message: (error as Error).message,
            code: 'EXECUTION_ERROR'
          },
          metadata: {
            agentName: this.name,
            agentId: this.id,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          }
        });
      }
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}