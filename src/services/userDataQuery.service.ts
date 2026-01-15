import { Project } from '../models/Project';
import { Activity } from '../models/Activity';
import { Telemetry } from '../models/Telemetry';
import { Usage } from '../models/Usage';
import { Conversation } from '../models/Conversation';
import { loggingService } from './logging.service';

export interface UserDataQueryOptions {
    limit?: number;
    skip?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateRange?: {
        from: Date;
        to: Date;
    };
}

export interface QueryIntent {
    type: 'projects' | 'activity' | 'telemetry' | 'usage' | 'conversations' | 'spending' | 'errors' | 'performance';
    timeframe?: 'today' | 'week' | 'month' | 'year' | 'custom';
    aggregation?: 'sum' | 'avg' | 'count' | 'group';
    filters?: Record<string, any>;
}

export class UserDataQueryService {
    /**
     * Parse natural language query to determine intent
     */
    parseQueryIntent(query: string): QueryIntent {
        const lowerQuery = query.toLowerCase();
        
        // Determine query type
        let type: QueryIntent['type'] = 'usage';
        
        if (lowerQuery.includes('project')) {
            type = 'projects';
        } else if (lowerQuery.includes('activity') || lowerQuery.includes('recent') || lowerQuery.includes('history')) {
            type = 'activity';
        } else if (lowerQuery.includes('telemetry') || lowerQuery.includes('trace') || lowerQuery.includes('performance')) {
            type = 'telemetry';
        } else if (lowerQuery.includes('conversation') || lowerQuery.includes('chat')) {
            type = 'conversations';
        } else if (lowerQuery.includes('spending') || lowerQuery.includes('cost') || lowerQuery.includes('money')) {
            type = 'spending';
        } else if (lowerQuery.includes('error') || lowerQuery.includes('fail')) {
            type = 'errors';
        } else if (lowerQuery.includes('usage') || lowerQuery.includes('token')) {
            type = 'usage';
        }
        
        // Determine timeframe
        let timeframe: QueryIntent['timeframe'];
        
        if (lowerQuery.includes('today')) {
            timeframe = 'today';
        } else if (lowerQuery.includes('week') || lowerQuery.includes('last 7 days')) {
            timeframe = 'week';
        } else if (lowerQuery.includes('month') || lowerQuery.includes('last 30 days')) {
            timeframe = 'month';
        } else if (lowerQuery.includes('year')) {
            timeframe = 'year';
        }
        
        // Determine aggregation
        let aggregation: QueryIntent['aggregation'];
        
        if (lowerQuery.includes('total') || lowerQuery.includes('sum')) {
            aggregation = 'sum';
        } else if (lowerQuery.includes('average') || lowerQuery.includes('avg')) {
            aggregation = 'avg';
        } else if (lowerQuery.includes('count') || lowerQuery.includes('how many')) {
            aggregation = 'count';
        } else if (lowerQuery.includes('by model') || lowerQuery.includes('breakdown')) {
            aggregation = 'group';
        }
        
        return {
            type,
            timeframe,
            aggregation,
            filters: {}
        };
    }

