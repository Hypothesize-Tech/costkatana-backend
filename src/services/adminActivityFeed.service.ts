import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface ActivityEvent {
    id: string;
    type: 'request' | 'error' | 'high_cost' | 'budget_warning' | 'anomaly' | 'user_action';
    userId?: string;
    userEmail?: string;
    userName?: string;
    projectId?: string;
    projectName?: string;
    service?: string;
    model?: string;
    cost?: number;
    tokens?: number;
    errorType?: string;
    message: string;
    timestamp: Date;
    severity?: 'low' | 'medium' | 'high' | 'critical';
}

export class AdminActivityFeedService {
    private static adminConnections = new Map<string, { adminId: string, res: any, lastActivity: Date, filters?: ActivityFilters }>();
    private static recentEvents: ActivityEvent[] = [];
    private static readonly MAX_RECENT_EVENTS = 1000;

    /**
     * Initialize SSE connection for admin activity feed
     */
    static initializeAdminFeed(adminId: string, res: any, filters?: ActivityFilters): string {
        const connectionId = `admin_${adminId}_${Date.now()}`;
        
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        });

        // Store connection FIRST before sending any data
        this.adminConnections.set(connectionId, {
            adminId,
            res,
            lastActivity: new Date(),
            filters
        });

        // Send initial connection message
        try {
            const connectMessage = `data: ${JSON.stringify({
                type: 'connected',
                message: 'Admin activity feed connected',
                timestamp: new Date().toISOString()
            })}\n\n`;
            res.write(connectMessage);
            // Flush immediately
            if (res.flush && typeof res.flush === 'function') {
                res.flush();
            }
        } catch (error) {
            loggingService.error(`Failed to send initial connection message to ${connectionId}:`, {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Send recent events (connection is now stored)
        this.sendRecentEvents(connectionId, filters);

        // Set up heartbeat - send every 15 seconds to keep connection alive
        const heartbeat = setInterval(() => {
            if (this.adminConnections.has(connectionId)) {
                try {
                    const heartbeatMessage = `data: ${JSON.stringify({
                        type: 'heartbeat',
                        timestamp: new Date().toISOString()
                    })}\n\n`;
                    res.write(heartbeatMessage);
                    // Flush heartbeat
                    if (res.flush && typeof res.flush === 'function') {
                        res.flush();
                    }
                } catch (error) {
                    clearInterval(heartbeat);
                    this.adminConnections.delete(connectionId);
                    loggingService.warn(`Heartbeat failed for ${connectionId}, connection removed`);
                }
            } else {
                clearInterval(heartbeat);
            }
        }, 15000); // Reduced to 15 seconds

        // Handle connection close
        res.on('close', () => {
            this.adminConnections.delete(connectionId);
            clearInterval(heartbeat);
            loggingService.info(`Admin activity feed connection closed: ${connectionId}`);
        });

        loggingService.info(`Admin activity feed connection established: ${connectionId}`);
        return connectionId;
    }

    /**
     * Send recent events to a new connection
     */
    private static sendRecentEvents(connectionId: string, filters?: ActivityFilters): void {
        const connection = this.adminConnections.get(connectionId);
        if (!connection) return;

        let events = [...this.recentEvents].reverse().slice(0, 50); // Last 50 events

        if (filters) {
            events = this.filterEvents(events, filters);
        }

        try {
            const message = `data: ${JSON.stringify({
                type: 'recent_events',
                events,
                timestamp: new Date().toISOString()
            })}\n\n`;
            
            connection.res.write(message);
            // Flush the data immediately
            if (connection.res.flush && typeof connection.res.flush === 'function') {
                connection.res.flush();
            }
            
            loggingService.info(`Sent ${events.length} recent events to ${connectionId}`);
        } catch (error) {
            loggingService.error(`Failed to send recent events to ${connectionId}:`, {
                error: error instanceof Error ? error.message : String(error)
            });
            // Remove broken connection
            this.adminConnections.delete(connectionId);
        }
    }

    /**
     * Record a new activity event
     */
    static async recordEvent(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
        try {
            const fullEvent: ActivityEvent = {
                ...event,
                id: `${event.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date()
            };

            // Add to recent events (keep only last MAX_RECENT_EVENTS)
            this.recentEvents.push(fullEvent);
            if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
                this.recentEvents.shift();
            }

            // Broadcast to all admin connections
            this.broadcastToAdmins(fullEvent);
        } catch (error) {
            loggingService.error('Error recording activity event:', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Broadcast event to all admin connections that match filters
     */
    private static broadcastToAdmins(event: ActivityEvent): void {
        for (const [connectionId, connection] of this.adminConnections.entries()) {
            // Apply filters if set
            if (connection.filters && !this.eventMatchesFilters(event, connection.filters)) {
                continue;
            }

            try {
                // Create a wrapper object for SSE transport
                const sseEvent = {
                    type: 'activity_event',
                    data: event
                };
                const message = `data: ${JSON.stringify(sseEvent)}\n\n`;
                connection.res.write(message);
                // Flush immediately
                if (connection.res.flush && typeof connection.res.flush === 'function') {
                    connection.res.flush();
                }
                connection.lastActivity = new Date();
            } catch (error) {
                loggingService.warn(`Failed to broadcast to ${connectionId}, removing connection`);
                this.adminConnections.delete(connectionId);
            }
        }
    }

    /**
     * Check if event matches filters
     */
    private static eventMatchesFilters(event: ActivityEvent, filters: ActivityFilters): boolean {
        if (filters.userId && event.userId !== filters.userId) return false;
        if (filters.service && event.service !== filters.service) return false;
        if (filters.model && event.model !== filters.model) return false;
        if (filters.errorType && event.errorType !== filters.errorType) return false;
        if (filters.types && !filters.types.includes(event.type)) return false;
        if (filters.severities && event.severity && !filters.severities.includes(event.severity)) return false;
        return true;
    }

    /**
     * Filter events by criteria
     */
    private static filterEvents(events: ActivityEvent[], filters: ActivityFilters): ActivityEvent[] {
        return events.filter(event => this.eventMatchesFilters(event, filters));
    }

    /**
     * Get recent activity events
     */
    static async getRecentEvents(
        limit: number = 50,
        filters?: ActivityFilters
    ): Promise<ActivityEvent[]> {
        try {
            const matchStage: any = {};

            if (filters?.userId) {
                matchStage.userId = filters.userId;
            }
            if (filters?.service) {
                matchStage.service = filters.service;
            }
            if (filters?.model) {
                matchStage.model = filters.model;
            }

            // Get recent usage records
            const recentUsage = await Usage.find(matchStage)
                .sort({ createdAt: -1 })
                .limit(limit)
                .populate('userId', 'email name')
                .populate('projectId', 'name')
                .lean();

            const events: ActivityEvent[] = [];

            for (const usage of recentUsage) {
                const userId = typeof usage.userId === 'string' || usage.userId === null ? usage.userId : usage.userId?.toString();
                const user = usage.userId && typeof usage.userId === 'object' && 'email' in usage.userId ? usage.userId as { email?: string; name?: string } : null;
                const project = usage.projectId && typeof usage.projectId === 'object' && 'name' in usage.projectId ? usage.projectId as { _id?: any; name?: string } : null;

                // Create request event
                if (usage.cost && usage.cost > 0.1) { // Only record significant costs
                    events.push({
                        id: `usage_${usage._id}`,
                        type: 'high_cost',
                        userId: userId || undefined,
                        userEmail: user?.email,
                        userName: user?.name,
                        projectId: project?._id?.toString(),
                        projectName: project?.name,
                        service: usage.service,
                        model: usage.model,
                        cost: usage.cost,
                        tokens: usage.totalTokens,
                        message: `High cost request: $${usage.cost.toFixed(4)} for ${usage.service}/${usage.model}`,
                        timestamp: usage.createdAt,
                        severity: usage.cost > 1 ? 'high' : usage.cost > 0.5 ? 'medium' : 'low'
                    });
                }

                // Create error event
                if (usage.errorOccurred) {
                    events.push({
                        id: `error_${usage._id}`,
                        type: 'error',
                        userId: userId || undefined,
                        userEmail: user?.email,
                        userName: user?.name,
                        projectId: project?._id?.toString(),
                        projectName: project?.name,
                        service: usage.service,
                        model: usage.model,
                        errorType: usage.errorType,
                        message: `Error in ${usage.service}/${usage.model}: ${usage.errorType || 'Unknown error'}`,
                        timestamp: usage.createdAt,
                        severity: usage.errorType === 'rate_limit' ? 'high' : 'medium'
                    });
                }
            }

            // Apply filters
            let filteredEvents = events;
            if (filters) {
                filteredEvents = this.filterEvents(events, filters);
            }

            return filteredEvents
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .slice(0, limit);
        } catch (error) {
            loggingService.error('Error getting recent events:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Clean up inactive connections
     */
    static cleanupInactiveConnections(): void {
        const now = new Date();
        const maxInactiveTime = 5 * 60 * 1000; // 5 minutes

        for (const [connectionId, connection] of this.adminConnections.entries()) {
            if (now.getTime() - connection.lastActivity.getTime() > maxInactiveTime) {
                try {
                    connection.res.end();
                } catch (error) {
                    loggingService.error(`Error closing inactive connection ${connectionId}:`, {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
                this.adminConnections.delete(connectionId);
            }
        }
    }

    /**
     * Get connection stats
     */
    static getConnectionStats() {
        const connections = Array.from(this.adminConnections.values());
        const adminCounts = connections.reduce((acc, conn) => {
            acc[conn.adminId] = (acc[conn.adminId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            totalConnections: connections.length,
            uniqueAdmins: Object.keys(adminCounts).length,
            adminCounts,
            recentEventsCount: this.recentEvents.length
        };
    }
}

export interface ActivityFilters {
    userId?: string;
    service?: string;
    model?: string;
    errorType?: string;
    types?: ActivityEvent['type'][];
    severities?: ActivityEvent['severity'][];
}

// Clean up inactive connections every 2 minutes
setInterval(() => {
    AdminActivityFeedService.cleanupInactiveConnections();
}, 2 * 60 * 1000);

