import { BaseAgent, AgentMessage, AgentContext, AgentResult } from '../baseAgent';

class TestAgent extends BaseAgent {
  constructor() {
    super('test-agent');
  }

  async execute(message: AgentMessage, context: AgentContext): Promise<AgentResult> {
    return {
      success: true,
      data: { processed: message.data },
      metadata: {
        agentName: this.name,
        timestamp: new Date().toISOString(),
        processingTime: 100
      }
    };
  }

  validate(message: AgentMessage): boolean {
    return message.data !== null && message.data !== undefined;
  }
}

describe('BaseAgent', () => {
  let testAgent: TestAgent;

  beforeEach(() => {
    testAgent = new TestAgent();
  });

  describe('constructor', () => {
    it('should initialize with correct name', () => {
      expect(testAgent.getName()).toBe('test-agent');
    });

    it('should generate unique agent ID', () => {
      const agent1 = new TestAgent();
      const agent2 = new TestAgent();
      expect(agent1.getId()).not.toBe(agent2.getId());
    });
  });

  describe('process', () => {
    const mockContext: AgentContext = {
      sessionId: 'session-123',
      clientId: 'client-456',
      workflowMode: 'audit',
      uploadId: 'upload-789'
    };

    it('should process valid message successfully', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test query' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await testAgent.process(message, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.processed).toEqual({ query: 'test query' });
      expect(result.metadata.agentName).toBe('test-agent');
    });

    it('should handle validation failure', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: null,
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await testAgent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Validation failed');
    });

    it('should handle execution errors', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      jest.spyOn(testAgent, 'execute').mockRejectedValue(new Error('Execution failed'));

      const result = await testAgent.process(message, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Execution failed');
    });

    it('should emit events during processing', async () => {
      const onStartSpy = jest.fn();
      const onCompleteSpy = jest.fn();
      const onErrorSpy = jest.fn();

      testAgent.on('processing:start', onStartSpy);
      testAgent.on('processing:complete', onCompleteSpy);
      testAgent.on('processing:error', onErrorSpy);

      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      await testAgent.process(message, mockContext);

      expect(onStartSpy).toHaveBeenCalledWith({
        agentId: testAgent.getId(),
        agentName: 'test-agent',
        message
      });

      expect(onCompleteSpy).toHaveBeenCalled();
      expect(onErrorSpy).not.toHaveBeenCalled();
    });

    it('should measure processing time', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      const result = await testAgent.process(message, mockContext);

      expect(result.metadata.processingTime).toBeDefined();
      expect(typeof result.metadata.processingTime).toBe('number');
      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    const mockContext: AgentContext = {
      sessionId: 'session-123',
      clientId: 'client-456',
      workflowMode: 'audit',
      uploadId: 'upload-789'
    };

    it('should handle timeout errors', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      jest.spyOn(testAgent, 'execute').mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          success: true,
          data: {},
          metadata: {
            agentName: 'test-agent',
            timestamp: new Date().toISOString(),
            processingTime: 100
          }
        }), 10000))
      );

      const result = await testAgent.process(message, mockContext, { timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('should retry on transient errors', async () => {
      const message: AgentMessage = {
        type: 'query',
        data: { query: 'test' },
        source: 'user',
        timestamp: new Date().toISOString()
      };

      let attempts = 0;
      jest.spyOn(testAgent, 'execute').mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Transient error');
        }
        return {
          success: true,
          data: { processed: message.data },
          metadata: {
            agentName: 'test-agent',
            timestamp: new Date().toISOString(),
            processingTime: 100
          }
        };
      });

      const result = await testAgent.process(message, mockContext, { retries: 2 });

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });

  describe('event emitter', () => {
    it('should emit custom events', () => {
      const customEventSpy = jest.fn();
      testAgent.on('custom:event', customEventSpy);

      testAgent.emit('custom:event', { data: 'test' });

      expect(customEventSpy).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should remove event listeners', () => {
      const eventSpy = jest.fn();
      testAgent.on('test:event', eventSpy);
      testAgent.off('test:event', eventSpy);

      testAgent.emit('test:event', {});

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });
});