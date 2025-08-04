import { logger } from '../utils/logger';

// Simplified LangSmith service for basic tracing and analytics
export class LangSmithService {
    private isEnabled: boolean;
    private traces: Array<{
        id: string;
        name: string;
        startTime: number;
        endTime?: number;
        inputs: Record<string, any>;
        outputs?: Record<string, any>;
        cost?: number;
        error?: string;
        metadata: Record<string, any>;
    }> = [];

    constructor() {
        this.isEnabled = !!(process.env.LANGCHAIN_API_KEY && process.env.LANGCHAIN_PROJECT);
        
        if (this.isEnabled) {
            logger.info('🔗 LangSmith service initialized (simplified mode)');
        } else {
            logger.warn('⚠️ LangSmith not configured - using local tracing only');
        }
    }

    /**
     * Create a new run for tracing multi-agent interactions
     */
    public async createRun(
        name: string,
        runType: 'llm' | 'chain' | 'tool',
        inputs: Record<string, any>,
        metadata: Record<string, any> = {}
    ): Promise<string | null> {
        try {
            const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const trace = {
                id: runId,
                name,
                startTime: Date.now(),
                inputs,
                metadata: {
                    ...metadata,
                    runType,
                    timestamp: new Date().toISOString(),
                    service: 'ai-cost-optimizer',
                    version: '2.0.0'
                }
            };

            this.traces.push(trace);
            
            // Keep only last 1000 traces to prevent memory issues
            if (this.traces.length > 1000) {
                this.traces = this.traces.slice(-1000);
            }

            logger.info(`📊 LangSmith run created: ${runId}`);
            return runId;
        } catch (error) {
            logger.error('❌ Failed to create LangSmith run:', error);
            return null;
        }
    }

    /**
     * Update a run with outputs and end the trace
     */
    public async endRun(
        runId: string,
        outputs: Record<string, any>,
        error?: string
    ): Promise<void> {
        if (!runId) return;

        try {
            const trace = this.traces.find(t => t.id === runId);
            if (trace) {
                trace.endTime = Date.now();
                trace.outputs = outputs;
                if (error) {
                    trace.error = error;
                }
            }

            logger.info(`✅ LangSmith run completed: ${runId}`);
        } catch (error) {
            logger.error('❌ Failed to end LangSmith run:', error);
        }
    }

