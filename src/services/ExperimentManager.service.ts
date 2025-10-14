import { BaseService, ServiceError } from '../shared/BaseService';
import { loggingService } from './logging.service';
import { Experiment } from '../models/Experiment';
import { EventEmitter } from 'events';
import mongoose from 'mongoose';

export interface ExperimentResult {
    id: string;
    name: string;
    type: 'model_comparison' | 'what_if' | 'fine_tuning';
    status: 'running' | 'completed' | 'failed';
    startTime: string;
    endTime?: string;
    results: any;
    metadata: {
        duration: number;
        iterations: number;
        confidence: number;
    };
    userId: string;
    createdAt: Date;
}

export interface ExperimentSession {
    sessionId: string;
    userId: string;
    createdAt: Date;
    status: 'active' | 'completed' | 'cancelled';
    experimentType: string;
}

/**
 * ExperimentManager handles experiment lifecycle management
 * Responsible for creating, tracking, and managing experiment sessions
 */
export class ExperimentManagerService extends BaseService {
    private static instance: ExperimentManagerService;
    private static progressEmitter = new EventEmitter();
    private static activeSessions = new Map<string, ExperimentSession>();

    // Session management configuration
    private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private readonly MAX_CONCURRENT_SESSIONS = 100;

    private constructor() {
        super('ExperimentManager', {
            max: 1000, // Cache up to 1000 experiment results
            ttl: 60 * 60 * 1000 // 1 hour TTL
        });

        // Cleanup expired sessions every 5 minutes
        setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
    }

    public static getInstance(): ExperimentManagerService {
        if (!ExperimentManagerService.instance) {
            ExperimentManagerService.instance = new ExperimentManagerService();
        }
        return ExperimentManagerService.instance;
    }

    /**
     * Create a new experiment session
     */
    public async createExperimentSession(
        userId: string,
        experimentType: string,
        metadata?: any
    ): Promise<string> {
        return this.executeWithCircuitBreaker(async () => {
            // Check session limits
            const userSessions = Array.from(ExperimentManagerService.activeSessions.values())
                .filter(session => session.userId === userId && session.status === 'active');

            if (userSessions.length >= 5) { // Max 5 concurrent sessions per user
                throw new ServiceError(
                    'Maximum concurrent experiments reached for user',
                    'MAX_EXPERIMENTS_EXCEEDED',
                    429
                );
            }

            if (ExperimentManagerService.activeSessions.size >= this.MAX_CONCURRENT_SESSIONS) {
                throw new ServiceError(
                    'System at maximum experiment capacity',
                    'SYSTEM_CAPACITY_EXCEEDED',
                    503
                );
            }

            const sessionId = new mongoose.Types.ObjectId().toString();
            const session: ExperimentSession = {
                sessionId,
                userId,
                createdAt: new Date(),
                status: 'active',
                experimentType
            };

            ExperimentManagerService.activeSessions.set(sessionId, session);

            loggingService.info('Experiment session created', {
                component: 'ExperimentManager',
                operation: 'createExperimentSession',
                sessionId,
                userId,
                experimentType,
                activeSessions: ExperimentManagerService.activeSessions.size
            });

            return sessionId;
        }, 'createExperimentSession');
    }

    /**
     * Get experiment session details
     */
    public getExperimentSession(sessionId: string): ExperimentSession | null {
        return ExperimentManagerService.activeSessions.get(sessionId) || null;
    }

    /**
     * Update experiment session status
     */
    public updateExperimentStatus(
        sessionId: string,
        status: 'active' | 'completed' | 'cancelled',
        results?: any
    ): void {
        const session = ExperimentManagerService.activeSessions.get(sessionId);
        if (session) {
            session.status = status;
            
            if (status === 'completed' || status === 'cancelled') {
                // Move to completed sessions or remove after delay
                setTimeout(() => {
                    ExperimentManagerService.activeSessions.delete(sessionId);
                }, 5 * 60 * 1000); // Keep for 5 minutes after completion
            }

            loggingService.info('Experiment session status updated', {
                component: 'ExperimentManager',
                operation: 'updateExperimentStatus',
                sessionId,
                status,
                hasResults: !!results
            });
        }
    }

