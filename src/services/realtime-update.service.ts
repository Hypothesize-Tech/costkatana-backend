import { logger } from '../utils/logger';

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
            logger.info(`SSE connection closed for user: ${userId}`);
        });

        logger.info(`SSE connection established for user: ${userId}`);
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
     * Emit budget warning
     */
    static emitBudgetWarning(userId: string, data: any): void {
        this.broadcastToUser(userId, {
            type: 'budget_warning',
            ...data,
            timestamp: new Date().toISOString()
        });
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
    private static broadcastToUser(userId: string, message: any): void {
        const userConnections = Array.from(this.activeConnections.entries())
            .filter(([_, conn]) => conn.userId === userId);

        userConnections.forEach(([connectionId, connection]) => {
            try {
                connection.res.write(`data: ${JSON.stringify(message)}\n\n`);
                connection.lastActivity = new Date();
            } catch (error) {
                logger.error(`Failed to send SSE message to ${connectionId}:`, error);
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
                    logger.error(`Error closing inactive connection ${connectionId}:`, error);
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