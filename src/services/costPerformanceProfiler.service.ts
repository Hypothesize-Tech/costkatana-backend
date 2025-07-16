import { logger } from '../utils/logger';

export interface ServingConfiguration {
    id: string;
    name: string;
    instanceType: string;
    provider: 'aws' | 'azure' | 'gcp' | 'custom';
    specifications: {
        cpu: number;
        memory: number;
        gpu?: {
            type: string;
            count: number;
            memory: number;
        };
        storage: number;
    };
    pricing: {
        hourlyRate: number;
        currency: string;
        billingModel: 'hourly' | 'per-request' | 'spot' | 'reserved';
    };
    performance: {
        requestsPerSecond: number;
        averageLatency: number;
        maxConcurrency: number;
        warmupTime: number;
    };
    costEfficiency: {
        costPerRequest: number;
        costPerHour: number;
        performanceScore: number;
    };
}

export interface ModelConfiguration {
    modelId: string;
    modelName: string;
    modelType: 'llm' | 'embedding' | 'image' | 'audio' | 'custom';
    configurations: ServingConfiguration[];
    recommendations: {
        optimal: ServingConfiguration;
        budget: ServingConfiguration;
        performance: ServingConfiguration;
    };
    currentConfiguration?: ServingConfiguration;
}

export interface CostPerformanceAnalysis {
    modelId: string;
    currentConfiguration: ServingConfiguration;
    alternativeConfigurations: ServingConfiguration[];
    recommendations: {
        type: 'scale_up' | 'scale_down' | 'switch_instance' | 'optimize_cost';
        configuration: ServingConfiguration;
        expectedSavings: number;
        performanceImpact: number;
        reasoning: string;
    }[];
    costBreakdown: {
        compute: number;
        storage: number;
        network: number;
        total: number;
    };
}

export class CostPerformanceProfilerService {
    private static servingConfigurations: Map<string, ServingConfiguration[]> = new Map();

    /**
     * Initialize default serving configurations for common models
     */
    static initializeDefaultConfigurations(): void {
        // AWS Configurations
        const awsConfigurations: ServingConfiguration[] = [
            {
                id: 'aws-t2-micro',
                name: 'AWS t2.micro',
                instanceType: 't2.micro',
                provider: 'aws',
                specifications: {
                    cpu: 1,
                    memory: 1,
                    storage: 8
                },
                pricing: {
                    hourlyRate: 0.0116,
                    currency: 'USD',
                    billingModel: 'hourly'
                },
                performance: {
                    requestsPerSecond: 5,
                    averageLatency: 800,
                    maxConcurrency: 10,
                    warmupTime: 30
                },
                costEfficiency: {
                    costPerRequest: 0.0023,
                    costPerHour: 0.0116,
                    performanceScore: 3
                }
            },
            {
                id: 'aws-t2-small',
                name: 'AWS t2.small',
                instanceType: 't2.small',
                provider: 'aws',
                specifications: {
                    cpu: 1,
                    memory: 2,
                    storage: 20
                },
                pricing: {
                    hourlyRate: 0.023,
                    currency: 'USD',
                    billingModel: 'hourly'
                },
                performance: {
                    requestsPerSecond: 10,
                    averageLatency: 500,
                    maxConcurrency: 20,
                    warmupTime: 20
                },
                costEfficiency: {
                    costPerRequest: 0.0023,
                    costPerHour: 0.023,
                    performanceScore: 5
                }
            },
            {
                id: 'aws-g4dn-xlarge',
                name: 'AWS g4dn.xlarge',
                instanceType: 'g4dn.xlarge',
                provider: 'aws',
                specifications: {
                    cpu: 4,
                    memory: 16,
                    gpu: {
                        type: 'T4',
                        count: 1,
                        memory: 16
                    },
                    storage: 125
                },
                pricing: {
                    hourlyRate: 0.526,
                    currency: 'USD',
                    billingModel: 'hourly'
                },
                performance: {
                    requestsPerSecond: 50,
                    averageLatency: 200,
                    maxConcurrency: 100,
                    warmupTime: 60
                },
                costEfficiency: {
                    costPerRequest: 0.0105,
                    costPerHour: 0.526,
                    performanceScore: 9
                }
            },
            {
                id: 'aws-g5-xlarge',
                name: 'AWS g5.xlarge',
                instanceType: 'g5.xlarge',
                provider: 'aws',
                specifications: {
                    cpu: 4,
                    memory: 16,
                    gpu: {
                        type: 'A10G',
                        count: 1,
                        memory: 24
                    },
                    storage: 250
                },
                pricing: {
                    hourlyRate: 1.006,
                    currency: 'USD',
                    billingModel: 'hourly'
                },
                performance: {
                    requestsPerSecond: 100,
                    averageLatency: 100,
                    maxConcurrency: 200,
                    warmupTime: 90
                },
                costEfficiency: {
                    costPerRequest: 0.0101,
                    costPerHour: 1.006,
                    performanceScore: 10
                }
            }
        ];

        // Store configurations for different model types
        this.servingConfigurations.set('llm', awsConfigurations);
        this.servingConfigurations.set('embedding', awsConfigurations.slice(0, 2));
        this.servingConfigurations.set('image', awsConfigurations.slice(2));
        this.servingConfigurations.set('audio', awsConfigurations.slice(2));
        this.servingConfigurations.set('custom', awsConfigurations);
    }

