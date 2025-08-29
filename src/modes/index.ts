/**
 * Mode Manager and Factory Implementation
 * 
 * Provides centralized management of workflow modes, session context,
 * and strategy pattern implementation for audit and lending modes.
 */

import { 
  ModeStrategy,
  ModeManager,
  ModeFactory,
  WorkflowMode,
  ModeContext,
  SessionContext,
  ModeValidation,
  QueryModification,
  ModeConfig
} from './types';
import { AuditModeStrategy } from './audit';
import { LendingModeStrategy } from './lending';
import { config } from '../config';

/**
 * Factory for creating mode strategy instances
 */
export class WorkflowModeFactory implements ModeFactory {
  private strategies: Map<WorkflowMode, ModeStrategy> = new Map();

  constructor() {
    // Initialize mode strategies
    this.strategies.set('audit', new AuditModeStrategy());
    this.strategies.set('lending', new LendingModeStrategy());
  }

  createMode(mode: WorkflowMode): ModeStrategy {
    const strategy = this.strategies.get(mode);
    if (!strategy) {
      throw new Error(`Unsupported workflow mode: ${mode}`);
    }
    return strategy;
  }

  getAvailableModes(): WorkflowMode[] {
    return Array.from(this.strategies.keys());
  }

  validateModeConfig(mode: WorkflowMode): boolean {
    return this.strategies.has(mode);
  }
}

/**
 * Central manager for workflow modes and session context
 */
export class WorkflowModeManager implements ModeManager {
  private factory: WorkflowModeFactory;
  private currentStrategy: ModeStrategy | null = null;
  private sessionLocked: boolean = false;
  private config: ModeConfig;

  constructor(modeConfig?: Partial<ModeConfig>) {
    this.factory = new WorkflowModeFactory();
    this.config = {
      defaultMode: 'audit', // Default fallback
      allowModeSwitching: false, // Locked after session start
      modeLockTimeout: 8 * 60 * 60 * 1000, // 8 hours
      sessionTimeout: 12 * 60 * 60 * 1000, // 12 hours
      maxSessionsPerClient: 5,
      requireJWTForModeSwitch: true,
      allowedModeClaimSources: ['jwt', 'config'],
      ...modeConfig
    };
  }

  getCurrentMode(): ModeStrategy {
    if (!this.currentStrategy) {
      // Use default mode from configuration
      this.currentStrategy = this.factory.createMode(this.config.defaultMode);
    }
    return this.currentStrategy;
  }

  canSwitchMode(): boolean {
    return !this.sessionLocked && this.config.allowModeSwitching;
  }

  async initializeMode(
    mode: WorkflowMode,
    sessionId: string,
    clientId: string,
    uploadId?: string
  ): Promise<SessionContext> {
    // Validate mode
    if (!this.factory.validateModeConfig(mode)) {
      throw new Error(`Invalid workflow mode: ${mode}`);
    }

    // Lock the session to prevent mode switching
    this.sessionLocked = true;
    
    // Set the current strategy
    this.currentStrategy = this.factory.createMode(mode);

    // Initialize session context
    const baseContext: SessionContext = {
      sessionId,
      clientId,
      mode,
      currentUploadId: uploadId,
      availableUploadIds: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      locked: true
    };

    // Get mode-specific initialization
    const modeSpecificContext = await this.currentStrategy.initializeSession(clientId, uploadId);

    // Merge contexts
    const sessionContext: SessionContext = {
      ...baseContext,
      ...modeSpecificContext
    };

    // Validate the initialized session
    const validation = this.currentStrategy.validateSession(sessionContext);
    if (!validation.isValid) {
      console.warn('Session validation warnings:', validation.warnings);
      if (validation.errors.length > 0) {
        console.error('Session validation errors:', validation.errors);
      }
    }

    console.log(`✅ Initialized ${mode} mode session for client ${clientId}`);
    
    return sessionContext;
  }

  async validateQuery(query: string, sessionContext: SessionContext): Promise<ModeValidation> {
    const strategy = this.getCurrentMode();
    
    // Create mode context from session
    const modeContext: ModeContext = {
      clientId: sessionContext.clientId,
      uploadId: sessionContext.currentUploadId,
      sessionId: sessionContext.sessionId,
      mode: sessionContext.mode,
      lockedAt: sessionContext.createdAt
    };

    // Validate with the current strategy
    return await strategy.validateQuery(query, modeContext);
  }

  async applyModeConstraints(query: string, sessionContext: SessionContext): Promise<QueryModification> {
    const strategy = this.getCurrentMode();
    
    // Create mode context from session
    const modeContext: ModeContext = {
      clientId: sessionContext.clientId,
      uploadId: sessionContext.currentUploadId,
      sessionId: sessionContext.sessionId,
      mode: sessionContext.mode,
      lockedAt: sessionContext.createdAt
    };

    // Apply strategy-specific modifications
    return await strategy.modifyQuery(query, modeContext);
  }

