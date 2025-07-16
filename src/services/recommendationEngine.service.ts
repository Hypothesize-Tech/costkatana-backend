import { DemandPredictorService, DemandPrediction } from './demandPredictor.service';
import { CostPerformanceProfilerService, CostPerformanceAnalysis, ServingConfiguration } from './costPerformanceProfiler.service';
import { logger } from '../utils/logger';

export interface ScalingRecommendation {
    id: string;
    modelId: string;
    timestamp: Date;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    action: 'scale_up' | 'scale_down' | 'switch_instance' | 'optimize_cost' | 'no_action';
    currentConfiguration: ServingConfiguration;
    recommendedConfiguration: ServingConfiguration;
    reasoning: string;
    impact: {
        costSavings: number;
        performanceChange: number;
        riskLevel: 'low' | 'medium' | 'high';
    };
    implementation: {
        complexity: 'low' | 'medium' | 'high';
        estimatedTime: number; // minutes
        rollbackPlan: string;
    };
    metrics: {
        currentLoad: number;
        predictedLoad: number;
        confidence: number;
        timeWindow: string;
    };
}

export interface RecommendationSummary {
    totalRecommendations: number;
    potentialSavings: number;
    highPriorityCount: number;
    byAction: Record<string, number>;
    byPriority: Record<string, number>;
    modelCoverage: number;
}

export interface AlertNotification {
    id: string;
    type: 'scaling_needed' | 'cost_optimization' | 'performance_degradation' | 'capacity_warning';
    severity: 'info' | 'warning' | 'error' | 'critical';
    modelId: string;
    message: string;
    timestamp: Date;
    recommendation?: ScalingRecommendation;
    autoActionAvailable: boolean;
}

export class RecommendationEngineService {
    /**
     * Generate scaling recommendations for all models
     */
    static async generateRecommendations(
        userId: string,
        hoursAhead: number = 4
    ): Promise<ScalingRecommendation[]> {
        try {
            // Get demand predictions for all models
            const demandPredictions = await DemandPredictorService.getAllModelDemandPredictions(userId, hoursAhead);

            const recommendations: ScalingRecommendation[] = [];

            for (const prediction of demandPredictions) {
                try {
                    const modelRecommendations = await this.generateModelRecommendations(
                        prediction,
                        userId
                    );
                    recommendations.push(...modelRecommendations);
                } catch (error) {
                    logger.warn(`Failed to generate recommendations for model ${prediction.modelId}:`, error);
                }
            }

            // Sort by priority and potential impact
            return recommendations.sort((a, b) => {
                const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
                const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
                if (priorityDiff !== 0) return priorityDiff;

                return b.impact.costSavings - a.impact.costSavings;
            });
        } catch (error) {
            logger.error('Error generating recommendations:', error);
            throw new Error('Failed to generate scaling recommendations');
        }
    }

    /**
     * Generate recommendations for a specific model
     */
    static async generateModelRecommendations(
        prediction: DemandPrediction,
        _userId: string
    ): Promise<ScalingRecommendation[]> {
        try {
            // Determine model type based on model ID (simplified)
            const modelType = this.inferModelType(prediction.modelId);

            // Get cost-performance analysis
            const costAnalysis = await CostPerformanceProfilerService.analyzeCostPerformance(
                prediction.modelId,
                modelType,
                prediction.currentLoad,
                prediction.predictedLoad
            );

            const recommendations: ScalingRecommendation[] = [];

            // Process each recommendation from cost analysis
            for (const analysisRec of costAnalysis.recommendations) {
                const recommendation: ScalingRecommendation = {
                    id: `${prediction.modelId}-${analysisRec.type}-${Date.now()}`,
                    modelId: prediction.modelId,
                    timestamp: new Date(),
                    priority: this.calculatePriority(prediction, analysisRec),
                    action: analysisRec.type,
                    currentConfiguration: costAnalysis.currentConfiguration,
                    recommendedConfiguration: analysisRec.configuration,
                    reasoning: analysisRec.reasoning,
                    impact: {
                        costSavings: analysisRec.expectedSavings,
                        performanceChange: analysisRec.performanceImpact,
                        riskLevel: this.calculateRiskLevel(prediction, analysisRec)
                    },
                    implementation: {
                        complexity: this.calculateComplexity(analysisRec.type),
                        estimatedTime: this.estimateImplementationTime(analysisRec.type),
                        rollbackPlan: this.generateRollbackPlan(analysisRec.type, costAnalysis.currentConfiguration)
                    },
                    metrics: {
                        currentLoad: prediction.currentLoad,
                        predictedLoad: prediction.predictedLoad,
                        confidence: prediction.confidence,
                        timeWindow: prediction.timeWindow
                    }
                };

                recommendations.push(recommendation);
            }

            return recommendations;
        } catch (error) {
            logger.error(`Error generating model recommendations for ${prediction.modelId}:`, error);
            return [];
        }
    }