    /**
     * Get available serving configurations for a model type
     */
    static getServingConfigurations(modelType: string): ServingConfiguration[] {
        if (this.servingConfigurations.size === 0) {
            this.initializeDefaultConfigurations();
        }

        return this.servingConfigurations.get(modelType) || this.servingConfigurations.get('custom') || [];
    }

    /**
     * Get model configuration with recommendations
     */
    static getModelConfiguration(modelId: string, modelType: string): ModelConfiguration {
        const configurations = this.getServingConfigurations(modelType);

        // Calculate recommendations based on different criteria
        const optimal = this.findOptimalConfiguration(configurations);
        const budget = this.findBudgetConfiguration(configurations);
        const performance = this.findPerformanceConfiguration(configurations);

        return {
            modelId,
            modelName: modelId,
            modelType: modelType as any,
            configurations,
            recommendations: {
                optimal,
                budget,
                performance
            },
            currentConfiguration: configurations[0] // Default to first configuration
        };
    }

    /**
     * Analyze cost-performance trade-offs for a model
     */
    static async analyzeCostPerformance(
        modelId: string,
        modelType: string,
        currentLoad: number,
        predictedLoad: number
    ): Promise<CostPerformanceAnalysis> {
        try {
            const configurations = this.getServingConfigurations(modelType);
            const currentConfig = configurations[0]; // Assume first as current

            // Find alternative configurations
            const alternativeConfigurations = configurations.slice(1);

            // Generate recommendations based on load analysis
            const recommendations = this.generateRecommendations(
                currentConfig,
                alternativeConfigurations,
                currentLoad,
                predictedLoad
            );

            // Calculate cost breakdown
            const costBreakdown = this.calculateCostBreakdown(currentConfig, currentLoad);

            return {
                modelId,
                currentConfiguration: currentConfig,
                alternativeConfigurations,
                recommendations,
                costBreakdown
            };
        } catch (error) {
            logger.error('Error analyzing cost performance:', error);
            throw new Error('Failed to analyze cost performance');
        }
    }

    /**
     * Calculate cost for a specific configuration and load
     */
    static calculateCostForConfiguration(
        config: ServingConfiguration,
        requestsPerHour: number
    ): number {
        // Calculate hourly cost
        const hourlyCost = config.pricing.hourlyRate;

        // Calculate per-request cost
        const maxRequestsPerHour = config.performance.requestsPerSecond * 3600;

        // If over capacity, would need multiple instances
        const instancesNeeded = Math.ceil(requestsPerHour / maxRequestsPerHour);

        return hourlyCost * instancesNeeded;
    }

    /**
     * Find optimal configuration based on cost-performance balance
     */
    private static findOptimalConfiguration(configurations: ServingConfiguration[]): ServingConfiguration {
        return configurations.reduce((best, current) => {
            const bestScore = best.costEfficiency.performanceScore / best.pricing.hourlyRate;
            const currentScore = current.costEfficiency.performanceScore / current.pricing.hourlyRate;
            return currentScore > bestScore ? current : best;
        });
    }

