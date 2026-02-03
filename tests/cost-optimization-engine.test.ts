import { CostOptimizationEngine } from '../src/services/cost-optimization-engine.service';
import { Usage } from '../src/models/Usage';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { Alert } from '../src/models/Alert';
import { connectTestDb, disconnectTestDb } from './helpers/database';
import { createMockUsage, createMockProject, createMockUser } from './helpers/mocks';

// Mock external services
jest.mock('../src/services/logging.service');
jest.mock('../src/services/mixpanel.service');
jest.mock('../src/services/telemetry.service');
jest.mock('../src/services/notification.service');

describe('CostOptimizationEngine', () => {
    let optimizationEngine: CostOptimizationEngine;
    let testUserId: string;
    let testProjectId: string;

    beforeAll(async () => {
        await connectTestDb();
    });

    afterAll(async () => {
        await disconnectTestDb();
    });

    beforeEach(async () => {
        // Clear database
        await Usage.deleteMany({});
        await Project.deleteMany({});
        await User.deleteMany({});
        await Alert.deleteMany({});

        optimizationEngine = CostOptimizationEngine.getInstance();

        // Create test user and project
        const testUser = await createMockUser();
        const testProject = await createMockProject(testUser._id);
        testUserId = testUser._id.toString();
        testProjectId = testProject._id.toString();
    });

    describe('analyzeAndOptimize', () => {
        it('should generate optimization suggestions for high-cost model usage', async () => {
            // Create usage data with expensive models
            const expensiveUsage = Array.from({ length: 10 }, (_, i) => 
                createMockUsage({
                    userId: testUserId,
                    projectId: testProjectId,
                    cost: 0.15, // High cost
                    model: 'gpt-4',
                    service: 'openai' as any,
                    createdAt: new Date(Date.now() - i * 60000) // Last 10 minutes
                })
            );

            await Usage.insertMany(expensiveUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId, testProjectId);

            expect(report).toBeDefined();
            expect(report.suggestions).toBeDefined();
            expect(report.suggestions.length).toBeGreaterThan(0);
            expect(report.summary.totalPotentialSavings).toBeGreaterThan(0);
            
            // Should have high-cost model alternative suggestion
            const highCostSuggestion = report.suggestions.find(s => 
                s.title.includes('Cheaper Model') || s.category === 'Model Selection'
            );
            expect(highCostSuggestion).toBeDefined();
            expect(highCostSuggestion?.priority).toBe('high');
        });

        it('should detect repeated content opportunities', async () => {
            // Create usage with repeated prompts
            const repeatedPrompt = 'What is the capital of France?';
            const repeatedUsage = Array.from({ length: 5 }, () => 
                createMockUsage({
                    userId: testUserId,
                    prompt: repeatedPrompt,
                    cost: 0.02,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(repeatedUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            // Should detect repeated content pattern
            const repeatedPattern = report.patterns.find(p => p.type === 'repeated_content');
            expect(repeatedPattern).toBeDefined();
            expect(repeatedPattern?.frequency).toBeGreaterThanOrEqual(5);

            // Should have caching suggestion
            const cachingSuggestion = report.suggestions.find(s => 
                s.title.includes('Caching') || s.category === 'Caching'
            );
            expect(cachingSuggestion).toBeDefined();
        });

        it('should identify prompt length optimization opportunities', async () => {
            // Create usage with long prompts
            const longPrompt = 'A'.repeat(5000); // Very long prompt
            const longPromptUsage = Array.from({ length: 15 }, () => 
                createMockUsage({
                    userId: testUserId,
                    prompt: longPrompt,
                    promptTokens: 1200, // High token count
                    cost: 0.04,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(longPromptUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            // Should have prompt optimization suggestion
            const promptSuggestion = report.suggestions.find(s => 
                s.category === 'Prompt Engineering' || s.title.includes('Prompt Length')
            );
            expect(promptSuggestion).toBeDefined();
            expect(promptSuggestion?.impact.estimatedSavingsPercentage).toBeGreaterThan(0);
        });

        it('should handle users with no usage data', async () => {
            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            expect(report).toBeDefined();
            expect(report.suggestions).toBeDefined();
            expect(report.suggestions.length).toBe(0);
            expect(report.summary.totalPotentialSavings).toBe(0);
            expect(report.patterns.length).toBe(0);
        });

        it('should calculate correct benchmarks', async () => {
            // Create some usage data
            const moderateUsage = Array.from({ length: 5 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.03,
                    totalTokens: 300,
                    responseTime: 2000,
                    errorOccurred: false,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(moderateUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            expect(report.benchmarks).toBeDefined();
            expect(report.benchmarks.userPerformance).toBeDefined();
            expect(report.benchmarks.industryAverage).toBeDefined();
            
            expect(report.benchmarks.userPerformance.costPerToken).toBeGreaterThan(0);
            expect(report.benchmarks.userPerformance.responseTime).toBeGreaterThan(0);
            expect(report.benchmarks.userPerformance.errorRate).toBe(0); // No errors
        });
    });

    describe('getUsageOptimizations', () => {
        it('should get optimization suggestions for specific usage record', async () => {
            const usage = await Usage.create(createMockUsage({
                userId: testUserId,
                cost: 0.12, // High cost
                promptTokens: 1500, // High token count
                createdAt: new Date()
            }));

            const suggestions = await optimizationEngine.getUsageOptimizations(usage._id.toString());

            expect(suggestions).toBeDefined();
            expect(Array.isArray(suggestions)).toBe(true);
            // Should have suggestions for this high-cost, high-token usage
            expect(suggestions.length).toBeGreaterThan(0);
        });

        it('should throw error for non-existent usage record', async () => {
            const nonExistentId = '507f1f77bcf86cd799439011';
            
            await expect(optimizationEngine.getUsageOptimizations(nonExistentId))
                .rejects.toThrow('Usage record 507f1f77bcf86cd799439011 not found');
        });
    });

    describe('monitorOptimizationOpportunities', () => {
        it('should monitor and alert for critical optimization opportunities', async () => {
            // Create high-cost usage for monitoring
            const expensiveUsage = Array.from({ length: 20 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.25, // Very high cost
                    createdAt: new Date() // Within last 24 hours
                })
            );

            await Usage.insertMany(expensiveUsage);

            // Mock the notification service
            const NotificationService = require('../src/services/notification.service').NotificationService;
            const mockSendOptimizationAlert = jest.fn();
            NotificationService.sendOptimizationAlert = mockSendOptimizationAlert;

            await optimizationEngine.monitorOptimizationOpportunities();

            // Should have called the notification service for high-usage users
            expect(mockSendOptimizationAlert).toHaveBeenCalled();
        });
    });

    describe('optimization rules', () => {
        it('should apply high-cost model alternative rule correctly', async () => {
            const costlyUsage = Array.from({ length: 6 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.08, // Above 0.05 threshold
                    model: 'gpt-4',
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(costlyUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            const modelSuggestion = report.suggestions.find(s => 
                s.id.includes('high_cost_model_alt')
            );
            
            expect(modelSuggestion).toBeDefined();
            expect(modelSuggestion?.impact.estimatedSavings).toBeGreaterThan(0);
            expect(modelSuggestion?.impact.affectedRequests).toBe(6);
        });

        it('should apply error rate optimization rule correctly', async () => {
            const errorUsage = Array.from({ length: 20 }, (_, i) => 
                createMockUsage({
                    userId: testUserId,
                    errorOccurred: i < 2, // 10% error rate (above 5% threshold)
                    cost: 0.03,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(errorUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            const errorSuggestion = report.suggestions.find(s => 
                s.id.includes('error_rate_opt')
            );
            
            expect(errorSuggestion).toBeDefined();
            expect(errorSuggestion?.category).toBe('Reliability');
            expect(errorSuggestion?.priority).toBe('high');
        });

        it('should apply batch processing optimization rule correctly', async () => {
            const smallRequests = Array.from({ length: 60 }, () => 
                createMockUsage({
                    userId: testUserId,
                    promptTokens: 80, // Small prompt
                    completionTokens: 150, // Small completion
                    cost: 0.01,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(smallRequests);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            const batchSuggestion = report.suggestions.find(s => 
                s.id.includes('batch_processing')
            );
            
            expect(batchSuggestion).toBeDefined();
            expect(batchSuggestion?.category).toBe('Architecture');
            expect(batchSuggestion?.implementation.effort).toBe('high');
        });
    });

    describe('summary generation', () => {
        it('should calculate correct summary metrics', async () => {
            // Create mixed usage data
            await Usage.insertMany([
                ...Array.from({ length: 3 }, () => createMockUsage({
                    userId: testUserId,
                    cost: 0.15, // High cost - should generate high priority suggestions
                    createdAt: new Date()
                })),
                ...Array.from({ length: 5 }, () => createMockUsage({
                    userId: testUserId,
                    cost: 0.02, // Low cost
                    createdAt: new Date()
                }))
            ]);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            expect(report.summary.totalSuggestions).toBe(report.suggestions.length);
            expect(report.summary.totalPotentialSavings).toBeGreaterThan(0);
            
            const highPriorityCount = report.suggestions.filter(s => 
                s.priority === 'high' || s.priority === 'critical'
            ).length;
            expect(report.summary.highPrioritySuggestions).toBe(highPriorityCount);

            const quickWinsCount = report.suggestions.filter(s => 
                s.implementation.effort === 'low' && 
                (s.priority === 'high' || s.impact.estimatedSavings > 5)
            ).length;
            expect(report.summary.quickWins).toBe(quickWinsCount);
        });
    });

    describe('pattern detection', () => {
        it('should detect inefficient prompts pattern', async () => {
            const inefficientUsage = Array.from({ length: 8 }, () => 
                createMockUsage({
                    userId: testUserId,
                    promptTokens: 2500, // Above 2000 threshold
                    cost: 0.05,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(inefficientUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            const inefficientPattern = report.patterns.find(p => p.type === 'inefficient_prompts');
            expect(inefficientPattern).toBeDefined();
            expect(inefficientPattern?.frequency).toBe(8);
            expect(inefficientPattern?.examples.length).toBeLessThanOrEqual(5);
        });

        it('should detect poor caching pattern', async () => {
            const cachingOpportunityUsage = Array.from({ length: 15 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.03,
                    requestTracking: {
                        payload: {
                            responseSize: 1500, // Above 1000 threshold
                            requestSize: 500,
                            compressionRatio: undefined // No compression
                        }
                    } as any,
                    createdAt: new Date()
                })
            );

            await Usage.insertMany(cachingOpportunityUsage);

            const report = await optimizationEngine.analyzeAndOptimize(testUserId);

            const cachingPattern = report.patterns.find(p => p.type === 'poor_caching');
            expect(cachingPattern).toBeDefined();
            expect(cachingPattern?.frequency).toBe(15);
        });
    });
});