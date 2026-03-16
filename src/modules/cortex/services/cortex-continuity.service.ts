/**
 * Cortex Continuity Service
 *
 * Manages continuity across streaming sessions and maintains context
 * between different phases of Cortex processing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ContinuitySession {
  id: string;
  userId: string;
  prompt: string;
  context: Map<string, any>;
  phases: ContinuityPhase[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface ContinuityPhase {
  id: string;
  type: 'encoding' | 'processing' | 'decoding';
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  data: Map<string, any>;
  errors: string[];
}

@Injectable()
export class CortexContinuityService {
  private readonly logger = new Logger(CortexContinuityService.name);
  private sessions = new Map<string, ContinuitySession>();

  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Create a new continuity session
   */
  createSession(
    sessionId: string,
    userId: string,
    prompt: string,
  ): ContinuitySession {
    const session: ContinuitySession = {
      id: sessionId,
      userId,
      prompt,
      context: new Map(),
      phases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    };

    this.sessions.set(sessionId, session);

    this.logger.log('Created continuity session', {
      sessionId,
      userId,
      promptLength: prompt.length,
    });

    return session;
  }

  /**
   * Get continuity session
   */
  getSession(sessionId: string): ContinuitySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session context
   */
  updateContext(sessionId: string, key: string, value: any): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.context.set(key, value);
      session.updatedAt = new Date();

      this.logger.debug('Updated session context', {
        sessionId,
        key,
        hasValue: value !== undefined,
      });
    }
  }

  /**
   * Get session context
   */
  getContext(sessionId: string, key: string): any {
    const session = this.sessions.get(sessionId);
    return session?.context.get(key);
  }

  /**
   * Start a phase in the session
   */
  startPhase(
    sessionId: string,
    phaseType: ContinuityPhase['type'],
  ): ContinuityPhase {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const phase: ContinuityPhase = {
      id: `${phaseType}_${Date.now()}`,
      type: phaseType,
      startTime: new Date(),
      status: 'running',
      data: new Map(),
      errors: [],
    };

    session.phases.push(phase);
    session.updatedAt = new Date();

    this.logger.log('Started continuity phase', {
      sessionId,
      phaseId: phase.id,
      phaseType,
    });

    return phase;
  }

  /**
   * Complete a phase
   */
  completePhase(sessionId: string, phaseId: string, data?: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const phase = session.phases.find((p) => p.id === phaseId);
    if (phase) {
      phase.endTime = new Date();
      phase.status = 'completed';
      if (data) {
        Object.entries(data).forEach(([key, value]) => {
          phase.data.set(key, value);
        });
      }

      session.updatedAt = new Date();

      this.logger.log('Completed continuity phase', {
        sessionId,
        phaseId,
        phaseType: phase.type,
        duration: phase.endTime.getTime() - phase.startTime.getTime(),
      });

      // Emit event
      this.eventEmitter.emit('cortex.continuity.phase.completed', {
        sessionId,
        phaseId,
        phaseType: phase.type,
        data,
      });
    }
  }

  /**
   * Fail a phase
   */
  failPhase(sessionId: string, phaseId: string, error: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const phase = session.phases.find((p) => p.id === phaseId);
    if (phase) {
      phase.endTime = new Date();
      phase.status = 'failed';
      phase.errors.push(error);

      session.updatedAt = new Date();

      this.logger.error('Failed continuity phase', {
        sessionId,
        phaseId,
        phaseType: phase.type,
        error,
      });

      // Emit event
      this.eventEmitter.emit('cortex.continuity.phase.failed', {
        sessionId,
        phaseId,
        phaseType: phase.type,
        error,
      });
    }
  }

  /**
   * Get all phases for a session
   */
  getPhases(sessionId: string): ContinuityPhase[] {
    const session = this.sessions.get(sessionId);
    return session?.phases || [];
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    return session.expiresAt > new Date();
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
        cleaned++;

        this.logger.log('Cleaned up expired continuity session', {
          sessionId,
          age: now.getTime() - session.createdAt.getTime(),
        });
      }
    }

    if (cleaned > 0) {
      this.logger.log('Cleaned up expired continuity sessions', {
        count: cleaned,
      });
    }
  }

  /**
   * Transfer context between phases
   */
  transferContext(
    fromSessionId: string,
    toSessionId: string,
    keys: string[],
  ): void {
    const fromSession = this.sessions.get(fromSessionId);
    const toSession = this.sessions.get(toSessionId);

    if (!fromSession || !toSession) {
      this.logger.warn('Cannot transfer context - session not found', {
        fromSessionId,
        toSessionId,
        fromExists: !!fromSession,
        toExists: !!toSession,
      });
      return;
    }

    for (const key of keys) {
      const value = fromSession.context.get(key);
      if (value !== undefined) {
        toSession.context.set(key, value);
        this.logger.debug('Transferred context between sessions', {
          fromSessionId,
          toSessionId,
          key,
          hasValue: true,
        });
      }
    }

    toSession.updatedAt = new Date();
  }
}
