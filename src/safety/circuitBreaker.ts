import { CircuitBreakerState } from '@/types';

/**
 * Circuit Breaker for database query protection
 * Prevents system overload by temporarily blocking queries when failure rate is high
 */
export class QueryCircuitBreaker {
  private static instances = new Map<string, QueryCircuitBreaker>();
  
  private state: CircuitBreakerState = {
    state: 'closed',
    failureCount: 0
  };
  
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number; // ms
  private readonly halfOpenMaxCalls: number;
  private halfOpenCallCount = 0;
  
  constructor(
    private readonly name: string,
    failureThreshold = 5,
    recoveryTimeout = 60000, // 1 minute
    halfOpenMaxCalls = 3
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
  }

  /**
   * Get or create a circuit breaker instance
   */
  static getInstance(name: string): QueryCircuitBreaker {
    if (!this.instances.has(name)) {
      this.instances.set(name, new QueryCircuitBreaker(name));
    }
    return this.instances.get(name)!;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.shouldReject()) {
      throw new Error(`Circuit breaker ${this.name} is OPEN - request rejected`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if request should be rejected
   */
  private shouldReject(): boolean {
    const now = new Date();

    switch (this.state.state) {
      case 'closed':
        return false;

      case 'open':
        if (this.state.nextAttemptTime && now >= this.state.nextAttemptTime) {
          this.state.state = 'half-open';
          this.halfOpenCallCount = 0;
          console.log(`Circuit breaker ${this.name} transitioning to HALF-OPEN`);
          return false;
        }
        return true;

      case 'half-open':
        return this.halfOpenCallCount >= this.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state.state === 'half-open') {
      this.halfOpenCallCount++;
      if (this.halfOpenCallCount >= this.halfOpenMaxCalls) {
        this.state = {
          state: 'closed',
          failureCount: 0
        };
        console.log(`Circuit breaker ${this.name} transitioning to CLOSED`);
      }
    } else {
      // Reset failure count on success in closed state
      this.state.failureCount = 0;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = new Date();
    
    this.state.failureCount++;
    this.state.lastFailureTime = now;

    if (this.state.state === 'closed' && this.state.failureCount >= this.failureThreshold) {
      this.openCircuit(now);
    } else if (this.state.state === 'half-open') {
      this.openCircuit(now);
    }
  }

  /**
   * Open the circuit breaker
   */
  private openCircuit(now: Date): void {
    this.state = {
      state: 'open',
      failureCount: this.state.failureCount,
      lastFailureTime: now,
      nextAttemptTime: new Date(now.getTime() + this.recoveryTimeout)
    };
    console.log(`Circuit breaker ${this.name} transitioning to OPEN`);
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.state = {
      state: 'closed',
      failureCount: 0
    };
    this.halfOpenCallCount = 0;
    console.log(`Circuit breaker ${this.name} manually reset to CLOSED`);
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    isHealthy: boolean;
    state: string;
    failureCount: number;
    nextAttemptIn?: number;
  } {
    const now = new Date();
    
    return {
      isHealthy: this.state.state === 'closed',
      state: this.state.state,
      failureCount: this.state.failureCount,
      nextAttemptIn: this.state.nextAttemptTime ? 
        Math.max(0, this.state.nextAttemptTime.getTime() - now.getTime()) : undefined
    };
  }
}

/**
 * Query timeout enforcement with cancellation support
 */
export class QueryTimeoutEnforcer {
  private static activeQueries = new Map<string, AbortController>();

  /**
   * Execute a query with timeout enforcement
   */
  static async executeWithTimeout<T>(
    queryId: string,
    queryFn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number = 5000
  ): Promise<T> {
    
    // Create abort controller for this query
    const controller = new AbortController();
    this.activeQueries.set(queryId, controller);

    try {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        controller.abort();
        console.warn(`Query ${queryId} aborted due to timeout (${timeoutMs}ms)`);
      }, timeoutMs);

      // Execute query with abort signal
      const result = await queryFn(controller.signal);

      // Clear timeout on success
      clearTimeout(timeoutHandle);
      
      return result;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Query timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      // Clean up
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Cancel a specific query
   */
  static cancelQuery(queryId: string): boolean {
    const controller = this.activeQueries.get(queryId);
    if (controller) {
      controller.abort();
      this.activeQueries.delete(queryId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active queries
   */
  static cancelAllQueries(): number {
    const count = this.activeQueries.size;
    
    for (const [queryId, controller] of this.activeQueries) {
      controller.abort();
    }
    
    this.activeQueries.clear();
    return count;
  }

  /**
   * Get active query count
   */
  static getActiveQueryCount(): number {
    return this.activeQueries.size;
  }

  /**
   * Get active query IDs
   */
  static getActiveQueryIds(): string[] {
    return Array.from(this.activeQueries.keys());
  }
}

/**
 * System overload protection
 */
export class OverloadProtection {
  private static queryCount = 0;
  private static lastMinuteQueries: number[] = [];
  private static readonly MAX_QUERIES_PER_MINUTE = 100;
  private static readonly MAX_CONCURRENT_QUERIES = 10;

  /**
   * Check if system can handle a new query
   */
  static canAcceptQuery(): { 
    canAccept: boolean; 
    reason?: string; 
    waitTime?: number 
  } {
    
    // Check concurrent query limit
    const activeQueries = QueryTimeoutEnforcer.getActiveQueryCount();
    if (activeQueries >= this.MAX_CONCURRENT_QUERIES) {
      return {
        canAccept: false,
        reason: `Maximum concurrent queries reached (${this.MAX_CONCURRENT_QUERIES})`,
        waitTime: 1000 // Suggest waiting 1 second
      };
    }

    // Check rate limit (queries per minute)
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Clean old entries
    this.lastMinuteQueries = this.lastMinuteQueries.filter(time => time > oneMinuteAgo);
    
    if (this.lastMinuteQueries.length >= this.MAX_QUERIES_PER_MINUTE) {
      const oldestQuery = Math.min(...this.lastMinuteQueries);
      const waitTime = 60000 - (now - oldestQuery);
      
      return {
        canAccept: false,
        reason: `Rate limit exceeded (${this.MAX_QUERIES_PER_MINUTE} queries per minute)`,
        waitTime: Math.max(1000, waitTime)
      };
    }

    return { canAccept: true };
  }

  /**
   * Register a new query attempt
   */
  static registerQuery(): void {
    this.queryCount++;
    this.lastMinuteQueries.push(Date.now());
  }

  /**
   * Get current load statistics
   */
  static getLoadStats(): {
    totalQueries: number;
    lastMinuteQueries: number;
    activeQueries: number;
    loadLevel: 'low' | 'medium' | 'high' | 'critical';
  } {
    const activeQueries = QueryTimeoutEnforcer.getActiveQueryCount();
    const lastMinuteQueries = this.lastMinuteQueries.length;
    
    // Calculate load level
    let loadLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    if (activeQueries >= this.MAX_CONCURRENT_QUERIES * 0.8 || 
        lastMinuteQueries >= this.MAX_QUERIES_PER_MINUTE * 0.8) {
      loadLevel = 'critical';
    } else if (activeQueries >= this.MAX_CONCURRENT_QUERIES * 0.6 || 
               lastMinuteQueries >= this.MAX_QUERIES_PER_MINUTE * 0.6) {
      loadLevel = 'high';
    } else if (activeQueries >= this.MAX_CONCURRENT_QUERIES * 0.3 || 
               lastMinuteQueries >= this.MAX_QUERIES_PER_MINUTE * 0.3) {
      loadLevel = 'medium';
    }

    return {
      totalQueries: this.queryCount,
      lastMinuteQueries,
      activeQueries,
      loadLevel
    };
  }

  /**
   * Reset load tracking (for testing or maintenance)
   */
  static reset(): void {
    this.queryCount = 0;
    this.lastMinuteQueries = [];
  }
}