    /**
     * Register session for progress tracking
     */
    public registerSession(sessionId: string, userId: string): void {
        const session = ExperimentManagerService.activeSessions.get(sessionId);
        if (session && session.userId === userId) {
            // Session already registered and valid
            return;
        }

        throw new ServiceError(
            'Invalid or expired experiment session',
            'INVALID_SESSION',
            404
        );
    }

    /**
     * Emit progress update for experiment
     */
    public emitProgress(
        sessionId: string,
        progress: number,
        message: string,
        data?: any
    ): void {
        const session = ExperimentManagerService.activeSessions.get(sessionId);
        if (!session) {
            loggingService.warn('Attempted to emit progress for non-existent session', {
                component: 'ExperimentManager',
                operation: 'emitProgress',
                sessionId
            });
            return;
        }

        const progressData = {
            sessionId,
            progress: Math.min(Math.max(progress, 0), 100), // Clamp between 0-100
            message,
            timestamp: new Date().toISOString(),
            data
        };

        ExperimentManagerService.progressEmitter.emit('progress', progressData);

        loggingService.debug('Progress emitted for experiment session', {
            component: 'ExperimentManager',
            operation: 'emitProgress',
            sessionId,
            progress: progressData.progress,
            message
        });
    }

    /**
     * Subscribe to progress updates
     */
    public onProgress(callback: (data: any) => void): void {
        ExperimentManagerService.progressEmitter.on('progress', callback);
    }

    /**
     * Unsubscribe from progress updates
     */
    public offProgress(callback: (data: any) => void): void {
        ExperimentManagerService.progressEmitter.off('progress', callback);
    }

    /**
     * Get active experiments for a user
     */
    public getUserActiveExperiments(userId: string): ExperimentSession[] {
        return Array.from(ExperimentManagerService.activeSessions.values())
            .filter(session => session.userId === userId && session.status === 'active');
    }

    /**
     * Get system experiment statistics
     */
    public getSystemStats(): {
        totalActiveSessions: number;
        sessionsByType: Record<string, number>;
        sessionsByStatus: Record<string, number>;
        oldestSession: Date | null;
    } {
        const sessions = Array.from(ExperimentManagerService.activeSessions.values());
        
        const sessionsByType: Record<string, number> = {};
        const sessionsByStatus: Record<string, number> = {};
        let oldestSession: Date | null = null;

        sessions.forEach(session => {
            // Count by type
            sessionsByType[session.experimentType] = (sessionsByType[session.experimentType] || 0) + 1;
            
            // Count by status
            sessionsByStatus[session.status] = (sessionsByStatus[session.status] || 0) + 1;
            
            // Track oldest session
            if (!oldestSession || session.createdAt < oldestSession) {
                oldestSession = session.createdAt;
            }
        });

        return {
            totalActiveSessions: sessions.length,
            sessionsByType,
            sessionsByStatus,
            oldestSession
        };
    }

    /**
     * Clean up expired sessions
     */
    private cleanupExpiredSessions(): void {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of ExperimentManagerService.activeSessions.entries()) {
            const sessionAge = now - session.createdAt.getTime();
            
            if (sessionAge > this.SESSION_TIMEOUT) {
                ExperimentManagerService.activeSessions.delete(sessionId);
                cleanedCount++;
                
                loggingService.info('Expired experiment session cleaned up', {
                    component: 'ExperimentManager',
                    operation: 'cleanupExpiredSessions',
                    sessionId,
                    sessionAge,
                    userId: session.userId
                });
            }
        }

        if (cleanedCount > 0) {
            loggingService.info('Experiment session cleanup completed', {
                component: 'ExperimentManager',
                operation: 'cleanupExpiredSessions',
                cleanedCount,
                remainingSessions: ExperimentManagerService.activeSessions.size
            });
        }
    }

    /**
     * Force cleanup all sessions (for shutdown)
     */
    public async cleanup(): Promise<void> {
        ExperimentManagerService.activeSessions.clear();
        ExperimentManagerService.progressEmitter.removeAllListeners();
        
        loggingService.info('ExperimentManager cleanup completed', {
            component: 'ExperimentManager',
            operation: 'cleanup'
        });
    }
}
