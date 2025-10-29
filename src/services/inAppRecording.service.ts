import { v4 as uuidv4 } from 'uuid';
import { Session,  APP_FEATURES } from '../models/Session';
import { loggingService } from './logging.service';
import os from 'os';

interface AIInteraction {
    model: string;
    prompt: string;
    response: string;
    parameters?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        [key: string]: any;
    };
    tokens?: {
        input: number;
        output: number;
    };
    cost?: number;
    latency?: number;
    // Enhanced metadata for full context capture
    provider?: string;
    requestMetadata?: Record<string, any>;
    responseMetadata?: Record<string, any>;
}

interface UserAction {
    action: string;
    details?: any;
}

interface CodeContext {
    filePath: string;
    content: string;
    language?: string;
}

class InAppRecordingService {
    /**
     * Get feature display name with emoji
     */
    private getFeatureLabel(feature: string, customLabel?: string): string {
        if (customLabel) return customLabel;
        
        const featureLabels: Record<string, string> = {
            [APP_FEATURES.CHAT]: 'Chat Conversation',
            [APP_FEATURES.EXPERIMENTATION]: 'Experimentation',
            [APP_FEATURES.MODEL_COMPARISON]: 'Model Comparison',
            [APP_FEATURES.WHAT_IF_SIMULATOR]: 'What-If Simulator',
            [APP_FEATURES.PROMPT_OPTIMIZER]: 'Prompt Optimizer',
            [APP_FEATURES.COST_ANALYZER]: 'Cost Analyzer'
        };
        
        return featureLabels[feature] || `🎯 ${feature}`;
    }