    /**
     * Create a child run for individual agent steps
     */
    public async createChildRun(
        parentRunId: string,
        name: string,
        runType: 'llm' | 'chain' | 'tool',
        inputs: Record<string, any>,
        metadata: Record<string, any> = {}
    ): Promise<string | null> {
        if (!parentRunId) return null;

        try {
            const runId = `child_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const trace = {
                id: runId,
                name,
                startTime: Date.now(),
                inputs,
                metadata: {
                    ...metadata,
                    runType,
                    parentRunId,
                    timestamp: new Date().toISOString()
                }
            };

            this.traces.push(trace);
            return runId;
        } catch (error) {
            logger.error('❌ Failed to create LangSmith child run:', error);
            return null;
        }
    }

    /**
     * Log cost information for analytics
     */
    public async logCostEvent(
        runId: string,
        cost: number,
        tokenUsage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        },
        model: string
    ): Promise<void> {
        if (!runId) return;

        try {
            const trace = this.traces.find(t => t.id === runId);
            if (trace) {
                trace.cost = cost;
                trace.metadata = {
                    ...trace.metadata,
                    tokenUsage,
                    model,
                    costTimestamp: new Date().toISOString()
                };
            }

            logger.info(`💰 Cost logged for run ${runId}: $${cost.toFixed(6)}`);
        } catch (error) {
            logger.error('❌ Failed to log cost event:', error);
        }
    }

    /**
     * Retrieve historical cost data for analytics
     */
    public async getHistoricalCostData(
        _projectName: string,
        startTime?: Date,
        endTime?: Date
    ): Promise<any[]> {
        try {
            const start = startTime?.getTime() || 0;
            const end = endTime?.getTime() || Date.now();

            const costData = this.traces
                .filter(trace => 
                    trace.cost !== undefined && 
                    trace.startTime >= start && 
                    trace.startTime <= end
                )
                .map(trace => ({
                    id: trace.id,
                    timestamp: new Date(trace.startTime).toISOString(),
                    cost: trace.cost || 0,
                    tokenUsage: trace.metadata.tokenUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    model: trace.metadata.model || 'unknown',
                    inputs: trace.inputs,
                    outputs: trace.outputs,
                    metadata: trace.metadata
                }));

            logger.info(`📈 Retrieved ${costData.length} cost records from local traces`);
            return costData;
        } catch (error) {
            logger.error('❌ Failed to retrieve historical cost data:', error);
            return [];
        }
    }

    /**
     * Generate cost analytics report
     */
    public async generateCostAnalytics(
        projectName: string,
        timeRange: { start: Date; end: Date }
    ): Promise<{
        totalCost: number;
        averageCostPerRun: number;
        totalRuns: number;
        costByModel: Record<string, number>;
        costTrend: Array<{ date: string; cost: number }>;
        topExpensiveRuns: Array<{ id: string; cost: number; timestamp: string }>;
    }> {
        const costData = await this.getHistoricalCostData(projectName, timeRange.start, timeRange.end);

        if (costData.length === 0) {
            return {
                totalCost: 0,
                averageCostPerRun: 0,
                totalRuns: 0,
                costByModel: {},
                costTrend: [],
                topExpensiveRuns: []
            };
        }

        const totalCost = costData.reduce((sum, run) => sum + run.cost, 0);
        const averageCostPerRun = totalCost / costData.length;

        // Group costs by model
        const costByModel = costData.reduce((acc, run) => {
            acc[run.model] = (acc[run.model] || 0) + run.cost;
            return acc;
        }, {} as Record<string, number>);

        // Generate daily cost trend
        const dailyCosts = costData.reduce((acc, run) => {
            const date = run.timestamp.split('T')[0];
            acc[date] = (acc[date] || 0) + run.cost;
            return acc;
        }, {} as Record<string, number>);

        const costTrend = Object.entries(dailyCosts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, cost]) => ({ date, cost: cost as number }));

        // Find top expensive runs
        const topExpensiveRuns = costData
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 10)
            .map(run => ({
                id: run.id,
                cost: run.cost,
                timestamp: run.timestamp
            }));

        return {
            totalCost,
            averageCostPerRun,
            totalRuns: costData.length,
            costByModel,
            costTrend,
            topExpensiveRuns
        };
    }

    /**
     * Check if LangSmith is properly configured
     */
    public isConfigured(): boolean {
        return this.isEnabled;
    }

    /**
     * Get project statistics
     */
    public async getProjectStats(_projectName: string): Promise<{
        totalRuns: number;
        successRate: number;
        averageRunTime: number;
        lastActivity: string;
    }> {
        try {
            const totalRuns = this.traces.length;
            const successfulRuns = this.traces.filter(trace => !trace.error).length;
            const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

            const completedTraces = this.traces.filter(trace => trace.endTime);
            const runTimes = completedTraces.map(trace => (trace.endTime! - trace.startTime));
            
            const averageRunTime = runTimes.length > 0 
                ? runTimes.reduce((sum, time) => sum + time, 0) / runTimes.length 
                : 0;

            const lastActivity = this.traces.length > 0 
                ? new Date(Math.max(...this.traces.map(trace => trace.startTime))).toISOString()
                : 'No activity';

            return {
                totalRuns,
                successRate: Math.round(successRate * 100) / 100,
                averageRunTime: Math.round(averageRunTime),
                lastActivity
            };
        } catch (error) {
            logger.error('❌ Failed to get project stats:', error);
            return {
                totalRuns: 0,
                successRate: 0,
                averageRunTime: 0,
                lastActivity: 'Error retrieving stats'
            };
        }
    }

    /**
     * Get all traces for debugging
     */
    public getTraces(): any[] {
        return this.traces.map(trace => ({
            ...trace,
            duration: trace.endTime ? trace.endTime - trace.startTime : null
        }));
    }

    /**
     * Clear old traces (for memory management)
     */
    public clearOldTraces(olderThanHours: number = 24): void {
        const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
        const initialLength = this.traces.length;
        this.traces = this.traces.filter(trace => trace.startTime > cutoff);
        const removed = initialLength - this.traces.length;
        
        if (removed > 0) {
            logger.info(`🧹 Cleared ${removed} old traces (older than ${olderThanHours}h)`);
        }
    }
}

export const langSmithService = new LangSmithService();