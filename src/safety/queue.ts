import { QueryQueueItem, QueryResult } from '@/types';
import { QueryCircuitBreaker, QueryTimeoutEnforcer, OverloadProtection } from './circuitBreaker';
import { executeSecureQuery } from '@/db/uploadTableHelpers';
import { config } from '@/config';
import { v4 as uuidv4 } from 'uuid';

/**
 * Query Queue Manager - Handles query queuing, prioritization, and execution
 */
export class QueryQueueManager {
  private static instance: QueryQueueManager;
  
  private queue: QueryQueueItem[] = [];
  private executing = new Map<string, QueryQueueItem>();
  private completed = new Map<string, QueryQueueItem>();
  
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly circuitBreaker: QueryCircuitBreaker;
  
  private processingInterval?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    maxConcurrent = 3,
    maxQueueSize = 50
  ) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.circuitBreaker = QueryCircuitBreaker.getInstance('query-queue');
    
    // Start processing loop
    this.startProcessing();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): QueryQueueManager {
    if (!this.instance) {
      this.instance = new QueryQueueManager();
    }
    return this.instance;
  }

  /**
   * Add query to queue
   */
  async enqueueQuery(
    query: string,
    clientId: string,
    workflowMode: 'audit' | 'lending',
    priority = 5
  ): Promise<{ queryId: string; estimatedWait: number }> {
    
    // Check system capacity
    const loadCheck = OverloadProtection.canAcceptQuery();
    if (!loadCheck.canAccept) {
      throw new Error(`System overloaded: ${loadCheck.reason}`);
    }

    // Check queue size
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Query queue full (${this.maxQueueSize} max)`);
    }

    const queryId = uuidv4();
    const queueItem: QueryQueueItem = {
      id: queryId,
      query,
      clientId,
      workflowMode,
      priority,
      requestedAt: new Date(),
      status: 'queued'
    };

    // Insert in priority order (higher priority = lower number, executed first)
    const insertIndex = this.queue.findIndex(item => item.priority > priority);
    if (insertIndex === -1) {
      this.queue.push(queueItem);
    } else {
      this.queue.splice(insertIndex, 0, queueItem);
    }

    // Register query attempt
    OverloadProtection.registerQuery();

    // Estimate wait time
    const estimatedWait = this.estimateWaitTime(queryId);

    console.log(`Query ${queryId} enqueued with priority ${priority}, estimated wait: ${estimatedWait}ms`);
    
    return { queryId, estimatedWait };
  }

  /**
   * Get query status
   */
  getQueryStatus(queryId: string): QueryQueueItem | null {
    // Check executing queries
    const executing = this.executing.get(queryId);
    if (executing) {
      return { ...executing };
    }

    // Check completed queries
    const completed = this.completed.get(queryId);
    if (completed) {
      return { ...completed };
    }

    // Check queued queries
    const queued = this.queue.find(item => item.id === queryId);
    if (queued) {
      return { ...queued };
    }

    return null;
  }

  /**
   * Cancel a queued query
   */
  cancelQuery(queryId: string): boolean {
    // Try to cancel if executing
    if (this.executing.has(queryId)) {
      const cancelled = QueryTimeoutEnforcer.cancelQuery(queryId);
      if (cancelled) {
        const item = this.executing.get(queryId)!;
        item.status = 'failed';
        item.error = 'Query cancelled by user';
        item.completedAt = new Date();
        
        this.executing.delete(queryId);
        this.completed.set(queryId, item);
        
        return true;
      }
    }

    // Try to cancel if queued
    const queueIndex = this.queue.findIndex(item => item.id === queryId);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      item.status = 'failed';
      item.error = 'Query cancelled by user';
      item.completedAt = new Date();
      
      this.completed.set(queryId, item);
      return true;
    }

    return false;
  }

  /**
   * Start the query processing loop
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processQueue().catch(error => {
          console.error('Error in query processing:', error);
        });
      }
    }, 100); // Check every 100ms
  }

  /**
   * Stop the query processing loop
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  /**
   * Process queued queries
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.executing.size < this.maxConcurrent) {
        const item = this.queue.shift()!;
        
        // Move to executing
        item.status = 'executing';
        item.executedAt = new Date();
        this.executing.set(item.id, item);

        // Execute query asynchronously
        this.executeQuery(item).catch(error => {
          console.error(`Error executing query ${item.id}:`, error);
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a single query
   */
  private async executeQuery(item: QueryQueueItem): Promise<void> {
    try {
      // Execute with circuit breaker protection
      const result = await this.circuitBreaker.execute(async () => {
        return await QueryTimeoutEnforcer.executeWithTimeout(
          item.id,
          async (signal) => {
            // Check if cancelled
            if (signal.aborted) {
              throw new Error('Query cancelled');
            }

            return await executeSecureQuery(
              item.query,
              item.clientId,
              item.workflowMode
            );
          },
          config.queryLimits.timeoutMs
        );
      });

      // Mark as completed successfully
      item.status = 'completed';
      item.result = result;
      item.completedAt = new Date();

    } catch (error) {
      // Mark as failed
      item.status = error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'failed';
      item.error = error instanceof Error ? error.message : 'Unknown error';
      item.completedAt = new Date();
    }

    // Move from executing to completed
    this.executing.delete(item.id);
    this.completed.set(item.id, item);

    // Clean up old completed queries (keep last 100)
    if (this.completed.size > 100) {
      const oldestEntries = Array.from(this.completed.entries())
        .sort(([, a], [, b]) => a.completedAt!.getTime() - b.completedAt!.getTime())
        .slice(0, this.completed.size - 100);

      for (const [id] of oldestEntries) {
        this.completed.delete(id);
      }
    }
  }

  /**
   * Estimate wait time for a query
   */
  private estimateWaitTime(queryId: string): number {
    const position = this.queue.findIndex(item => item.id === queryId);
    if (position === -1) {
      return 0; // Not found or already executing
    }

    // Estimate based on position in queue and current execution rate
    const avgExecutionTime = 2000; // Assume 2 seconds average
    const availableSlots = Math.max(0, this.maxConcurrent - this.executing.size);
    
    if (position < availableSlots) {
      return 100; // Will execute immediately
    }

    const waitingPosition = position - availableSlots;
    return (waitingPosition * avgExecutionTime) / this.maxConcurrent;
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    queued: number;
    executing: number;
    completed: number;
    failed: number;
    timeouts: number;
    averageWaitTime: number;
    averageExecutionTime: number;
    maxConcurrent: number;
    maxQueueSize: number;
  } {
    const completedItems = Array.from(this.completed.values());
    
    const failed = completedItems.filter(item => item.status === 'failed').length;
    const timeouts = completedItems.filter(item => item.status === 'timeout').length;
    
    // Calculate average times for completed items
    const recentCompleted = completedItems
      .filter(item => item.completedAt && item.executedAt)
      .slice(-50); // Last 50 completed queries
    
    let averageWaitTime = 0;
    let averageExecutionTime = 0;
    
    if (recentCompleted.length > 0) {
      averageWaitTime = recentCompleted.reduce((sum, item) => {
        const waitTime = item.executedAt!.getTime() - item.requestedAt.getTime();
        return sum + waitTime;
      }, 0) / recentCompleted.length;

      averageExecutionTime = recentCompleted.reduce((sum, item) => {
        const execTime = item.completedAt!.getTime() - item.executedAt!.getTime();
        return sum + execTime;
      }, 0) / recentCompleted.length;
    }

    return {
      queued: this.queue.length,
      executing: this.executing.size,
      completed: completedItems.filter(item => item.status === 'completed').length,
      failed,
      timeouts,
      averageWaitTime: Math.round(averageWaitTime),
      averageExecutionTime: Math.round(averageExecutionTime),
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize
    };
  }

  /**
   * Get all active and recent queries
   */
  getAllQueries(): {
    queued: QueryQueueItem[];
    executing: QueryQueueItem[];
    recent: QueryQueueItem[];
  } {
    const recent = Array.from(this.completed.values())
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
      .slice(0, 20);

    return {
      queued: [...this.queue],
      executing: Array.from(this.executing.values()),
      recent
    };
  }

  /**
   * Clear completed queries
   */
  clearCompleted(): number {
    const count = this.completed.size;
    this.completed.clear();
    return count;
  }

  /**
   * Emergency stop - cancel all queries and clear queue
   */
  emergencyStop(): {
    cancelledExecuting: number;
    cancelledQueued: number;
  } {
    // Cancel all executing queries
    const cancelledExecuting = QueryTimeoutEnforcer.cancelAllQueries();
    
    // Clear executing map
    this.executing.clear();
    
    // Cancel all queued queries
    const cancelledQueued = this.queue.length;
    this.queue.forEach(item => {
      item.status = 'failed';
      item.error = 'System emergency stop';
      item.completedAt = new Date();
      this.completed.set(item.id, item);
    });
    
    this.queue = [];

    console.log(`Emergency stop: cancelled ${cancelledExecuting} executing and ${cancelledQueued} queued queries`);

    return { cancelledExecuting, cancelledQueued };
  }
}