    /**
     * Find budget-friendly configuration
     */
    private static findBudgetConfiguration(configurations: ServingConfiguration[]): ServingConfiguration {
        return configurations.reduce((cheapest, current) => {
            return current.pricing.hourlyRate < cheapest.pricing.hourlyRate ? current : cheapest;
        });
    }

    /**
     * Find performance-optimized configuration
     */
    private static findPerformanceConfiguration(configurations: ServingConfiguration[]): ServingConfiguration {
        return configurations.reduce((fastest, current) => {
            return current.performance.requestsPerSecond > fastest.performance.requestsPerSecond ? current : fastest;
        });
    }

    /**
     * Generate scaling recommendations
     */
    private static generateRecommendations(
        currentConfig: ServingConfiguration,
        alternatives: ServingConfiguration[],
        currentLoad: number,
        predictedLoad: number
    ): CostPerformanceAnalysis['recommendations'] {
        const recommendations: CostPerformanceAnalysis['recommendations'] = [];

        // Current capacity
        const currentCapacity = currentConfig.performance.requestsPerSecond * 3600;
        const currentCost = this.calculateCostForConfiguration(currentConfig, currentLoad);

        // Scale up recommendation
        if (predictedLoad > currentCapacity * 0.8) {
            const performanceConfig = this.findPerformanceConfiguration([currentConfig, ...alternatives]);
            const newCost = this.calculateCostForConfiguration(performanceConfig, predictedLoad);

            recommendations.push({
                type: 'scale_up',
                configuration: performanceConfig,
                expectedSavings: currentCost - newCost,
                performanceImpact: (performanceConfig.performance.requestsPerSecond - currentConfig.performance.requestsPerSecond) / currentConfig.performance.requestsPerSecond,
                reasoning: `Predicted load (${predictedLoad} req/hr) exceeds 80% of current capacity (${currentCapacity} req/hr). Scaling up to ${performanceConfig.name} will improve performance.`
            });
        }

        // Scale down recommendation
        if (predictedLoad < currentCapacity * 0.3) {
            const budgetConfig = this.findBudgetConfiguration([currentConfig, ...alternatives]);
            const newCost = this.calculateCostForConfiguration(budgetConfig, predictedLoad);

            recommendations.push({
                type: 'scale_down',
                configuration: budgetConfig,
                expectedSavings: currentCost - newCost,
                performanceImpact: (budgetConfig.performance.requestsPerSecond - currentConfig.performance.requestsPerSecond) / currentConfig.performance.requestsPerSecond,
                reasoning: `Predicted load (${predictedLoad} req/hr) is only ${Math.round(predictedLoad / currentCapacity * 100)}% of current capacity. Scaling down to ${budgetConfig.name} will save costs.`
            });
        }

        // Cost optimization recommendation
        const optimalConfig = this.findOptimalConfiguration([currentConfig, ...alternatives]);
        if (optimalConfig.id !== currentConfig.id) {
            const newCost = this.calculateCostForConfiguration(optimalConfig, predictedLoad);

            recommendations.push({
                type: 'optimize_cost',
                configuration: optimalConfig,
                expectedSavings: currentCost - newCost,
                performanceImpact: (optimalConfig.performance.requestsPerSecond - currentConfig.performance.requestsPerSecond) / currentConfig.performance.requestsPerSecond,
                reasoning: `Switching to ${optimalConfig.name} provides better cost-performance balance for your workload.`
            });
        }

        return recommendations;
    }

    /**
     * Calculate cost breakdown
     */
    private static calculateCostBreakdown(
        config: ServingConfiguration,
        currentLoad: number
    ): CostPerformanceAnalysis['costBreakdown'] {
        const totalCost = this.calculateCostForConfiguration(config, currentLoad);

        return {
            compute: totalCost * 0.7, // 70% compute
            storage: totalCost * 0.2, // 20% storage
            network: totalCost * 0.1, // 10% network
            total: totalCost
        };
    }
} 