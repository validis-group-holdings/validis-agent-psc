/**
 * Mode Strategy Pattern Types for Audit and Lending Workflows
 * 
 * Defines interfaces for mode-specific behavior strategies that enforce
 * business rules, scoping, and validation based on the active workflow mode.
 */

export interface ModeContext {
  clientId: string;
  uploadId?: string;
  sessionId: string;
  mode: WorkflowMode;
  lockedAt: Date;
}

export type WorkflowMode = 'audit' | 'lending';

export interface ModeConstraints {
  // Query scoping constraints
  requiresUploadId: boolean;
  allowsMultipleUploads: boolean;
  requiresClientIdFilter: boolean;
  allowsCrossClientQueries: boolean;
  
  // Data access constraints
  maxRowsPerQuery: number;
  allowedTablePatterns: string[];
  restrictedOperations: string[];
  
  // Time-based constraints
  allowsHistoricalData: boolean;
  maxHistoryDays?: number;
  
  // Validation rules
  mandatoryFilters: string[];
  prohibitedColumns: string[];
}

export interface QueryModification {
  originalQuery: string;
  modifiedQuery: string;
  appliedConstraints: string[];
  warnings: string[];
  errors: string[];
}

export interface ModeValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  requiredContext?: {
    uploadId?: string;
    companyContext?: string;
  };
}

export interface SessionContext {
  sessionId: string;
  clientId: string;
  mode: WorkflowMode;
  currentUploadId?: string;
  availableUploadIds: string[];
  companyContext?: {
    name: string;
    uploadId: string;
    period: string;
  };
  portfolioContext?: {
    totalCompanies: number;
    activeUploadIds: string[];
  };
  createdAt: Date;
  lastActivity: Date;
  locked: boolean;
}

/**
 * Base interface for mode strategy implementations
 */
export interface ModeStrategy {
  /**
   * Get the constraints for this mode
   */
  getConstraints(): ModeConstraints;
  
  /**
   * Validate a query against mode rules
   */
  validateQuery(query: string, context: ModeContext): Promise<ModeValidation>;
  
  /**
   * Apply mode-specific modifications to a query
   */
  modifyQuery(query: string, context: ModeContext): Promise<QueryModification>;
  
  /**
   * Initialize mode-specific session context
   */
  initializeSession(clientId: string, uploadId?: string): Promise<Partial<SessionContext>>;
  
  /**
   * Validate session context against mode requirements
   */
  validateSession(context: SessionContext): ModeValidation;
  
  /**
   * Get available actions/templates for this mode
   */
  getAvailableActions(): string[];
  
  /**
   * Handle mode-specific query scoping
   */
  applyScoping(query: string, context: ModeContext): string;
  
  /**
   * Validate upload context requirements
   */
  validateUploadContext(uploadId: string | undefined, context: ModeContext): Promise<UploadContextValidation>;
}

/**
 * Mode manager interface for handling mode switching and validation
 */
export interface ModeManager {
  /**
   * Get the current active mode strategy
   */
  getCurrentMode(): ModeStrategy;
  
  /**
   * Check if mode can be switched (should be locked after session start)
   */
  canSwitchMode(): boolean;
  
  /**
   * Initialize a mode for a session
   */
  initializeMode(mode: WorkflowMode, sessionId: string, clientId: string, uploadId?: string): Promise<SessionContext>;
  
  /**
   * Validate a query against the current mode
   */
  validateQuery(query: string, sessionContext: SessionContext): Promise<ModeValidation>;
  
  /**
   * Apply mode-specific query modifications
   */
  applyModeConstraints(query: string, sessionContext: SessionContext): Promise<QueryModification>;
  
  /**
   * Get mode-specific recommendations
   */
  getModeRecommendations(sessionContext: SessionContext): string[];
}

/**
 * Mode factory interface for creating mode strategies
 */
export interface ModeFactory {
  /**
   * Create a mode strategy instance
   */
  createMode(mode: WorkflowMode): ModeStrategy;
  
  /**
   * Get all available modes
   */
  getAvailableModes(): WorkflowMode[];
  
  /**
   * Validate mode configuration
   */
  validateModeConfig(mode: WorkflowMode): boolean;
}

/**
 * Mode configuration interface
 */
export interface ModeConfig {
  // Default mode from environment
  defaultMode: WorkflowMode;
  
  // Mode switching settings
  allowModeSwitching: boolean;
  modeLockTimeout: number; // milliseconds
  
  // Session settings
  sessionTimeout: number; // milliseconds
  maxSessionsPerClient: number;
  
  // Security settings
  requireJWTForModeSwitch: boolean;
  allowedModeClaimSources: string[];
}

/**
 * Upload context validation result
 */
export interface UploadContextValidation {
  isValid: boolean;
  uploadExists: boolean;
  belongsToClient: boolean;
  isActive: boolean;
  companyName?: string;
  period?: string;
  errors: string[];
  warnings: string[];
}