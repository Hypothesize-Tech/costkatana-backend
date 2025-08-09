import {  Response, NextFunction } from 'express';
import { workflowOrchestrator, WorkflowExecution } from '../services/workflowOrchestrator.service';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis.service';

export class WorkflowController {
    /**
     * Create a new workflow template
     */
    static async createTemplate(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const templateData = {
                ...req.body,
                createdBy: userId
            };

            const template = await workflowOrchestrator.createWorkflowTemplate(templateData);

            res.status(201).json({
                success: true,
                message: 'Workflow template created successfully',
                data: template
            });
        } catch (error: any) {
            logger.error('Create workflow template error:', error);
            next(error);
        }
    }

    /**
     * Execute a workflow
     */
    static async executeWorkflow(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const { templateId } = req.params;
            const { input, variables, environment, tags } = req.body;

            const execution = await workflowOrchestrator.executeWorkflow(
                templateId,
                userId,
                input,
                { variables, environment, tags }
            );

            res.status(201).json({
                success: true,
                message: 'Workflow execution started',
                data: execution
            });
        } catch (error: any) {
            logger.error('Execute workflow error:', error);
            next(error);
        }
    }

    /**
     * Get workflow execution status
     */
    static async getExecution(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { executionId } = req.params;

            const execution = await workflowOrchestrator.getWorkflowExecution(executionId);
            if (!execution) {
                res.status(404).json({
                    success: false,
                    message: 'Workflow execution not found'
                });
                return;
            }

            res.json({
                success: true,
                data: execution
            });
        } catch (error: any) {
            logger.error('Get workflow execution error:', error);
            next(error);
        }
    }

    /**
     * Get workflow template
     */
    static async getTemplate(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { templateId } = req.params;

            const template = await workflowOrchestrator.getWorkflowTemplate(templateId);
            if (!template) {
                res.status(404).json({
                    success: false,
                    message: 'Workflow template not found'
                });
                return;
            }

            res.json({
                success: true,
                data: template
            });
        } catch (error: any) {
            logger.error('Get workflow template error:', error);
            next(error);
        }
    }

    /**
     * Get workflow metrics and analytics
     */
    static async getWorkflowMetrics(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { workflowId } = req.params;
            const { timeRange } = req.query;

            const metrics = await workflowOrchestrator.getWorkflowMetrics(
                workflowId,
                timeRange as string
            );

            res.json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            logger.error('Get workflow metrics error:', error);
            next(error);
        }
    }

    /**
     * Pause workflow execution
     */
    static async pauseWorkflow(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { executionId } = req.params;

            await workflowOrchestrator.pauseWorkflow(executionId);

            res.json({
                success: true,
                message: 'Workflow paused successfully'
            });
        } catch (error: any) {
            logger.error('Pause workflow error:', error);
            next(error);
        }
    }

    /**
     * Resume workflow execution
     */
    static async resumeWorkflow(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { executionId } = req.params;

            await workflowOrchestrator.resumeWorkflow(executionId);

            res.json({
                success: true,
                message: 'Workflow resumed successfully'
            });
        } catch (error: any) {
            logger.error('Resume workflow error:', error);
            next(error);
        }
    }

    /**
     * Cancel workflow execution
     */
    static async cancelWorkflow(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { executionId } = req.params;

            await workflowOrchestrator.cancelWorkflow(executionId);

            res.json({
                success: true,
                message: 'Workflow cancelled successfully'
            });
        } catch (error: any) {
            logger.error('Cancel workflow error:', error);
            next(error);
        }
    }

    /**
     * Get workflow trace (detailed execution trace)
     */
    static async getWorkflowTrace(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { executionId } = req.params;

            const execution = await workflowOrchestrator.getWorkflowExecution(executionId);
            if (!execution) {
                res.status(404).json({
                    success: false,
                    message: 'Workflow execution not found'
                });
                return;
            }

            // Enhanced trace with detailed step information
            const trace = {
                execution: {
                    id: execution.id,
                    workflowId: execution.workflowId,
                    name: execution.name,
                    status: execution.status,
                    startTime: execution.startTime,
                    endTime: execution.endTime,
                    duration: execution.duration,
                    traceId: execution.traceId
                },
                steps: execution.steps.map(step => ({
                    id: step.id,
                    name: step.name,
                    type: step.type,
                    status: step.status,
                    startTime: step.startTime,
                    endTime: step.endTime,
                    duration: step.duration,
                    input: step.input,
                    output: step.output,
                    error: step.error,
                    metadata: step.metadata,
                    dependencies: step.dependencies
                })),
                metrics: execution.metadata,
                timeline: this.generateTimeline(execution),
                costBreakdown: this.generateCostBreakdown(execution),
                performanceInsights: this.generatePerformanceInsights(execution)
            };

            res.json({
                success: true,
                data: trace
            });
        } catch (error: any) {
            logger.error('Get workflow trace error:', error);
            next(error);
        }
    }

    /**
     * Get workflow observability dashboard data
     */
    static async getObservabilityDashboard(_req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = _req.user?.id || _req.userId;
            const timeRange = _req.query.timeRange as string || '24h';
            
            // Get real dashboard data from workflow orchestrator
            const dashboardData = await this.generateRealDashboardData(userId, timeRange);

            res.json({
                success: true,
                data: dashboardData
            });
        } catch (error: any) {
            logger.error('Get observability dashboard error:', error);
            next(error);
        }
    }

    /**
     * Helper methods for trace generation
     */
    private static generateTimeline(execution: WorkflowExecution) {
        return execution.steps.map(step => ({
            stepId: step.id,
            stepName: step.name,
            startTime: step.startTime,
            endTime: step.endTime,
            duration: step.duration,
            status: step.status
        })).sort((a, b) => 
            (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0)
        );
    }

    private static generateCostBreakdown(execution: WorkflowExecution) {
        const stepCosts = execution.steps
            .filter(step => step.metadata?.cost)
            .map(step => ({
                stepName: step.name,
                cost: step.metadata!.cost!,
                tokens: step.metadata?.tokens?.total || 0,
                model: step.metadata?.model
            }));

        return {
            totalCost: execution.metadata?.totalCost || 0,
            stepBreakdown: stepCosts,
            costPerToken: stepCosts.length > 0 ? 
                (execution.metadata?.totalCost || 0) / (execution.metadata?.totalTokens || 1) : 0
        };
    }

    private static generatePerformanceInsights(execution: WorkflowExecution) {
        const completedSteps = execution.steps.filter(step => step.status === 'completed');
        const slowestStep = completedSteps.reduce((slowest, step) => 
            (step.duration || 0) > (slowest.duration || 0) ? step : slowest
        , completedSteps[0]);

        const insights = [];

        if (slowestStep) {
            insights.push({
                type: 'performance',
                message: `Step "${slowestStep.name}" took ${slowestStep.duration}ms (${Math.round((slowestStep.duration! / execution.duration!) * 100)}% of total time)`,
                suggestion: 'Consider optimizing this step or running it in parallel with other steps'
            });
        }

        const cacheHitRate = execution.metadata?.cacheHitRate || 0;
        if (cacheHitRate < 50) {
            insights.push({
                type: 'optimization',
                message: `Low cache hit rate (${cacheHitRate.toFixed(1)}%)`,
                suggestion: 'Enable caching for repeated operations to reduce costs and latency'
            });
        }

        return insights;
    }

    /**
     * Generate real dashboard data from actual workflow executions
     */
    private static async generateRealDashboardData(userId: string, timeRange: string) {
        try {
            // Get all active executions
            const activeExecutions = await this.getActiveExecutions(userId);
            
            // Get recent executions based on timeRange
            const recentExecutions = await this.getRecentExecutions(userId, timeRange);
            
            // Calculate overview metrics
            const overview = {
                totalExecutions: recentExecutions.length,
                successRate: this.calculateSuccessRate(recentExecutions),
                averageDuration: this.calculateAverageDuration(recentExecutions),
                totalCost: this.calculateTotalCost(recentExecutions),
                activeWorkflows: activeExecutions.length
            };

            // Get performance metrics
            const performanceMetrics = {
                throughput: this.calculateThroughput(recentExecutions),
                latency: this.calculateLatencyPercentiles(recentExecutions),
                errorRate: this.calculateErrorRate(recentExecutions)
            };

            // Get cost analysis
            const costAnalysis = this.calculateCostAnalysis(recentExecutions);

            // Get alerts (real alerts based on actual data)
            const alerts = await this.generateRealAlerts(recentExecutions);

            return {
                overview,
                recentExecutions: recentExecutions.slice(0, 10), // Latest 10
                performanceMetrics,
                costAnalysis,
                alerts
            };
        } catch (error) {
            logger.error('Failed to generate dashboard data:', error);
            // Return empty data structure if real data fails
            return {
                overview: {
                    totalExecutions: 0,
                    successRate: 0,
                    averageDuration: 0,
                    totalCost: 0,
                    activeWorkflows: 0
                },
                recentExecutions: [],
                performanceMetrics: {
                    throughput: { period: 'hour', values: [] },
                    latency: { p50: 0, p95: 0, p99: 0 },
                    errorRate: { current: 0, trend: 0 }
                },
                costAnalysis: {
                    totalSpend: 0,
                    breakdown: [],
                    trend: { daily: [] }
                },
                alerts: []
            };
        }
    }

    private static async getActiveExecutions(userId: string) {
        try {
            // Get all execution keys
            const pattern = `workflow:execution:*`;
            let executionKeys: string[] = [];
            
            // Access Redis service's internal methods for local dev compatibility
            const redisServiceInternal = redisService as any;
            
            if (redisServiceInternal.isLocalDev) {
                // For local development, get from in-memory cache
                executionKeys = Array.from(redisServiceInternal.inMemoryCache.keys())
                    .filter((key: unknown): key is string => typeof key === 'string' && key.startsWith('workflow:execution:'));
            } else {
                // For Redis, use keys command
                try {
                    executionKeys = await redisServiceInternal.client.keys(pattern);
                } catch (error) {
                    logger.warn('Failed to get execution keys from Redis:', error);
                    return [];
                }
            }

            const activeExecutions = [];
            
            for (const key of executionKeys) {
                try {
                    const cacheResult = await redisService.checkCache(key);
                    if (cacheResult.hit) {
                        const execution = cacheResult.data;
                        
                        // Filter by user and active status
                        if (execution.userId === userId && 
                            (execution.status === 'running' || execution.status === 'paused')) {
                            activeExecutions.push(execution);
                        }
                    }
                } catch (error) {
                    logger.warn(`Failed to parse execution from key ${key}:`, error);
                    continue;
                }
            }
            
            return activeExecutions;
        } catch (error) {
            logger.error('Failed to get active executions:', error);
            return [];
        }
    }

    private static async getRecentExecutions(userId: string, timeRange: string) {
        try {
            // Get all execution keys
            const pattern = `workflow:execution:*`;
            let executionKeys: string[] = [];
            
            // Access Redis service's internal methods for local dev compatibility
            const redisServiceInternal = redisService as any;
            
            if (redisServiceInternal.isLocalDev) {
                // For local development, get from in-memory cache
                executionKeys = Array.from(redisServiceInternal.inMemoryCache.keys())
                    .filter((key: unknown): key is string => typeof key === 'string' && key.startsWith('workflow:execution:'));
            } else {
                // For Redis, use keys command
                try {
                    executionKeys = await redisServiceInternal.client.keys(pattern);
                } catch (error) {
                    logger.warn('Failed to get execution keys from Redis:', error);
                    return [];
                }
            }

            const recentExecutions = [];
            
            // Calculate time range
            const now = new Date();
            let maxAge = 24 * 60 * 60 * 1000; // 24 hours default
            if (timeRange === '1h') maxAge = 60 * 60 * 1000;
            else if (timeRange === '6h') maxAge = 6 * 60 * 60 * 1000;
            else if (timeRange === '12h') maxAge = 12 * 60 * 60 * 1000;
            else if (timeRange === '7d') maxAge = 7 * 24 * 60 * 60 * 1000;
            else if (timeRange === '30d') maxAge = 30 * 24 * 60 * 60 * 1000;
            
            for (const key of executionKeys) {
                try {
                    const cacheResult = await redisService.checkCache(key);
                    if (cacheResult.hit) {
                        const execution = cacheResult.data;
                        
                        // Filter by user and time range
                        if (execution.userId === userId) {
                            const startTime = new Date(execution.startTime);
                            const timeDiff = now.getTime() - startTime.getTime();
                            
                            if (timeDiff <= maxAge) {
                                recentExecutions.push({
                                    id: execution.id,
                                    workflowName: execution.name,
                                    status: execution.status,
                                    duration: execution.duration,
                                    cost: execution.metadata?.totalCost || 0,
                                    startTime: execution.startTime,
                                    steps: execution.steps
                                });
                            }
                        }
                    }
                } catch (error) {
                    logger.warn(`Failed to parse execution from key ${key}:`, error);
                    continue;
                }
            }
            
            // Sort by start time (newest first)
            return recentExecutions.sort((a, b) => 
                new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
            );
        } catch (error) {
            logger.error('Failed to get recent executions:', error);
            return [];
        }
    }

    private static calculateSuccessRate(executions: any[]) {
        if (executions.length === 0) return 0;
        const successful = executions.filter(e => e.status === 'completed').length;
        return (successful / executions.length) * 100;
    }

    private static calculateAverageDuration(executions: any[]) {
        if (executions.length === 0) return 0;
        const totalDuration = executions.reduce((sum, e) => sum + (e.duration || 0), 0);
        return totalDuration / executions.length;
    }

    private static calculateTotalCost(executions: any[]) {
        return executions.reduce((sum, e) => sum + (e.metadata?.totalCost || 0), 0);
    }

    private static calculateThroughput(executions: any[]) {
        // Calculate hourly throughput
        const hourlyStats = new Map();
        executions.forEach(e => {
            const hour = new Date(e.startTime).getHours();
            hourlyStats.set(hour, (hourlyStats.get(hour) || 0) + 1);
        });
        
        return {
            period: 'hour',
            values: Array.from({ length: 24 }, (_, i) => hourlyStats.get(i) || 0)
        };
    }

    private static calculateLatencyPercentiles(executions: any[]) {
        const durations = executions
            .filter(e => e.duration)
            .map(e => e.duration)
            .sort((a, b) => a - b);
        
        if (durations.length === 0) {
            return { p50: 0, p95: 0, p99: 0 };
        }

        const p50Index = Math.floor(durations.length * 0.5);
        const p95Index = Math.floor(durations.length * 0.95);
        const p99Index = Math.floor(durations.length * 0.99);

        return {
            p50: durations[p50Index] || 0,
            p95: durations[p95Index] || 0,
            p99: durations[p99Index] || 0
        };
    }

    private static calculateErrorRate(executions: any[]) {
        if (executions.length === 0) return { current: 0, trend: 0 };
        
        const failed = executions.filter(e => e.status === 'failed').length;
        const current = (failed / executions.length) * 100;
        
        // Calculate trend (simplified - would need historical data)
        return { current, trend: 0 };
    }

    private static calculateCostAnalysis(executions: any[]) {
        const totalSpend = this.calculateTotalCost(executions);
        
        // Group costs by category
        const categoryStats = new Map();
        executions.forEach(e => {
            e.steps?.forEach((step: any) => {
                const category = step.type === 'llm_call' ? 'LLM Calls' : 
                               step.type === 'api_call' ? 'API Calls' : 'Processing';
                const cost = step.metadata?.cost || 0;
                categoryStats.set(category, (categoryStats.get(category) || 0) + cost);
            });
        });

        const breakdown = Array.from(categoryStats.entries()).map(([category, amount]) => ({
            category,
            amount,
            percentage: totalSpend > 0 ? (amount / totalSpend) * 100 : 0
        }));

        return {
            totalSpend,
            breakdown,
            trend: { daily: [] } // Would calculate from historical data
        };
    }

    private static async generateRealAlerts(executions: any[]) {
        const alerts = [];
        
        // Check for high error rate
        const errorRate = this.calculateErrorRate(executions).current;
        if (errorRate > 10) {
            alerts.push({
                type: 'warning' as const,
                message: `High error rate detected: ${errorRate.toFixed(1)}%`,
                timestamp: new Date()
            });
        }

        // Check for cost spikes
        const avgCost = this.calculateTotalCost(executions) / executions.length;
        if (avgCost > 1.0) { // Threshold for cost alert
            alerts.push({
                type: 'info' as const,
                message: `High average cost per execution: $${avgCost.toFixed(3)}`,
                timestamp: new Date()
            });
        }

        return alerts;
    }
}