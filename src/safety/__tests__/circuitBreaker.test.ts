import { 
  QueryCircuitBreaker, 
  QueryTimeoutEnforcer, 
  OverloadProtection 
} from '../circuitBreaker';

describe('QueryCircuitBreaker', () => {
  let circuitBreaker: QueryCircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new QueryCircuitBreaker('test', 2, 100, 1); // Low thresholds for testing
  });

  describe('execute', () => {
    it('should execute function successfully when circuit is closed', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should track failures and open circuit after threshold', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // First failure
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('test error');
      expect(circuitBreaker.getState().state).toBe('closed');
      
      // Second failure should open circuit
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('test error');
      expect(circuitBreaker.getState().state).toBe('open');
    });

    it('should reject requests when circuit is open', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Cause failures to open circuit
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      
      // Now circuit should be open and reject without calling function
      mockFn.mockClear();
      await expect(circuitBreaker.execute(mockFn))
        .rejects.toThrow('Circuit breaker test is OPEN - request rejected');
      
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should transition to half-open after recovery timeout', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Open the circuit
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      expect(circuitBreaker.getState().state).toBe('open');
      
      // Wait for recovery timeout (using short timeout for testing)
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Next call should transition to half-open
      mockFn.mockResolvedValue('success');
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(circuitBreaker.getState().state).toBe('closed'); // Should close after successful half-open call
    });

    it('should reset failure count on successful execution', async () => {
      const mockFn = jest.fn();
      
      // One failure
      mockFn.mockRejectedValueOnce(new Error('test error'));
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      expect(circuitBreaker.getState().failureCount).toBe(1);
      
      // Success should reset count
      mockFn.mockResolvedValueOnce('success');
      await circuitBreaker.execute(mockFn);
      expect(circuitBreaker.getState().failureCount).toBe(0);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when circuit is closed', () => {
      const status = circuitBreaker.getHealthStatus();
      
      expect(status.isHealthy).toBe(true);
      expect(status.state).toBe('closed');
      expect(status.failureCount).toBe(0);
    });

    it('should return unhealthy status when circuit is open', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Open the circuit
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      
      const status = circuitBreaker.getHealthStatus();
      
      expect(status.isHealthy).toBe(false);
      expect(status.state).toBe('open');
      expect(status.failureCount).toBe(2);
      expect(status.nextAttemptIn).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset circuit breaker to closed state', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Open the circuit
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      expect(circuitBreaker.getState().state).toBe('open');
      
      // Reset should close circuit
      circuitBreaker.reset();
      expect(circuitBreaker.getState().state).toBe('closed');
      expect(circuitBreaker.getState().failureCount).toBe(0);
    });
  });
});

describe('QueryTimeoutEnforcer', () => {
  beforeEach(() => {
    // Clear any active queries
    QueryTimeoutEnforcer.cancelAllQueries();
  });

  describe('executeWithTimeout', () => {
    it('should execute function successfully within timeout', async () => {
      const mockFn = jest.fn().mockImplementation(async (signal) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      });
      
      const result = await QueryTimeoutEnforcer.executeWithTimeout(
        'test-query',
        mockFn,
        100
      );
      
      expect(result).toBe('success');
    });

    it('should timeout long-running functions', async () => {
      const mockFn = jest.fn().mockImplementation(async (signal) => {
        // Check for abort signal and throw proper error
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('AbortError');
            error.name = 'AbortError';
            reject(error);
          });
          setTimeout(() => resolve('success'), 200);
        });
      });
      
      await expect(
        QueryTimeoutEnforcer.executeWithTimeout('test-query', mockFn, 50)
      ).rejects.toThrow('Query timeout after 50ms');
    });

    it('should handle abort signal in function', async () => {
      const mockFn = jest.fn().mockImplementation(async (signal) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('AbortError');
            error.name = 'AbortError';
            reject(error);
          });
          setTimeout(resolve, 200);
        });
      });
      
      await expect(
        QueryTimeoutEnforcer.executeWithTimeout('test-query', mockFn, 50)
      ).rejects.toThrow('Query timeout after 50ms');
    });

    it('should clean up after execution', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      expect(QueryTimeoutEnforcer.getActiveQueryCount()).toBe(0);
      
      const promise = QueryTimeoutEnforcer.executeWithTimeout('test-query', mockFn, 100);
      expect(QueryTimeoutEnforcer.getActiveQueryCount()).toBe(1);
      
      await promise;
      expect(QueryTimeoutEnforcer.getActiveQueryCount()).toBe(0);
    });
  });

  describe('cancelQuery', () => {
    it('should cancel specific query', async () => {
      const mockFn = jest.fn().mockImplementation(async (signal) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('Cancelled');
            error.name = 'AbortError';
            reject(error);
          });
          setTimeout(resolve, 200);
        });
        return 'success';
      });
      
      const promise = QueryTimeoutEnforcer.executeWithTimeout('test-query', mockFn, 1000);
      
      // Cancel after short delay
      setTimeout(() => {
        QueryTimeoutEnforcer.cancelQuery('test-query');
      }, 10);
      
      await expect(promise).rejects.toThrow('Query timeout');
    });

    it('should return false when trying to cancel non-existent query', () => {
      const result = QueryTimeoutEnforcer.cancelQuery('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('cancelAllQueries', () => {
    it('should cancel all active queries', async () => {
      const mockFn = jest.fn().mockImplementation(async (signal) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'success';
      });
      
      // Start multiple queries
      const promises = [
        QueryTimeoutEnforcer.executeWithTimeout('query-1', mockFn, 1000),
        QueryTimeoutEnforcer.executeWithTimeout('query-2', mockFn, 1000),
        QueryTimeoutEnforcer.executeWithTimeout('query-3', mockFn, 1000)
      ];
      
      expect(QueryTimeoutEnforcer.getActiveQueryCount()).toBe(3);
      
      const cancelledCount = QueryTimeoutEnforcer.cancelAllQueries();
      expect(cancelledCount).toBe(3);
      expect(QueryTimeoutEnforcer.getActiveQueryCount()).toBe(0);
      
      // All promises should reject
      await Promise.allSettled(promises);
    });
  });
});

