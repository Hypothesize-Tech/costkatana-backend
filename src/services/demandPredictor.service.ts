import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';

export interface InferenceRequest {
    id: string;
    modelId: string;
    timestamp: Date;
    requestSize: number;
    responseTime: number;
    resourceUtilization: {
        cpu: number;
        gpu: number;
        memory: number;
    };
    cost: number;
    tokens: number;
}

export interface DemandPrediction {
    modelId: string;
    timeWindow: string;
    currentLoad: number;
    predictedLoad: number;
    confidence: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    peakTime?: Date;
    minTime?: Date;
    historicalPattern: {
        hourlyAverage: number[];
        dailyAverage: number[];
        weeklyAverage: number[];
    };
}

export interface ModelDemandHistory {
    modelId: string;
    timeSeriesData: Array<{
        timestamp: Date;
        requestCount: number;
        averageResponseTime: number;
        totalCost: number;
        resourceUtilization: {
            cpu: number;
            gpu: number;
            memory: number;
        };
    }>;
    statistics: {
        totalRequests: number;
        averageRequestsPerHour: number;
        peakRequestsPerHour: number;
        costPerRequest: number;
    };
}

export class DemandPredictorService {
    /**
     * Get historical demand data for a specific model
     */
    static async getModelDemandHistory(
        modelId: string,
        userId: string,
        timeRange: {
            startDate: Date;
            endDate: Date;
        }
    ): Promise<ModelDemandHistory> {
        try {
            const usageData = await Usage.find({
                userId,
                model: modelId,
                createdAt: {
                    $gte: timeRange.startDate,
                    $lte: timeRange.endDate
                }
            }).sort({ createdAt: 1 }).lean();

            // Group by hour for time series analysis
            const hourlyData = this.groupByHour(usageData);

            const timeSeriesData = hourlyData.map(hour => ({
                timestamp: hour.timestamp,
                requestCount: hour.requests.length,
                averageResponseTime: hour.requests.reduce((sum, req) => sum + req.responseTime, 0) / hour.requests.length,
                totalCost: hour.requests.reduce((sum, req) => sum + req.cost, 0),
                resourceUtilization: {
                    cpu: Math.random() * 100, // Simulated - would come from actual metrics
                    gpu: Math.random() * 100,
                    memory: Math.random() * 100
                }
            }));

            const statistics = {
                totalRequests: usageData.length,
                averageRequestsPerHour: usageData.length / Math.max(1, hourlyData.length),
                peakRequestsPerHour: Math.max(...hourlyData.map(h => h.requests.length)),
                costPerRequest: usageData.reduce((sum, req) => sum + req.cost, 0) / usageData.length
            };

            return {
                modelId,
                timeSeriesData,
                statistics
            };
        } catch (error) {
            logger.error('Error getting model demand history:', error);
            throw new Error('Failed to get model demand history');
        }
    }

    /**
     * Predict future demand for a specific model using simple time-series forecasting
     */
    static async predictModelDemand(
        modelId: string,
        userId: string,
        hoursAhead: number = 4
    ): Promise<DemandPrediction> {
        try {
            // Get historical data for the last 30 days
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

            const history = await this.getModelDemandHistory(modelId, userId, {
                startDate,
                endDate
            });

            if (history.timeSeriesData.length < 24) {
                throw new Error('Insufficient historical data for prediction');
            }

            // Calculate current load (last hour)
            const lastHour = history.timeSeriesData[history.timeSeriesData.length - 1];
            const currentLoad = lastHour ? lastHour.requestCount : 0;

            // Simple moving average prediction
            const recentData = history.timeSeriesData.slice(-24); // Last 24 hours
            const movingAverage = recentData.reduce((sum, data) => sum + data.requestCount, 0) / recentData.length;

            // Calculate trend
            const firstHalf = recentData.slice(0, 12).reduce((sum, data) => sum + data.requestCount, 0) / 12;
            const secondHalf = recentData.slice(12).reduce((sum, data) => sum + data.requestCount, 0) / 12;
            const trendDirection = secondHalf > firstHalf * 1.1 ? 'increasing' :
                secondHalf < firstHalf * 0.9 ? 'decreasing' : 'stable';

            // Apply seasonal patterns
            const currentHour = new Date().getHours();
            const seasonalMultiplier = this.getSeasonalMultiplier(currentHour, history.timeSeriesData);

            const predictedLoad = Math.round(movingAverage * seasonalMultiplier);

            // Calculate confidence based on data consistency
            const variance = this.calculateVariance(recentData.map(d => d.requestCount));
            const confidence = Math.max(0.1, Math.min(0.95, 1 - (variance / (movingAverage * movingAverage))));

            // Generate historical patterns
            const historicalPattern = this.generateHistoricalPattern(history.timeSeriesData);

            // Find peak and minimum times
            const { peakTime, minTime } = this.findPeakAndMinTimes(history.timeSeriesData);

            return {
                modelId,
                timeWindow: `${hoursAhead} hours`,
                currentLoad,
                predictedLoad,
                confidence,
                trend: trendDirection,
                peakTime,
                minTime,
                historicalPattern
            };
        } catch (error) {
            logger.error('Error predicting model demand:', error);
            throw new Error('Failed to predict model demand');
        }
    }

