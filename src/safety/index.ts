/**
 * Query Safety Layer - Main exports
 * 
 * This module provides comprehensive query safety, validation, and performance monitoring
 * for the Validis Agent financial data analysis system.
 * 
 * Key Components:
 * - Query Parser: Analyzes SQL queries for security patterns
 * - Query Validator: Validates queries against safety policies  
 * - Query Governor: Enforces safety policies and modifies queries
 * - Query Cost Estimator: Predicts query performance and resource usage
 * - Circuit Breaker: Prevents system overload with failure protection
 * - Query Queue: Manages concurrent query execution with prioritization
 * - Safety Metrics: Collects performance data and audit logs
 */

// Core safety components
export { QueryParser } from './parser';
export { QueryValidator } from './validator';
export { QueryGovernor } from './governor';
export { QueryCostEstimator } from './estimator';

// Protection and reliability
export { 
  QueryCircuitBreaker, 
  QueryTimeoutEnforcer, 
  OverloadProtection 
} from './circuitBreaker';

// Queue management
export { QueryQueueManager } from './queue';

// Metrics and monitoring
export { 
  SafetyMetricsCollector, 
  QueryPerformanceAnalyzer 
} from './metrics';

/**
 * Safety layer configuration
 */
export const SafetyConfig = {
  // Default limits
  DEFAULT_MAX_ROWS: 100,
  AUDIT_MAX_ROWS: 1000,
  DEFAULT_TIMEOUT_MS: 5000,
  
  // Queue settings
  MAX_CONCURRENT_QUERIES: 3,
  MAX_QUEUE_SIZE: 50,
  
  // Circuit breaker settings
  FAILURE_THRESHOLD: 5,
  RECOVERY_TIMEOUT_MS: 60000,
  
  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 20,
  MAX_SYSTEM_REQUESTS_PER_MINUTE: 100,
  
  // Performance thresholds
  SLOW_QUERY_THRESHOLD_MS: 5000,
  HIGH_COMPLEXITY_SCORE: 8,
  
  // Risk levels
  RISK_LEVELS: {
    LOW: { maxRows: 1000, timeoutMs: 10000 },
    MEDIUM: { maxRows: 500, timeoutMs: 5000 },
    HIGH: { maxRows: 100, timeoutMs: 3000 },
    CRITICAL: { maxRows: 10, timeoutMs: 1000 }
  }
} as const;

/**
 * Initialize safety layer components
 */
export async function initializeSafetyLayer(): Promise<void> {
  console.log('🛡️  Initializing Query Safety Layer...');
  
  try {
    // Import classes locally to avoid circular dependency issues
    const { SafetyMetricsCollector } = await import('./metrics');
    const { QueryQueueManager } = await import('./queue');
    
    // Initialize metrics collector
    const metricsCollector = SafetyMetricsCollector.getInstance();
    
    // Initialize queue manager
    const queueManager = QueryQueueManager.getInstance();
    
    console.log('✅ Query Safety Layer initialized successfully');
    console.log('   - Query validation and governance enabled');
    console.log('   - Circuit breaker protection active');
    console.log('   - Query queue and concurrency limits enforced');
    console.log('   - Performance metrics and audit logging enabled');
    
  } catch (error) {
    console.error('❌ Failed to initialize Query Safety Layer:', error);
    throw error;
  }
}

/**
 * Shutdown safety layer components
 */
export async function shutdownSafetyLayer(): Promise<void> {
  console.log('🛡️  Shutting down Query Safety Layer...');
  
  try {
    // Import classes locally to avoid circular dependency issues
    const { SafetyMetricsCollector } = await import('./metrics');
    const { QueryQueueManager } = await import('./queue');
    
    // Stop queue processing
    const queueManager = QueryQueueManager.getInstance();
    queueManager.stopProcessing();
    
    // Close metrics collector
    const metricsCollector = SafetyMetricsCollector.getInstance();
    await metricsCollector.close();
    
    console.log('✅ Query Safety Layer shutdown complete');
    
  } catch (error) {
    console.error('❌ Error during Query Safety Layer shutdown:', error);
  }
}