describe('OverloadProtection', () => {
  beforeEach(() => {
    OverloadProtection.reset();
  });

  describe('canAcceptQuery', () => {
    it('should accept queries when system is not overloaded', () => {
      const result = OverloadProtection.canAcceptQuery();
      
      expect(result.canAccept).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject queries when concurrent limit is reached', async () => {
      // Mock active queries
      jest.spyOn(QueryTimeoutEnforcer, 'getActiveQueryCount').mockReturnValue(10);
      
      const result = OverloadProtection.canAcceptQuery();
      
      expect(result.canAccept).toBe(false);
      expect(result.reason).toContain('Maximum concurrent queries reached');
      expect(result.waitTime).toBe(1000);
    });

    it('should reject queries when rate limit is exceeded', () => {
      // Mock no active queries to avoid concurrent limit
      jest.spyOn(QueryTimeoutEnforcer, 'getActiveQueryCount').mockReturnValue(0);
      
      // Simulate many queries in short time
      for (let i = 0; i < 100; i++) {
        OverloadProtection.registerQuery();
      }
      
      const result = OverloadProtection.canAcceptQuery();
      
      expect(result.canAccept).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
      expect(result.waitTime).toBeGreaterThan(0);
    });
  });

  describe('registerQuery', () => {
    it('should register query attempts', () => {
      const initialStats = OverloadProtection.getLoadStats();
      
      OverloadProtection.registerQuery();
      OverloadProtection.registerQuery();
      
      const updatedStats = OverloadProtection.getLoadStats();
      
      expect(updatedStats.totalQueries).toBe(initialStats.totalQueries + 2);
      expect(updatedStats.lastMinuteQueries).toBe(2);
    });
  });

  describe('getLoadStats', () => {
    it('should return accurate load statistics', () => {
      // Register some queries
      OverloadProtection.registerQuery();
      OverloadProtection.registerQuery();
      
      const stats = OverloadProtection.getLoadStats();
      
      expect(stats.totalQueries).toBe(2);
      expect(stats.lastMinuteQueries).toBe(2);
      expect(stats.activeQueries).toBeGreaterThanOrEqual(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(stats.loadLevel);
    });

    it('should calculate load levels correctly', () => {
      // Simulate high load
      for (let i = 0; i < 80; i++) {
        OverloadProtection.registerQuery();
      }
      
      const stats = OverloadProtection.getLoadStats();
      
      expect(stats.loadLevel).toBe('critical');
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      // Register some queries
      OverloadProtection.registerQuery();
      OverloadProtection.registerQuery();
      
      let stats = OverloadProtection.getLoadStats();
      expect(stats.totalQueries).toBe(2);
      
      OverloadProtection.reset();
      
      stats = OverloadProtection.getLoadStats();
      expect(stats.totalQueries).toBe(0);
      expect(stats.lastMinuteQueries).toBe(0);
    });
  });
});