    /**
     * Start a new recording session
     */
    async startRecording(userId: string, feature: string, metadata?: Record<string, any>): Promise<string> {
        try {
            const sessionId = `inapp_${feature}_${Date.now()}_${uuidv4().substring(0, 8)}`;
            const label = this.getFeatureLabel(feature, metadata?.label);
            
            loggingService.info('Starting in-app recording session', {
                component: 'InAppRecordingService',
                operation: 'startRecording',
                sessionId,
                userId,
                feature,
                label
            });

            await Session.create({
                sessionId,
                userId,
                label,
                startedAt: new Date(),
                status: 'active',
                source: 'in-app',
                appFeature: feature,
                trackingEnabled: true,
                sessionReplayEnabled: true,
                metadata: {
                    ...metadata,
                    startedBy: 'in-app-recording',
                    feature,
                    featureLabel: label
                },
                summary: {
                    totalSpans: 0,
                    totalTokens: { input: 0, output: 0 },
                    totalCost: 0
                },
                replayData: {
                    aiInteractions: [],
                    userActions: [],
                    codeContext: [],
                    systemMetrics: []
                }
            });

            loggingService.info('In-app recording session started successfully', {
                component: 'InAppRecordingService',
                operation: 'startRecording',
                sessionId,
                userId,
                feature
            });

            return sessionId;
        } catch (error) {
            loggingService.error('Failed to start in-app recording session', {
                component: 'InAppRecordingService',
                operation: 'startRecording',
                userId,
                feature,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Record an AI interaction
     */
    async recordInteraction(sessionId: string, interaction: AIInteraction): Promise<void> {
        try {
            const now = new Date();
            
            await Session.updateOne(
                { sessionId },
                {
                    $push: {
                        'replayData.aiInteractions': {
                            timestamp: now,
                            model: interaction.model,
                            prompt: interaction.prompt,
                            response: interaction.response,
                            parameters: interaction.parameters || {},
                            tokens: interaction.tokens || { input: 0, output: 0 },
                            cost: interaction.cost || 0,
                            latency: interaction.latency,
                            // Capture full context
                            provider: interaction.provider || 'aws-bedrock',
                            requestMetadata: interaction.requestMetadata || {},
                            responseMetadata: interaction.responseMetadata || {}
                        }
                    },
                    $inc: {
                        'summary.totalSpans': 1,
                        'summary.totalCost': interaction.cost || 0,
                        'summary.totalTokens.input': interaction.tokens?.input || 0,
                        'summary.totalTokens.output': interaction.tokens?.output || 0
                    },
                    $set: { updatedAt: now }
                }
            );

            loggingService.info('AI interaction recorded', {
                component: 'InAppRecordingService',
                operation: 'recordInteraction',
                sessionId,
                model: interaction.model,
                tokens: interaction.tokens,
                cost: interaction.cost,
                provider: interaction.provider
            });
        } catch (error) {
            loggingService.error('Failed to record AI interaction', {
                component: 'InAppRecordingService',
                operation: 'recordInteraction',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Record a user action
     */
    async recordUserAction(sessionId: string, action: UserAction): Promise<void> {
        try {
            const now = new Date();
            
            await Session.updateOne(
                { sessionId },
                {
                    $push: {
                        'replayData.userActions': {
                            timestamp: now,
                            action: action.action,
                            details: action.details
                        }
                    },
                    $set: { updatedAt: now }
                }
            );

            loggingService.info('User action recorded', {
                component: 'InAppRecordingService',
                operation: 'recordUserAction',
                sessionId,
                action: action.action
            });
        } catch (error) {
            loggingService.error('Failed to record user action', {
                component: 'InAppRecordingService',
                operation: 'recordUserAction',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Record code context
     */
    async recordCodeContext(sessionId: string, context: CodeContext): Promise<void> {
        try {
            const now = new Date();
            
            await Session.updateOne(
                { sessionId },
                {
                    $push: {
                        'replayData.codeContext': {
                            timestamp: now,
                            filePath: context.filePath,
                            content: context.content,
                            language: context.language
                        }
                    },
                    $set: { updatedAt: now }
                }
            );

            loggingService.info('Code context recorded', {
                component: 'InAppRecordingService',
                operation: 'recordCodeContext',
                sessionId,
                filePath: context.filePath,
                language: context.language
            });
        } catch (error) {
            loggingService.error('Failed to record code context', {
                component: 'InAppRecordingService',
                operation: 'recordCodeContext',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Capture system metrics
     */
    async captureSystemMetrics(sessionId: string): Promise<void> {
        try {
            const now = new Date();
            const cpus = os.cpus();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            // Calculate CPU usage (simplified)
            const cpuUsage = cpus.reduce((acc, cpu) => {
                const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
                const idle = cpu.times.idle;
                return acc + ((total - idle) / total) * 100;
            }, 0) / cpus.length;

            await Session.updateOne(
                { sessionId },
                {
                    $push: {
                        'replayData.systemMetrics': {
                            timestamp: now,
                            cpuUsage: Math.round(cpuUsage * 10) / 10,
                            memoryUsage: Math.round((usedMem / 1024 / 1024) * 10) / 10, // MB
                            activeWindows: [] // Placeholder - would need client-side data
                        }
                    },
                    $set: { updatedAt: now }
                }
            );

            loggingService.info('System metrics captured', {
                component: 'InAppRecordingService',
                operation: 'captureSystemMetrics',
                sessionId,
                cpuUsage: Math.round(cpuUsage * 10) / 10,
                memoryUsage: Math.round((usedMem / 1024 / 1024) * 10) / 10
            });
        } catch (error) {
            loggingService.error('Failed to capture system metrics', {
                component: 'InAppRecordingService',
                operation: 'captureSystemMetrics',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - metrics capture is non-critical
        }
    }

    /**
     * End a recording session
     */
    async endRecording(sessionId: string): Promise<void> {
        try {
            const now = new Date();
            const session = await Session.findOne({ sessionId });

            if (!session) {
                loggingService.warn('Cannot end recording - session not found', {
                    component: 'InAppRecordingService',
                    operation: 'endRecording',
                    sessionId
                });
                return;
            }

            // Calculate duration
            const duration = now.getTime() - session.startedAt.getTime();

            await Session.updateOne(
                { sessionId },
                {
                    $set: {
                        status: 'completed',
                        endedAt: now,
                        duration,
                        updatedAt: now
                    }
                }
            );

            loggingService.info('In-app recording session ended', {
                component: 'InAppRecordingService',
                operation: 'endRecording',
                sessionId,
                duration,
                totalInteractions: session.replayData?.aiInteractions?.length || 0,
                totalCost: session.summary?.totalCost || 0
            });
        } catch (error) {
            loggingService.error('Failed to end recording session', {
                component: 'InAppRecordingService',
                operation: 'endRecording',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Check if recording is enabled for a user
     */
    async isRecordingEnabled(userId: string): Promise<boolean> {
        try {
            // For now, we'll check user preferences or default to true
            // In production, this would check user's session replay preferences
            return true;
        } catch (error) {
            loggingService.error('Failed to check recording status', {
                component: 'InAppRecordingService',
                operation: 'isRecordingEnabled',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Get active recording session for a user and feature
     */
    async getActiveSession(userId: string, feature: string): Promise<string | null> {
        try {
            const session = await Session.findOne({
                userId,
                appFeature: feature,
                status: 'active',
                source: 'in-app'
            }).sort({ startedAt: -1 }).limit(1);

            return session?.sessionId || null;
        } catch (error) {
            loggingService.error('Failed to get active session', {
                component: 'InAppRecordingService',
                operation: 'getActiveSession',
                userId,
                feature,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Record a complete interaction with automatic metric capture
     */
    async recordCompleteInteraction(
        sessionId: string,
        interaction: AIInteraction,
        action?: UserAction,
        context?: CodeContext
    ): Promise<void> {
        try {
            // Record all components in parallel
            const promises: Promise<any>[] = [
                this.recordInteraction(sessionId, interaction)
            ];

            if (action) {
                promises.push(this.recordUserAction(sessionId, action));
            }

            if (context) {
                promises.push(this.recordCodeContext(sessionId, context));
            }

            // Always capture system metrics
            promises.push(this.captureSystemMetrics(sessionId));

            await Promise.all(promises);

            loggingService.info('Complete interaction recorded', {
                component: 'InAppRecordingService',
                operation: 'recordCompleteInteraction',
                sessionId,
                hasAction: !!action,
                hasContext: !!context
            });
        } catch (error) {
            loggingService.error('Failed to record complete interaction', {
                component: 'InAppRecordingService',
                operation: 'recordCompleteInteraction',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

export const inAppRecordingService = new InAppRecordingService();