    /**
     * Get recommendation summary
     */
    static getRecommendationSummary(recommendations: ScalingRecommendation[]): RecommendationSummary {
        const byAction: Record<string, number> = {};
        const byPriority: Record<string, number> = {};
        let totalSavings = 0;
        let highPriorityCount = 0;

        recommendations.forEach(rec => {
            // Count by action
            byAction[rec.action] = (byAction[rec.action] || 0) + 1;

            // Count by priority
            byPriority[rec.priority] = (byPriority[rec.priority] || 0) + 1;

            // Sum savings
            totalSavings += rec.impact.costSavings;

            // Count high priority
            if (rec.priority === 'high' || rec.priority === 'urgent') {
                highPriorityCount++;
            }
        });

        const uniqueModels = new Set(recommendations.map(r => r.modelId)).size;

        return {
            totalRecommendations: recommendations.length,
            potentialSavings: totalSavings,
            highPriorityCount,
            byAction,
            byPriority,
            modelCoverage: uniqueModels
        };
    }

    /**
     * Generate alert notifications
     */
    static generateAlerts(recommendations: ScalingRecommendation[]): AlertNotification[] {
        const alerts: AlertNotification[] = [];

        recommendations.forEach(rec => {
            if (rec.priority === 'urgent' || rec.priority === 'high') {
                const alert: AlertNotification = {
                    id: `alert-${rec.id}`,
                    type: this.getAlertType(rec.action),
                    severity: this.getAlertSeverity(rec.priority),
                    modelId: rec.modelId,
                    message: this.generateAlertMessage(rec),
                    timestamp: new Date(),
                    recommendation: rec,
                    autoActionAvailable: rec.implementation.complexity === 'low' && rec.impact.riskLevel === 'low'
                };

                alerts.push(alert);
            }
        });

        return alerts;
    }

    /**
     * Execute a recommendation (simulation for MVP)
     */
    static async executeRecommendation(
        _recommendationId: string,
        _userId: string,
        dryRun: boolean = true
    ): Promise<{
        success: boolean;
        message: string;
        changes: {
            previousConfig: ServingConfiguration;
            newConfig: ServingConfiguration;
            estimatedSavings: number;
        } | null;
    }> {
        try {
            // In MVP, this is a simulation
            // In production, this would integrate with infrastructure APIs

            if (dryRun) {
                return {
                    success: true,
                    message: 'Dry run completed successfully. No actual changes made.',
                    changes: null
                };
            }

            // Simulate execution
            await new Promise(resolve => setTimeout(resolve, 2000));

            return {
                success: true,
                message: 'Recommendation executed successfully (simulated)',
                changes: null
            };
        } catch (error) {
            logger.error('Error executing recommendation:', error);
            return {
                success: false,
                message: 'Failed to execute recommendation',
                changes: null
            };
        }
    }

    /**
     * Infer model type from model ID
     */
    private static inferModelType(modelId: string): string {
        const modelLower = modelId.toLowerCase();

        if (modelLower.includes('gpt') || modelLower.includes('claude') || modelLower.includes('llama')) {
            return 'llm';
        }
        if (modelLower.includes('embed')) {
            return 'embedding';
        }
        if (modelLower.includes('whisper') || modelLower.includes('audio')) {
            return 'audio';
        }
        if (modelLower.includes('dall-e') || modelLower.includes('image')) {
            return 'image';
        }

        return 'custom';
    }

