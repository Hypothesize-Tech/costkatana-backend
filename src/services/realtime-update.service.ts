import { loggingService } from './logging.service';

export class RealtimeUpdateService {
    private static activeConnections = new Map<string, { userId: string, res: any, lastActivity: Date }>();

    /**
     * Initialize SSE connection for a user
     */
    static initializeSSEConnection(userId: string, res: any): string {
        const connectionId = `${userId}_${Date.now()}`;
        
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({
            type: 'connected',
            message: 'Real-time updates connected',
            timestamp: new Date().toISOString()
        })}\n\n`);

        // Store connection
        this.activeConnections.set(connectionId, {
            userId,
            res,
            lastActivity: new Date()
        });

        // Set up heartbeat
        const heartbeat = setInterval(() => {
            if (this.activeConnections.has(connectionId)) {
                res.write(`data: ${JSON.stringify({
                    type: 'heartbeat',
                    timestamp: new Date().toISOString()
                })}\n\n`);
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);

        // Handle connection close
        res.on('close', () => {
            this.activeConnections.delete(connectionId);
            clearInterval(heartbeat);
            loggingService.info(`SSE connection closed for user: ${userId}`);
        });

        loggingService.info(`SSE connection established for user: ${userId}`);
        return connectionId;
    }

    /**
     * Emit usage update to all connected clients for a user
     */
    static emitUsageUpdate(userId: string, data: any): void {
        this.broadcastToUser(userId, {
            type: 'usage_update',
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit budget warning with severity levels
     */
    static emitBudgetWarning(userId: string, data: {
        severity: 'low' | 'medium' | 'high' | 'critical';
        message: string;
        budgetRemaining: number;
        estimatedCost?: number;
        usagePercentage?: number;
        threshold?: number;
        recommendedActions?: string[];
        cheaperAlternatives?: Array<{
            model: string;
            provider: string;
            estimatedCost: number;
            savings: number;
        }>;
        projectId?: string;
        workspaceId?: string;
    }): void {
        loggingService.info('🚨 Emitting budget warning via SSE', {
            userId,
            severity: data.severity,
            budgetRemaining: data.budgetRemaining,
            usagePercentage: data.usagePercentage
        });

        this.broadcastToUser(userId, {
            type: 'budget_warning',
            severity: data.severity,
            message: data.message,
            budgetRemaining: data.budgetRemaining,
            estimatedCost: data.estimatedCost,
            usagePercentage: data.usagePercentage,
            threshold: data.threshold,
            recommendedActions: data.recommendedActions || [],
            cheaperAlternatives: data.cheaperAlternatives || [],
            projectId: data.projectId,
            workspaceId: data.workspaceId,
            timestamp: new Date().toISOString(),
            // Action buttons for UI
            actions: this.generateAlertActions(data.severity, data.cheaperAlternatives)
        });
    }

    /**
     * Emits a proactive suggestion to a specific user via SSE.
     */
    static emitProactiveSuggestion(userId: string, suggestion: any): void {
        this.broadcastToUser(userId, {
            type: 'proactive_suggestion',
            ...suggestion,
            timestamp: new Date().toISOString()
        });

        loggingService.info('Proactive suggestion emitted via SSE', {
            userId,
            suggestionType: suggestion.type,
            suggestionId: suggestion.id
        });
    }

    /**
     * Emit budget exceeded critical alert
     */
    static emitBudgetExceeded(userId: string, data: {
        budgetId: string;
        estimatedCost: number;
        budgetRemaining: number;
        blocked: boolean;
        cheaperAlternatives?: Array<{
            model: string;
            provider: string;
            estimatedCost: number;
            savings: number;
        }>;
        message: string;
    }): void {
        loggingService.error('❌ Emitting budget exceeded alert via SSE', {
            userId,
            estimatedCost: data.estimatedCost,
            budgetRemaining: data.budgetRemaining,
            blocked: data.blocked
        });

        this.broadcastToUser(userId, {
            type: 'budget_exceeded',
            severity: 'critical',
            message: data.message,
            budgetId: data.budgetId,
            estimatedCost: data.estimatedCost,
            budgetRemaining: data.budgetRemaining,
            blocked: data.blocked,
            cheaperAlternatives: data.cheaperAlternatives || [],
            timestamp: new Date().toISOString(),
            // Immediate actions required
            requiresAction: true,
            actions: [
                { type: 'upgrade_plan', label: 'Upgrade Plan', primary: true },
                { type: 'use_cheaper_model', label: 'Use Cheaper Model', alternatives: data.cheaperAlternatives },
                { type: 'reduce_usage', label: 'Optimize Usage' }
            ]
        });
    }

    /**
     * Emit budget threshold alert (approaching limit)
     */
    static emitBudgetThreshold(userId: string, data: {
        threshold: number;
        usagePercentage: number;
        budgetRemaining: number;
        projectedExhaustion?: {
            daysRemaining: number;
            exhaustionDate: Date;
        };
        recommendations?: string[];
    }): void {
        loggingService.warn('⚠️ Emitting budget threshold alert via SSE', {
            userId,
            threshold: data.threshold,
            usagePercentage: data.usagePercentage,
            budgetRemaining: data.budgetRemaining
        });

        this.broadcastToUser(userId, {
            type: 'budget_threshold',
            severity: data.usagePercentage > 0.9 ? 'high' : 'medium',
            message: `Budget usage at ${(data.usagePercentage * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(0)}%)`,
            threshold: data.threshold,
            usagePercentage: data.usagePercentage,
            budgetRemaining: data.budgetRemaining,
            projectedExhaustion: data.projectedExhaustion,
            recommendations: data.recommendations || [],
            timestamp: new Date().toISOString(),
            actions: [
                { type: 'view_analytics', label: 'View Analytics' },
                { type: 'optimize_costs', label: 'Get Optimization Tips' },
                { type: 'increase_budget', label: 'Increase Budget' }
            ]
        });
    }

    /**
     * Generate contextual actions based on alert severity
     */
    private static generateAlertActions(
        severity: 'low' | 'medium' | 'high' | 'critical',
        cheaperAlternatives?: Array<{
            model: string;
            provider: string;
            estimatedCost: number;
            savings: number;
        }>
    ): Array<{ type: string; label: string; [key: string]: any }> {
        const baseActions = [];

        switch (severity) {
            case 'critical':
                baseActions.push(
                    { type: 'upgrade_plan', label: 'Upgrade Plan', primary: true },
                    { type: 'use_cheaper_model', label: 'Use Cheaper Model', alternatives: cheaperAlternatives },
                    { type: 'contact_support', label: 'Contact Support' }
                );
                break;
            case 'high':
                baseActions.push(
                    { type: 'optimize_now', label: 'Optimize Now', primary: true },
                    { type: 'view_recommendations', label: 'View Recommendations' },
                    { type: 'increase_budget', label: 'Increase Budget' }
                );
                break;
            case 'medium':
                baseActions.push(
                    { type: 'view_analytics', label: 'View Analytics' },
                    { type: 'get_optimization_tips', label: 'Get Tips' }
                );
                break;
            case 'low':
                baseActions.push(
                    { type: 'view_dashboard', label: 'View Dashboard' }
                );
                break;
        }

        return baseActions;
    }

    /**
     * Emit approval request notification
     */
    static emitApprovalRequest(userId: string, data: any): void {
        this.broadcastToUser(userId, {
            type: 'approval_request',
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Broadcast message to all connections for a specific user
     */
    static broadcastToUser(userId: string, message: any): void {
        const userConnections = Array.from(this.activeConnections.entries())
            .filter(([_, conn]) => conn.userId === userId);

        userConnections.forEach(([connectionId, connection]) => {
            try {
                connection.res.write(`data: ${JSON.stringify(message)}\n\n`);
                connection.lastActivity = new Date();
            } catch (error) {
                loggingService.error(`Failed to send SSE message to ${connectionId}:`, { error: error instanceof Error ? error.message : String(error) });
                this.activeConnections.delete(connectionId);
            }
        });
    }

    /**
     * Clean up inactive connections
     */
    static cleanupInactiveConnections(): void {
        const now = new Date();
        const maxInactiveTime = 5 * 60 * 1000; // 5 minutes

        for (const [connectionId, connection] of this.activeConnections.entries()) {
            if (now.getTime() - connection.lastActivity.getTime() > maxInactiveTime) {
                try {
                    connection.res.end();
                } catch (error) {
                    loggingService.error(`Error closing inactive connection ${connectionId}:`, { error: error instanceof Error ? error.message : String(error) });
                }
                this.activeConnections.delete(connectionId);
            }
        }
    }

    /**
     * Get connection stats
     */
    static getConnectionStats() {
        const connections = Array.from(this.activeConnections.values());
        const userCounts = connections.reduce((acc, conn) => {
            acc[conn.userId] = (acc[conn.userId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            totalConnections: connections.length,
            uniqueUsers: Object.keys(userCounts).length,
            userCounts
        };
    }
}

// Clean up inactive connections every 2 minutes
setInterval(() => {
    RealtimeUpdateService.cleanupInactiveConnections();
}, 2 * 60 * 1000); 