    /**
     * Get demand predictions for all models for a user
     */
    static async getAllModelDemandPredictions(
        userId: string,
        hoursAhead: number = 4
    ): Promise<DemandPrediction[]> {
        try {
            // Get all unique models for the user
            const uniqueModels = await Usage.distinct('model', { userId });

            const predictions = await Promise.all(
                uniqueModels.map(async (modelId) => {
                    try {
                        return await this.predictModelDemand(modelId, userId, hoursAhead);
                    } catch (error) {
                        logger.warn(`Failed to predict demand for model ${modelId}:`, error);
                        return null;
                    }
                })
            );

            return predictions.filter(p => p !== null) as DemandPrediction[];
        } catch (error) {
            logger.error('Error getting all model demand predictions:', error);
            throw new Error('Failed to get demand predictions');
        }
    }

    /**
     * Group usage data by hour
     */
    private static groupByHour(usageData: any[]): Array<{
        timestamp: Date;
        requests: any[];
    }> {
        const hourlyGroups = new Map<string, any[]>();

        usageData.forEach(usage => {
            const hour = new Date(usage.createdAt);
            hour.setMinutes(0, 0, 0);
            const hourKey = hour.toISOString();

            if (!hourlyGroups.has(hourKey)) {
                hourlyGroups.set(hourKey, []);
            }
            hourlyGroups.get(hourKey)!.push(usage);
        });

        return Array.from(hourlyGroups.entries())
            .map(([hourKey, requests]) => ({
                timestamp: new Date(hourKey),
                requests
            }))
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    /**
     * Calculate seasonal multiplier based on hour of day
     */
    private static getSeasonalMultiplier(currentHour: number, historicalData: any[]): number {
        const hourlyAverages = new Array(24).fill(0);
        const hourlyCounts = new Array(24).fill(0);

        historicalData.forEach(data => {
            const hour = data.timestamp.getHours();
            hourlyAverages[hour] += data.requestCount;
            hourlyCounts[hour]++;
        });

        // Calculate averages
        for (let i = 0; i < 24; i++) {
            if (hourlyCounts[i] > 0) {
                hourlyAverages[i] /= hourlyCounts[i];
            }
        }

        const overallAverage = hourlyAverages.reduce((sum, avg) => sum + avg, 0) / 24;
        const currentHourAverage = hourlyAverages[currentHour] || overallAverage;

        return overallAverage > 0 ? currentHourAverage / overallAverage : 1;
    }

    /**
     * Calculate variance of a dataset
     */
    private static calculateVariance(data: number[]): number {
        if (data.length === 0) return 0;

        const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;

        return variance;
    }

    /**
     * Generate historical patterns for hourly, daily, and weekly averages
     */
    private static generateHistoricalPattern(historicalData: any[]): {
        hourlyAverage: number[];
        dailyAverage: number[];
        weeklyAverage: number[];
    } {
        const hourlyAverages = new Array(24).fill(0);
        const hourlyCounts = new Array(24).fill(0);
        const dailyAverages = new Array(7).fill(0);
        const dailyCounts = new Array(7).fill(0);
        const weeklyAverages = new Array(4).fill(0);
        const weeklyCounts = new Array(4).fill(0);

        historicalData.forEach(data => {
            const hour = data.timestamp.getHours();
            const dayOfWeek = data.timestamp.getDay();
            const weekOfMonth = Math.floor(data.timestamp.getDate() / 7);

            hourlyAverages[hour] += data.requestCount;
            hourlyCounts[hour]++;

            dailyAverages[dayOfWeek] += data.requestCount;
            dailyCounts[dayOfWeek]++;

            if (weekOfMonth < 4) {
                weeklyAverages[weekOfMonth] += data.requestCount;
                weeklyCounts[weekOfMonth]++;
            }
        });

        // Calculate averages
        for (let i = 0; i < 24; i++) {
            if (hourlyCounts[i] > 0) {
                hourlyAverages[i] /= hourlyCounts[i];
            }
        }

        for (let i = 0; i < 7; i++) {
            if (dailyCounts[i] > 0) {
                dailyAverages[i] /= dailyCounts[i];
            }
        }

        for (let i = 0; i < 4; i++) {
            if (weeklyCounts[i] > 0) {
                weeklyAverages[i] /= weeklyCounts[i];
            }
        }

        return {
            hourlyAverage: hourlyAverages,
            dailyAverage: dailyAverages,
            weeklyAverage: weeklyAverages
        };
    }

    /**
     * Find peak and minimum demand times
     */
    private static findPeakAndMinTimes(historicalData: any[]): {
        peakTime: Date;
        minTime: Date;
    } {
        let maxRequests = 0;
        let minRequests = Infinity;
        let peakTime = new Date();
        let minTime = new Date();

        historicalData.forEach(data => {
            if (data.requestCount > maxRequests) {
                maxRequests = data.requestCount;
                peakTime = data.timestamp;
            }
            if (data.requestCount < minRequests) {
                minRequests = data.requestCount;
                minTime = data.timestamp;
            }
        });

        return { peakTime, minTime };
    }
} 