  getModeRecommendations(sessionContext: SessionContext): string[] {
    const strategy = this.getCurrentMode();
    const recommendations: string[] = [];

    // Get available actions for the current mode
    const availableActions = strategy.getAvailableActions();
    recommendations.push(`Available actions for ${sessionContext.mode} mode: ${availableActions.join(', ')}`);

    // Mode-specific recommendations
    if (sessionContext.mode === 'audit') {
      if (!sessionContext.currentUploadId) {
        recommendations.push('Set a specific company context for focused audit analysis');
      }
      recommendations.push('Use audit templates for compliance and risk analysis');
      
      if (sessionContext.availableUploadIds.length > 1) {
        recommendations.push('Compare data across different time periods for the same company');
      }
    }

    if (sessionContext.mode === 'lending') {
      if (sessionContext.portfolioContext) {
        if (sessionContext.portfolioContext.totalCompanies > 1) {
          recommendations.push('Leverage portfolio analysis for comparative insights');
          recommendations.push('Use aggregation functions for portfolio-wide metrics');
        }
        
        if (sessionContext.portfolioContext.totalCompanies < 5) {
          recommendations.push('Consider expanding portfolio for more robust analysis');
        }
      }
      
      recommendations.push('Use lending templates for financial ratio and cash flow analysis');
      
      if (sessionContext.currentUploadId) {
        recommendations.push('Switch to portfolio view for comparative analysis');
      } else {
        recommendations.push('Drill down to specific companies for detailed analysis');
      }
    }

    // Session health recommendations
    const sessionAge = Date.now() - sessionContext.createdAt.getTime();
    if (sessionAge > this.config.sessionTimeout * 0.8) {
      recommendations.push('Session approaching timeout - consider refreshing');
    }

    return recommendations;
  }

  /**
   * Get mode-specific constraints for external use
   */
  getModeConstraints(mode?: WorkflowMode): any {
    const strategy = mode ? this.factory.createMode(mode) : this.getCurrentMode();
    return strategy.getConstraints();
  }

  /**
   * Apply mode-specific scoping to a query
   */
  applyScopingToQuery(query: string, sessionContext: SessionContext): string {
    const strategy = this.getCurrentMode();
    
    const modeContext: ModeContext = {
      clientId: sessionContext.clientId,
      uploadId: sessionContext.currentUploadId,
      sessionId: sessionContext.sessionId,
      mode: sessionContext.mode,
      lockedAt: sessionContext.createdAt
    };

    return strategy.applyScoping(query, modeContext);
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionContext: SessionContext): any {
    return {
      mode: sessionContext.mode,
      sessionAge: Date.now() - sessionContext.createdAt.getTime(),
      lastActivity: sessionContext.lastActivity,
      uploadContext: {
        current: sessionContext.currentUploadId,
        available: sessionContext.availableUploadIds.length
      },
      companyContext: sessionContext.companyContext,
      portfolioContext: sessionContext.portfolioContext,
      locked: sessionContext.locked,
      recommendations: this.getModeRecommendations(sessionContext)
    };
  }

  /**
   * Update session activity
   */
  updateSessionActivity(sessionContext: SessionContext): SessionContext {
    return {
      ...sessionContext,
      lastActivity: new Date()
    };
  }

  /**
   * Check if session is valid/active
   */
  isSessionValid(sessionContext: SessionContext): boolean {
    const sessionAge = Date.now() - sessionContext.createdAt.getTime();
    const inactivityAge = Date.now() - sessionContext.lastActivity.getTime();
    
    return sessionAge < this.config.sessionTimeout && 
           inactivityAge < this.config.sessionTimeout &&
           sessionContext.locked;
  }

  /**
   * Reset mode manager (for testing or emergency situations)
   */
  reset(): void {
    this.currentStrategy = null;
    this.sessionLocked = false;
    console.log('🔄 Mode manager reset');
  }

  /**
   * Get mode configuration
   */
  getModeConfig(): ModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration after validation (called from server startup)
   */
  updateConfigFromEnvironment(): void {
    try {
      this.config.defaultMode = config.workflowMode;
      // Update other config values from validated environment
      // This ensures we get the actual env values after validation
    } catch (error) {
      // Config not ready yet, use defaults
      console.warn('Config not available yet, using default mode configuration');
    }
  }

  /**
   * Set upload context for current session
   */
  async setUploadContext(
    sessionContext: SessionContext, 
    uploadId: string
  ): Promise<SessionContext> {
    const strategy = this.getCurrentMode();
    
    // Validate upload context
    const modeContext: ModeContext = {
      clientId: sessionContext.clientId,
      uploadId,
      sessionId: sessionContext.sessionId,
      mode: sessionContext.mode,
      lockedAt: sessionContext.createdAt
    };

    const uploadValidation = await strategy.validateUploadContext(uploadId, modeContext);
    if (!uploadValidation.isValid) {
      throw new Error(`Invalid upload context: ${uploadValidation.errors.join(', ')}`);
    }

    // Update session context
    const updatedContext: SessionContext = {
      ...sessionContext,
      currentUploadId: uploadId,
      companyContext: uploadValidation.companyName ? {
        name: uploadValidation.companyName,
        uploadId,
        period: uploadValidation.period || ''
      } : undefined,
      lastActivity: new Date()
    };

    return updatedContext;
  }
}

// Export singleton instance
export const modeManager = new WorkflowModeManager();

// Export factory for direct access
export const modeFactory = new WorkflowModeFactory();

// Export types
export * from './types';
export { AuditModeStrategy } from './audit';
export { LendingModeStrategy } from './lending';