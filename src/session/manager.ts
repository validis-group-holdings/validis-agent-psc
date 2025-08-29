/**
 * Session Manager Implementation
 * 
 * Manages user sessions with mode locking, context persistence,
 * and state management across conversation flows.
 */

import { SessionContext, WorkflowMode } from '../modes/types';
import { modeManager } from '../modes';

export interface SessionManagerConfig {
  sessionTimeout: number; // milliseconds
  maxSessionsPerClient: number;
  cleanupInterval: number; // milliseconds
  persistentStorage: boolean;
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  sessionsByMode: Record<WorkflowMode, number>;
  oldestSession: Date | null;
  averageSessionAge: number;
}

/**
 * Central session management with Redis persistence
 */
export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private config: SessionManagerConfig;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = {
      sessionTimeout: 12 * 60 * 60 * 1000, // 12 hours
      maxSessionsPerClient: 5,
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      persistentStorage: false, // Disable Redis for now
      ...config
    };

    this.startCleanupTimer();
  }

  /**
   * Create a new session with mode initialization
   */
  async createSession(
    clientId: string,
    mode: WorkflowMode,
    uploadId?: string
  ): Promise<SessionContext> {
    const sessionId = this.generateSessionId();

    // Check client session limits
    const clientSessionSet = this.clientSessions.get(clientId) || new Set();
    if (clientSessionSet.size >= this.config.maxSessionsPerClient) {
      // Remove oldest session for this client
      await this.removeOldestSessionForClient(clientId);
    }

    // Initialize session through mode manager
    const sessionContext = await modeManager.initializeMode(mode, sessionId, clientId, uploadId);

    // Store session
    this.sessions.set(sessionId, sessionContext);
    
    // Update client session tracking
    clientSessionSet.add(sessionId);
    this.clientSessions.set(clientId, clientSessionSet);

    // Persistence disabled for now

    console.log(`✅ Created session ${sessionId} for client ${clientId} in ${mode} mode`);
    
    return sessionContext;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionContext | null> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }

    // Check if session is still valid
    if (!modeManager.isSessionValid(session)) {
      await this.removeSession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Update session context
   */
  async updateSession(sessionContext: SessionContext): Promise<SessionContext> {
    const updatedContext = modeManager.updateSessionActivity(sessionContext);
    
    this.sessions.set(updatedContext.sessionId, updatedContext);
    
    return updatedContext;
  }

  /**
   * Set upload context for a session
   */
  async setSessionUploadContext(sessionId: string, uploadId: string): Promise<SessionContext> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedContext = await modeManager.setUploadContext(session, uploadId);
    return await this.updateSession(updatedContext);
  }

  /**
   * Remove session
   */
  async removeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Remove from memory
    this.sessions.delete(sessionId);

    // Remove from client tracking
    const clientSessionSet = this.clientSessions.get(session.clientId);
    if (clientSessionSet) {
      clientSessionSet.delete(sessionId);
      if (clientSessionSet.size === 0) {
        this.clientSessions.delete(session.clientId);
      }
    }

    // Persistence disabled

    console.log(`🗑️  Removed session ${sessionId}`);
    return true;
  }

  /**
   * Get all sessions for a client
   */
  async getClientSessions(clientId: string): Promise<SessionContext[]> {
    const sessionIds = this.clientSessions.get(clientId) || new Set();
    const sessions: SessionContext[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();
    
    const sessionsByMode = sessions.reduce((acc, session) => {
      acc[session.mode] = (acc[session.mode] || 0) + 1;
      return acc;
    }, {} as Record<WorkflowMode, number>);

    const sessionAges = sessions.map(s => now - s.createdAt.getTime());
    const averageSessionAge = sessionAges.length > 0 
      ? sessionAges.reduce((sum, age) => sum + age, 0) / sessionAges.length 
      : 0;

    const oldestSession = sessions.length > 0 
      ? sessions.reduce((oldest, current) => 
          current.createdAt < oldest.createdAt ? current : oldest
        ).createdAt
      : null;

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => modeManager.isSessionValid(s)).length,
      sessionsByMode,
      oldestSession,
      averageSessionAge
    };
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const expiredSessions: string[] = [];
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      const sessionAge = now - session.createdAt.getTime();
      const inactivityAge = now - session.lastActivity.getTime();
      
      if (sessionAge > this.config.sessionTimeout || 
          inactivityAge > this.config.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      await this.removeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      console.log(`🧹 Cleaned up ${expiredSessions.length} expired sessions`);
    }

    return expiredSessions.length;
  }

  /**
   * Validate session and get current mode restrictions
   */
  async validateSessionQuery(sessionId: string, query: string): Promise<{
    isValid: boolean;
    session: SessionContext | null;
    validation: any;
    errors: string[];
    warnings: string[];
  }> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return {
        isValid: false,
        session: null,
        validation: null,
        errors: ['Session not found or expired'],
        warnings: []
      };
    }

    const validation = await modeManager.validateQuery(query, session);
    
    return {
      isValid: validation.isValid,
      session,
      validation,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  /**
   * Apply session mode constraints to a query
   */
  async applySessionConstraints(sessionId: string, query: string): Promise<{
    session: SessionContext | null;
    modification: any;
    errors: string[];
  }> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return {
        session: null,
        modification: null,
        errors: ['Session not found or expired']
      };
    }

    const modification = await modeManager.applyModeConstraints(query, session);
    
    return {
      session,
      modification,
      errors: modification.errors
    };
  }

  /**
   * Get session recommendations
   */
  async getSessionRecommendations(sessionId: string): Promise<string[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return ['Session not found or expired'];
    }

    return modeManager.getModeRecommendations(session);
  }

  /**
   * Emergency cleanup - remove all sessions
   */
  async emergencyCleanup(): Promise<number> {
    const sessionCount = this.sessions.size;
    
    // Clear memory
    this.sessions.clear();
    this.clientSessions.clear();
    
    // Redis not available - sessions only in memory

    console.log(`🚨 Emergency cleanup: removed ${sessionCount} sessions`);
    return sessionCount;
  }

  // Private helper methods

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async removeOldestSessionForClient(clientId: string): Promise<void> {
    const sessions = await this.getClientSessions(clientId);
    if (sessions.length === 0) return;

    const oldestSession = sessions[sessions.length - 1]; // Already sorted by activity
    await this.removeSession(oldestSession.sessionId);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        console.error('Error during session cleanup:', error);
      }
    }, this.config.cleanupInterval);
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // Persistence methods removed - Redis not available

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.stopCleanupTimer();
    console.log('📴 Session manager shutdown complete');
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();