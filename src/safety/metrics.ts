import { SafetyMetrics, QueryResult } from '@/types';
import { createClient } from 'redis';
import { config } from '@/config';

/**
 * Performance metrics collector and audit logger
 */
export class SafetyMetricsCollector {
  private static instance: SafetyMetricsCollector;
  private redisClient?: any;
  private metrics: SafetyMetrics = {
    totalQueries: 0,
    blockedQueries: 0,
    timeouts: 0,
    averageExecutionTime: 0,
    queueLength: 0,
    concurrentExecutions: 0
  };
  
  private executionTimes: number[] = [];
  private metricsHistory: SafetyMetrics[] = [];

  private constructor() {
    this.initRedis();
    this.startPeriodicCollection();
  }

  static getInstance(): SafetyMetricsCollector {
    if (!this.instance) {
      this.instance = new SafetyMetricsCollector();
    }
    return this.instance;
  }

  /**
   * Initialize Redis connection for metrics storage
   */
  private async initRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: config.redis.url,
        password: config.redis.password
      });

      this.redisClient.on('error', (error: Error) => {
        console.error('Redis error in metrics collector:', error);
      });

      await this.redisClient.connect();
      console.log('✅ SafetyMetricsCollector connected to Redis');
    } catch (error) {
      console.warn('⚠️ SafetyMetricsCollector could not connect to Redis, using in-memory storage');
    }
  }

  /**
   * Start periodic metrics collection
   */
  private startPeriodicCollection(): void {
    // Collect metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Save historical data every 5 minutes
    setInterval(() => {
      this.saveHistoricalMetrics();
    }, 300000);
  }

  /**
   * Record a query attempt
   */
  recordQueryAttempt(
    queryId: string,
    clientId: string,
    workflowMode: 'audit' | 'lending',
    query: string,
    blocked = false
  ): void {
    this.metrics.totalQueries++;
    
    if (blocked) {
      this.metrics.blockedQueries++;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      event: 'query_attempt',
      queryId,
      clientId,
      workflowMode,
      queryLength: query.length,
      blocked,
      userAgent: '', // Will be filled by middleware
      ip: ''
    };

    this.writeAuditLog(auditEntry);
  }

  /**
   * Record query execution result
   */
  recordQueryExecution(
    queryId: string,
    result: QueryResult | null,
    executionTime: number,
    status: 'completed' | 'failed' | 'timeout',
    error?: string
  ): void {
    
    if (status === 'timeout') {
      this.metrics.timeouts++;
    }

    if (status === 'completed' && result) {
      this.executionTimes.push(executionTime);
      
      // Keep only last 100 execution times for rolling average
      if (this.executionTimes.length > 100) {
        this.executionTimes.shift();
      }
      
      // Recalculate average
      this.metrics.averageExecutionTime = 
        this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      event: 'query_execution',
      queryId,
      status,
      executionTime,
      rowCount: result?.rowCount || 0,
      error
    };

    this.writeAuditLog(auditEntry);
  }

  /**
   * Update queue metrics
   */
  updateQueueMetrics(queueLength: number, concurrentExecutions: number): void {
    this.metrics.queueLength = queueLength;
    this.metrics.concurrentExecutions = concurrentExecutions;
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): SafetyMetrics {
    return { ...this.metrics };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): SafetyMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Write audit log entry
   */
  private writeAuditLog(entry: any): void {
    // Console logging (always available)
    console.log('AUDIT:', JSON.stringify(entry));

    // Redis logging (if available)
    if (this.redisClient) {
      const key = `audit:${new Date().toISOString().split('T')[0]}`; // Daily key
      this.redisClient.lPush(key, JSON.stringify(entry)).catch((error: Error) => {
        console.error('Failed to write audit log to Redis:', error);
      });

      // Set expiration for daily logs (30 days)
      this.redisClient.expire(key, 30 * 24 * 60 * 60).catch((error: Error) => {
        console.error('Failed to set audit log expiration:', error);
      });
    }
  }

  /**
   * Collect system-wide metrics
   */
  private collectSystemMetrics(): void {
    const systemMetrics = {
      timestamp: new Date().toISOString(),
      event: 'system_metrics',
      metrics: this.metrics,
      nodeMemoryUsage: process.memoryUsage(),
      nodeCpuUsage: process.cpuUsage(),
      nodeUptime: process.uptime()
    };

    this.writeAuditLog(systemMetrics);

    // Store in Redis with expiration
    if (this.redisClient) {
      const key = `metrics:system:${Date.now()}`;
      this.redisClient.setEx(key, 86400, JSON.stringify(systemMetrics)).catch((error: Error) => {
        console.error('Failed to store system metrics in Redis:', error);
      });
    }
  }

  /**
   * Save historical metrics snapshot
   */
  private saveHistoricalMetrics(): void {
    const snapshot = {
      ...this.metrics,
      timestamp: new Date()
    };

    this.metricsHistory.push(snapshot);

    // Keep only last 24 hours of history (288 entries at 5-minute intervals)
    if (this.metricsHistory.length > 288) {
      this.metricsHistory.shift();
    }

    // Persist to Redis
    if (this.redisClient) {
      const key = 'metrics:history';
      this.redisClient.setEx(key, 86400, JSON.stringify(this.metricsHistory)).catch((error: Error) => {
        console.error('Failed to save metrics history to Redis:', error);
      });
    }
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(timeframe: 'hour' | 'day' | 'week' = 'day'): {
    summary: any;
    recommendations: string[];
    alerts: string[];
  } {
    const now = new Date();
    const alerts: string[] = [];
    const recommendations: string[] = [];

    // Calculate success rate
    const totalAttempts = this.metrics.totalQueries;
    const successfulQueries = totalAttempts - this.metrics.blockedQueries - this.metrics.timeouts;
    const successRate = totalAttempts > 0 ? (successfulQueries / totalAttempts) * 100 : 100;

    // Generate alerts
    if (successRate < 95) {
      alerts.push(`Low success rate: ${successRate.toFixed(1)}%`);
    }
    
    if (this.metrics.averageExecutionTime > 5000) {
      alerts.push(`High average execution time: ${this.metrics.averageExecutionTime.toFixed(0)}ms`);
    }
    
    if (this.metrics.queueLength > 10) {
      alerts.push(`High queue length: ${this.metrics.queueLength} queries`);
    }
    
    if (this.metrics.timeouts > this.metrics.totalQueries * 0.1) {
      alerts.push(`High timeout rate: ${((this.metrics.timeouts / this.metrics.totalQueries) * 100).toFixed(1)}%`);
    }

    // Generate recommendations
    if (this.metrics.averageExecutionTime > 3000) {
      recommendations.push('Consider optimizing query patterns or adding more restrictive TOP clauses');
    }
    
    if (this.metrics.blockedQueries > this.metrics.totalQueries * 0.05) {
      recommendations.push('High query rejection rate - review validation rules or provide better guidance');
    }
    
    if (this.metrics.queueLength > 5) {
      recommendations.push('Consider increasing concurrent execution limit or optimizing query performance');
    }

    const summary = {
      timeframe,
      generatedAt: now.toISOString(),
      totalQueries: this.metrics.totalQueries,
      successfulQueries,
      blockedQueries: this.metrics.blockedQueries,
      timeouts: this.metrics.timeouts,
      successRate: parseFloat(successRate.toFixed(2)),
      averageExecutionTime: Math.round(this.metrics.averageExecutionTime),
      currentQueueLength: this.metrics.queueLength,
      currentConcurrentExecutions: this.metrics.concurrentExecutions
    };

    return {
      summary,
      recommendations,
      alerts
    };
  }

  /**
   * Get audit logs for a specific period
   */
  async getAuditLogs(
    startDate: Date,
    endDate: Date,
    eventType?: string
  ): Promise<any[]> {
    if (!this.redisClient) {
      return [];
    }

    const logs: any[] = [];
    const currentDate = new Date(startDate);

    try {
      while (currentDate <= endDate) {
        const key = `audit:${currentDate.toISOString().split('T')[0]}`;
        const dayLogs = await this.redisClient.lrange(key, 0, -1);
        
        for (const logEntry of dayLogs) {
          try {
            const parsed = JSON.parse(logEntry);
            if (!eventType || parsed.event === eventType) {
              logs.push(parsed);
            }
          } catch (error) {
            console.error('Failed to parse audit log entry:', error);
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    } catch (error) {
      console.error('Failed to retrieve audit logs:', error);
    }

    return logs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Reset metrics (for testing or maintenance)
   */
  resetMetrics(): void {
    this.metrics = {
      totalQueries: 0,
      blockedQueries: 0,
      timeouts: 0,
      averageExecutionTime: 0,
      queueLength: 0,
      concurrentExecutions: 0
    };
    
    this.executionTimes = [];
    this.metricsHistory = [];

    this.writeAuditLog({
      timestamp: new Date().toISOString(),
      event: 'metrics_reset',
      reason: 'Manual reset'
    });
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}

/**
 * Query performance analyzer
 */
export class QueryPerformanceAnalyzer {
  
  /**
   * Analyze query performance patterns
   */
  static analyzePerformancePatterns(executionHistory: any[]): {
    slowQueries: any[];
    frequentPatterns: any[];
    performanceInsights: string[];
  } {
    const slowQueries = executionHistory
      .filter(query => query.executionTime > 5000)
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    // Group by query patterns (simplified)
    const patternCounts = new Map<string, number>();
    executionHistory.forEach(query => {
      const pattern = this.extractQueryPattern(query.query || '');
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
    });

    const frequentPatterns = Array.from(patternCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));

    const performanceInsights: string[] = [];
    
    if (slowQueries.length > 0) {
      performanceInsights.push(`${slowQueries.length} queries taking over 5 seconds detected`);
    }
    
    const avgTime = executionHistory.reduce((sum, q) => sum + (q.executionTime || 0), 0) / executionHistory.length;
    if (avgTime > 2000) {
      performanceInsights.push(`Average query time is ${Math.round(avgTime)}ms - consider optimization`);
    }

    return {
      slowQueries,
      frequentPatterns,
      performanceInsights
    };
  }

  /**
   * Extract query pattern for grouping
   */
  private static extractQueryPattern(query: string): string {
    return query
      .replace(/'/g, "'?'") // Replace string literals
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 100); // Limit length
  }
}