import { loggingService } from './logging.service';

interface AICallRecord {
    timestamp: Date;
    service: string;
    operation: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    latency?: number;
    success?: boolean;
    error?: string;
    userId?: string;
    metadata?: any;
}

interface AICostSummary {
    totalCalls: number;
    totalCost: number;
    byService: Record<string, { calls: number; cost: number }>;
    byOperation: Record<string, { calls: number; cost: number }>;
    topExpensive: AICallRecord[];
}

export class AICostTrackingService {
    private static calls: AICallRecord[] = [];
    private static readonly MAX_RECORDS = 10000;
    
    /**
     * Track an internal AI call
     */
    static trackCall(record: Omit<AICallRecord, 'timestamp'>): void {
        this.calls.push({
            ...record,
            timestamp: new Date()
        });
        
        // Keep only recent records
        if (this.calls.length > this.MAX_RECORDS) {
            this.calls = this.calls.slice(-this.MAX_RECORDS);
        }
        
        loggingService.debug('Internal AI call tracked', {
            service: record.service,
            operation: record.operation,
            cost: record.estimatedCost
        });
    }
    
    /**
     * Get cost summary for a time period
     */
    static getSummary(startDate: Date, endDate: Date): AICostSummary {
        const relevantCalls = this.calls.filter(call => 
            call.timestamp >= startDate && call.timestamp <= endDate
        );
        
        const summary: AICostSummary = {
            totalCalls: relevantCalls.length,
            totalCost: relevantCalls.reduce((sum, call) => sum + call.estimatedCost, 0),
            byService: {},
            byOperation: {},
            topExpensive: relevantCalls
                .sort((a, b) => b.estimatedCost - a.estimatedCost)
                .slice(0, 10)
        };
        
        // Group by service
        for (const call of relevantCalls) {
            if (!summary.byService[call.service]) {
                summary.byService[call.service] = { calls: 0, cost: 0 };
            }
            summary.byService[call.service].calls++;
            summary.byService[call.service].cost += call.estimatedCost;
            
            // Group by operation
            if (!summary.byOperation[call.operation]) {
                summary.byOperation[call.operation] = { calls: 0, cost: 0 };
            }
            summary.byOperation[call.operation].calls++;
            summary.byOperation[call.operation].cost += call.estimatedCost;
        }
        
        return summary;
    }
    
    /**
     * Get monthly summary
     */
    static getMonthlySummary(): AICostSummary {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return this.getSummary(startOfMonth, now);
    }
    
    /**
     * Get top cost drivers
     */
    static getTopCostDrivers(limit: number = 10): Array<{ service: string; operation: string; cost: number; calls: number }> {
        const drivers = new Map<string, { cost: number; calls: number }>();
        
        for (const call of this.calls) {
            const key = `${call.service}::${call.operation}`;
            const existing = drivers.get(key) || { cost: 0, calls: 0 };
            existing.cost += call.estimatedCost;
            existing.calls += 1;
            drivers.set(key, existing);
        }
        
        return Array.from(drivers.entries())
            .map(([key, value]) => {
                const [service, operation] = key.split('::');
                return { service, operation, ...value };
            })
            .sort((a, b) => b.cost - a.cost)
            .slice(0, limit);
    }
    
    /**
     * Get service summary
     */
    static getServiceSummary(): Record<string, { calls: number; cost: number; avgLatency: number; failureRate: number }> {
        const summary: Record<string, { calls: number; cost: number; totalLatency: number; failures: number }> = {};
        
        for (const call of this.calls) {
            if (!summary[call.service]) {
                summary[call.service] = { calls: 0, cost: 0, totalLatency: 0, failures: 0 };
            }
            summary[call.service].calls++;
            summary[call.service].cost += call.estimatedCost;
            if (call.latency) summary[call.service].totalLatency += call.latency;
            if (call.success === false) summary[call.service].failures++;
        }
        
        // Calculate averages and failure rates
        const result: Record<string, { calls: number; cost: number; avgLatency: number; failureRate: number }> = {};
        for (const [service, data] of Object.entries(summary)) {
            result[service] = {
                calls: data.calls,
                cost: data.cost,
                avgLatency: data.calls > 0 ? data.totalLatency / data.calls : 0,
                failureRate: data.calls > 0 ? (data.failures / data.calls) * 100 : 0
            };
        }
        
        return result;
    }
    
    /**
     * Clear old records
     */
    static clearOldRecords(daysToKeep: number = 30): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const originalLength = this.calls.length;
        this.calls = this.calls.filter(call => call.timestamp >= cutoffDate);
        
        loggingService.info('Cleared old AI call records', {
            removed: originalLength - this.calls.length,
            remaining: this.calls.length
        });
    }
}