    /**
     * Query user projects with strict isolation
     */
    async queryUserProjects(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const query: any = { userId };
            
            if (options.dateRange) {
                query.createdAt = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const projects = await Project.find(query)
                .sort({ [options.sortBy || 'createdAt']: options.sortOrder === 'asc' ? 1 : -1 })
                .limit(options.limit || 10)
                .skip(options.skip || 0);
            
            // Audit log
            loggingService.info('User projects query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserProjects',
                userId,
                resultCount: projects.length
            });
            
            return projects;
        } catch (error) {
            loggingService.error('User projects query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserProjects',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Query user activity with strict isolation
     */
    async queryUserActivity(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const query: any = { userId };
            
            if (options.dateRange) {
                query.createdAt = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const activities = await Activity.find(query)
                .sort({ createdAt: -1 })
                .limit(options.limit || 20)
                .skip(options.skip || 0);
            
            // Audit log
            loggingService.info('User activity query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserActivity',
                userId,
                resultCount: activities.length
            });
            
            return activities;
        } catch (error) {
            loggingService.error('User activity query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserActivity',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Query user telemetry with strict isolation
     */
    async queryUserTelemetry(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const query: any = { user_id: userId };
            
            if (options.dateRange) {
                query.timestamp = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const telemetry = await Telemetry.find(query)
                .sort({ timestamp: -1 })
                .limit(options.limit || 50)
                .skip(options.skip || 0);
            
            // Audit log
            loggingService.info('User telemetry query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserTelemetry',
                userId,
                resultCount: telemetry.length
            });
            
            return telemetry;
        } catch (error) {
            loggingService.error('User telemetry query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserTelemetry',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Query user usage/spending with strict isolation
     */
    async queryUserUsage(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const matchStage: any = { userId };
            
            if (options.dateRange) {
                matchStage.createdAt = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const usage = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        avgCostPerRequest: { $avg: '$cost' }
                    }
                }
            ]);
            
            // Also get breakdown by model
            const byModel = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        requests: { $sum: 1 }
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);
            
            // Audit log
            loggingService.info('User usage query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserUsage',
                userId
            });
            
            return {
                summary: usage[0] || {
                    totalCost: 0,
                    totalTokens: 0,
                    totalRequests: 0,
                    avgCostPerRequest: 0
                },
                byModel
            };
        } catch (error) {
            loggingService.error('User usage query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserUsage',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Query user conversations with strict isolation
     */
    async queryUserConversations(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const query: any = { userId };
            
            if (options.dateRange) {
                query.createdAt = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const conversations = await Conversation.find(query)
                .sort({ updatedAt: -1 })
                .limit(options.limit || 10)
                .skip(options.skip || 0);
            
            // Audit log
            loggingService.info('User conversations query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserConversations',
                userId,
                resultCount: conversations.length
            });
            
            return conversations;
        } catch (error) {
            loggingService.error('User conversations query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserConversations',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Query user errors with strict isolation
     */
    async queryUserErrors(userId: string, options: UserDataQueryOptions = {}): Promise<any> {
        try {
            // SECURITY: Always filter by userId
            const query: any = {
                user_id: userId,
                status: 'error'
            };
            
            if (options.dateRange) {
                query.timestamp = {
                    $gte: options.dateRange.from,
                    $lte: options.dateRange.to
                };
            }
            
            const errors = await Telemetry.find(query)
                .sort({ timestamp: -1 })
                .limit(options.limit || 20)
                .skip(options.skip || 0)
                .select('timestamp error_type error_message operation_name http_status_code');
            
            // Group by error type
            const errorsByType = await Telemetry.aggregate([
                { $match: { user_id: userId, status: 'error', ...( options.dateRange ? { timestamp: query.timestamp } : {}) } },
                {
                    $group: {
                        _id: '$error_type',
                        count: { $sum: 1 },
                        latestError: { $max: '$timestamp' }
                    }
                },
                { $sort: { count: -1 } }
            ]);
            
            // Audit log
            loggingService.info('User errors query executed', {
                component: 'UserDataQueryService',
                operation: 'queryUserErrors',
                userId,
                resultCount: errors.length
            });
            
            return {
                errors,
                byType: errorsByType
            };
        } catch (error) {
            loggingService.error('User errors query failed', {
                component: 'UserDataQueryService',
                operation: 'queryUserErrors',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Execute natural language query with security
     */
    async executeNaturalLanguageQuery(userId: string, query: string): Promise<any> {
        try {
            // Parse intent
            const intent = this.parseQueryIntent(query);
            
            // Calculate date range based on timeframe
            let dateRange: { from: Date; to: Date } | undefined;
            
            if (intent.timeframe) {
                const now = new Date();
                let from: Date;
                
                switch (intent.timeframe) {
                    case 'today':
                        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        break;
                    case 'week':
                        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                        break;
                    case 'month':
                        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                        break;
                    case 'year':
                        from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                        break;
                    default:
                        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                }
                
                dateRange = { from, to: now };
            }
            
            // Execute appropriate query based on intent
            let result: any;
            
            switch (intent.type) {
                case 'projects':
                    result = await this.queryUserProjects(userId, { dateRange });
                    break;
                case 'activity':
                    result = await this.queryUserActivity(userId, { dateRange });
                    break;
                case 'telemetry':
                case 'performance':
                    result = await this.queryUserTelemetry(userId, { dateRange });
                    break;
                case 'usage':
                case 'spending':
                    result = await this.queryUserUsage(userId, { dateRange });
                    break;
                case 'conversations':
                    result = await this.queryUserConversations(userId, { dateRange });
                    break;
                case 'errors':
                    result = await this.queryUserErrors(userId, { dateRange });
                    break;
                default:
                    result = await this.queryUserUsage(userId, { dateRange });
            }
            
            // Audit log - CRITICAL for security compliance
            loggingService.info('Natural language query executed', {
                component: 'UserDataQueryService',
                operation: 'executeNaturalLanguageQuery',
                userId,
                query: query.substring(0, 100),
                intent: intent.type,
                timeframe: intent.timeframe
            });
            
            return {
                intent,
                data: result,
                query: query.substring(0, 100)
            };
        } catch (error) {
            loggingService.error('Natural language query failed', {
                component: 'UserDataQueryService',
                operation: 'executeNaturalLanguageQuery',
                userId,
                query: query.substring(0, 100),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Validate user ownership before returning data
     * This is a security utility method
     */
    validateUserOwnership(userId: string, data: any): boolean {
        if (!data) return false;
        
        // Check if data belongs to user
        if (Array.isArray(data)) {
            return data.every(item => 
                item.userId === userId || 
                item.user_id === userId
            );
        }
        
        return data.userId === userId || data.user_id === userId;
    }
}

// Singleton instance
export const userDataQueryService = new UserDataQueryService();