    /**
     * Calculate recommendation priority
     */
    private static calculatePriority(
        prediction: DemandPrediction,
        analysisRec: CostPerformanceAnalysis['recommendations'][0]
    ): ScalingRecommendation['priority'] {
        const loadIncrease = prediction.predictedLoad / Math.max(prediction.currentLoad, 1);
        const costSavings = Math.abs(analysisRec.expectedSavings);

        // Urgent: High load increase or significant cost savings
        if (loadIncrease > 3 || costSavings > 100) {
            return 'urgent';
        }

        // High: Moderate load increase or good cost savings
        if (loadIncrease > 1.5 || costSavings > 50) {
            return 'high';
        }

        // Medium: Small load increase or some cost savings
        if (loadIncrease > 1.1 || costSavings > 20) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Calculate risk level
     */
    private static calculateRiskLevel(
        prediction: DemandPrediction,
        analysisRec: CostPerformanceAnalysis['recommendations'][0]
    ): 'low' | 'medium' | 'high' {
        const confidence = prediction.confidence;
        const performanceImpact = Math.abs(analysisRec.performanceImpact);

        if (confidence < 0.6 || performanceImpact > 0.5) {
            return 'high';
        }

        if (confidence < 0.8 || performanceImpact > 0.2) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Calculate implementation complexity
     */
    private static calculateComplexity(action: string): 'low' | 'medium' | 'high' {
        switch (action) {
            case 'scale_up':
            case 'scale_down':
                return 'medium';
            case 'switch_instance':
                return 'high';
            case 'optimize_cost':
                return 'low';
            default:
                return 'medium';
        }
    }

    /**
     * Estimate implementation time
     */
    private static estimateImplementationTime(action: string): number {
        switch (action) {
            case 'scale_up':
            case 'scale_down':
                return 15; // 15 minutes
            case 'switch_instance':
                return 45; // 45 minutes
            case 'optimize_cost':
                return 10; // 10 minutes
            default:
                return 30;
        }
    }

    /**
     * Generate rollback plan
     */
    private static generateRollbackPlan(action: string, currentConfig: ServingConfiguration): string {
        switch (action) {
            case 'scale_up':
                return `Rollback: Scale down to ${currentConfig.name} (${currentConfig.instanceType})`;
            case 'scale_down':
                return `Rollback: Scale up to ${currentConfig.name} (${currentConfig.instanceType})`;
            case 'switch_instance':
                return `Rollback: Switch back to ${currentConfig.name} (${currentConfig.instanceType})`;
            case 'optimize_cost':
                return `Rollback: Revert to ${currentConfig.name} configuration`;
            default:
                return `Rollback: Revert to previous configuration: ${currentConfig.name}`;
        }
    }

    /**
     * Get alert type
     */
    private static getAlertType(action: string): AlertNotification['type'] {
        switch (action) {
            case 'scale_up':
                return 'scaling_needed';
            case 'scale_down':
            case 'optimize_cost':
                return 'cost_optimization';
            case 'switch_instance':
                return 'performance_degradation';
            default:
                return 'capacity_warning';
        }
    }

    /**
     * Get alert severity
     */
    private static getAlertSeverity(priority: string): AlertNotification['severity'] {
        switch (priority) {
            case 'urgent':
                return 'critical';
            case 'high':
                return 'error';
            case 'medium':
                return 'warning';
            default:
                return 'info';
        }
    }

    /**
     * Generate alert message
     */
    private static generateAlertMessage(recommendation: ScalingRecommendation): string {
        const { modelId, action, impact, metrics } = recommendation;

        const actionMessages: Record<string, string> = {
            scale_up: `Model ${modelId} requires scaling up. Predicted load (${metrics.predictedLoad}) exceeds current capacity.`,
            scale_down: `Model ${modelId} can be scaled down. Predicted load (${metrics.predictedLoad}) is below current capacity.`,
            switch_instance: `Model ${modelId} would benefit from switching instance types for better performance.`,
            optimize_cost: `Model ${modelId} has cost optimization opportunities. Potential savings: $${impact.costSavings.toFixed(2)}.`,
            no_action: `Model ${modelId} is operating normally.`
        };

        return actionMessages[action] || `Model ${modelId} requires attention.`;
    }
} 