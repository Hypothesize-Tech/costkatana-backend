import { PerformanceMonitoringService } from '../src/services/performance-monitoring.service';
import { Usage } from '../src/models/Usage';
import { connectTestDb, disconnectTestDb } from './helpers/database';
import { createMockUsage, createMockUser } from './helpers/mocks';

// Mock external services
jest.mock('../src/services/logging.service');
jest.mock('../src/services/mixpanel.service');
jest.mock('../src/services/notification.service');

// Mock Redis
const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    keys: jest.fn(),
    del: jest.fn(),
    exists: jest.fn()
};

jest.mock('../src/config/redis', () => ({
    redisClient: mockRedisClient
}));

describe('PerformanceMonitoringService', () => {
    let performanceService: PerformanceMonitoringService;
    let testUserId: string;

    beforeAll(async () => {
        await connectTestDb();
    });

    afterAll(async () => {
        await disconnectTestDb();
    });

    beforeEach(async () => {
        // Clear database
        await Usage.deleteMany({});

        // Clear Redis mocks
        jest.clearAllMocks();
        mockRedisClient.get.mockResolvedValue(null);
        mockRedisClient.set.mockResolvedValue('OK');
        mockRedisClient.setex.mockResolvedValue('OK');
        mockRedisClient.keys.mockResolvedValue([]);
        mockRedisClient.del.mockResolvedValue(1);
        mockRedisClient.exists.mockResolvedValue(0);

        performanceService = PerformanceMonitoringService.getInstance();

        // Create test user
        const testUser = await createMockUser();
        testUserId = testUser._id.toString();
    });

    afterEach(() => {
        // Stop monitoring to clean up intervals
        if (performanceService.isMonitoring()) {
            performanceService.stopRealTimeMonitoring();
        }
    });

    describe('startRealTimeMonitoring', () => {
        it('should start monitoring successfully', async () => {
            expect(performanceService.isMonitoring()).toBe(false);

            await performanceService.startRealTimeMonitoring();

            expect(performanceService.isMonitoring()).toBe(true);
        });

        it('should not start monitoring if already running', async () => {
            await performanceService.startRealTimeMonitoring();
            expect(performanceService.isMonitoring()).toBe(true);

            // Starting again should not create duplicate intervals
            await performanceService.startRealTimeMonitoring();
            expect(performanceService.isMonitoring()).toBe(true);
        });
    });

    describe('stopRealTimeMonitoring', () => {
        it('should stop monitoring successfully', async () => {
            await performanceService.startRealTimeMonitoring();
            expect(performanceService.isMonitoring()).toBe(true);

            performanceService.stopRealTimeMonitoring();
            expect(performanceService.isMonitoring()).toBe(false);
        });
    });

    describe('collectRealTimeMetrics', () => {
        it('should collect metrics from recent usage data', async () => {
            // Create test usage data
            const recentUsage = Array.from({ length: 10 }, (_, i) => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.05 + (i * 0.01), // Varying costs
                    responseTime: 1000 + (i * 200), // Varying response times
                    errorOccurred: i < 2, // 2 errors out of 10
                    createdAt: new Date(Date.now() - i * 60000) // Last 10 minutes
                })
            );

            await Usage.insertMany(recentUsage);

            const metrics = await performanceService.collectRealTimeMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.timestamp).toBeDefined();
            expect(metrics.general.totalRequests).toBe(10);
            expect(metrics.general.errorCount).toBe(2);
            expect(metrics.general.errorRate).toBe(20); // 2/10 * 100
            expect(metrics.performance.avgResponseTime).toBeGreaterThan(0);
            expect(metrics.cost.totalCost).toBeGreaterThan(0);
            expect(metrics.cost.avgCostPerRequest).toBeGreaterThan(0);
        });

        it('should calculate network metrics when available', async () => {
            // Create usage with comprehensive tracking data
            const usageWithTracking = Array.from({ length: 5 }, (_, i) => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.03,
                    responseTime: 1500,
                    requestTracking: {
                        performance: {
                            totalTime: 2000 + (i * 100),
                            networkTime: 800 + (i * 50),
                            serverProcessingTime: 1200 + (i * 50),
                            dnsTime: 50,
                            tcpTime: 100,
                            tlsTime: 150
                        },
                        payload: {
                            requestSize: 200,
                            responseSize: 500 + (i * 50),
                            compressionRatio: 0.3
                        }
                    } as any,
                    createdAt: new Date(Date.now() - i * 60000)
                })
            );

            await Usage.insertMany(usageWithTracking);

            const metrics = await performanceService.collectRealTimeMetrics();

            expect(metrics.network).toBeDefined();
            expect(metrics.network.avgNetworkTime).toBeGreaterThan(0);
            expect(metrics.network.avgServerProcessingTime).toBeGreaterThan(0);
            expect(metrics.network.avgDataTransferRate).toBeGreaterThan(0);
            expect(metrics.optimization).toBeDefined();
            expect(metrics.optimization.avgCompressionRatio).toBe(0.3);
        });

        it('should handle empty usage data', async () => {
            const metrics = await performanceService.collectRealTimeMetrics();

            expect(metrics.general.totalRequests).toBe(0);
            expect(metrics.general.errorCount).toBe(0);
            expect(metrics.general.errorRate).toBe(0);
            expect(metrics.performance.avgResponseTime).toBe(0);
            expect(metrics.cost.totalCost).toBe(0);
        });
    });

    describe('getCurrentMetrics', () => {
        it('should return cached metrics if available', async () => {
            const cachedMetrics = {
                timestamp: Date.now(),
                general: { totalRequests: 5, errorCount: 1, errorRate: 20 },
                performance: { avgResponseTime: 1200, p95ResponseTime: 2000, p99ResponseTime: 3000 },
                cost: { totalCost: 0.25, avgCostPerRequest: 0.05, costPerToken: 0.0001 },
                network: { avgNetworkTime: 800, avgServerProcessingTime: 400, avgDataTransferRate: 150 },
                optimization: { avgCompressionRatio: 0.25, cacheHitRate: 0.8, potentialSavings: 0.05 }
            };

            mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedMetrics));

            const metrics = await performanceService.getCurrentMetrics();

            expect(metrics).toEqual(cachedMetrics);
            expect(mockRedisClient.get).toHaveBeenCalledWith('performance_metrics:current');
        });

        it('should collect fresh metrics if cache is empty', async () => {
            mockRedisClient.get.mockResolvedValue(null);

            // Create some usage data
            await Usage.insertMany([
                createMockUsage({ userId: testUserId, cost: 0.05, responseTime: 1000 }),
                createMockUsage({ userId: testUserId, cost: 0.03, responseTime: 1200 })
            ]);

            const metrics = await performanceService.getCurrentMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.general.totalRequests).toBe(2);
            expect(mockRedisClient.setex).toHaveBeenCalled(); // Should cache the result
        });
    });

    describe('getHistoricalMetrics', () => {
        it('should return historical metrics from cache', async () => {
            const historicalData = [
                { timestamp: Date.now() - 60000, totalRequests: 10, errorRate: 5 },
                { timestamp: Date.now() - 120000, totalRequests: 8, errorRate: 2.5 }
            ];

            mockRedisClient.keys.mockResolvedValue(['performance_historical:1', 'performance_historical:2']);
            mockRedisClient.get
                .mockResolvedValueOnce(JSON.stringify(historicalData[0]))
                .mockResolvedValueOnce(JSON.stringify(historicalData[1]));

            const historical = await performanceService.getHistoricalMetrics(2);

            expect(historical).toHaveLength(2);
            expect(historical[0].totalRequests).toBe(10);
        });

        it('should limit results based on limit parameter', async () => {
            const historicalKeys = Array.from({ length: 20 }, (_, i) => `performance_historical:${i}`);
            mockRedisClient.keys.mockResolvedValue(historicalKeys);
            mockRedisClient.get.mockResolvedValue(JSON.stringify({ timestamp: Date.now(), totalRequests: 5 }));

            const historical = await performanceService.getHistoricalMetrics(5);

            expect(mockRedisClient.get).toHaveBeenCalledTimes(5);
        });
    });

    describe('runAnomalyDetection', () => {
        it('should detect response time anomalies', async () => {
            // Create baseline usage (normal response times)
            const baselineUsage = Array.from({ length: 20 }, () => 
                createMockUsage({
                    userId: testUserId,
                    responseTime: 1000 + Math.random() * 200, // 1000-1200ms
                    cost: 0.03,
                    createdAt: new Date(Date.now() - Math.random() * 3600000) // Last hour
                })
            );

            // Create anomalous usage (very slow response times)
            const anomalousUsage = Array.from({ length: 3 }, () => 
                createMockUsage({
                    userId: testUserId,
                    responseTime: 5000 + Math.random() * 1000, // 5000-6000ms (anomaly)
                    cost: 0.03,
                    createdAt: new Date(Date.now() - Math.random() * 300000) // Last 5 minutes
                })
            );

            await Usage.insertMany([...baselineUsage, ...anomalousUsage]);

            const anomalies = await performanceService.runAnomalyDetection();

            expect(anomalies).toBeDefined();
            expect(anomalies.length).toBeGreaterThan(0);
            
            const responseTimeAnomaly = anomalies.find(a => a.type === 'response_time_spike');
            expect(responseTimeAnomaly).toBeDefined();
            expect(responseTimeAnomaly?.severity).toBe('high');
        });

        it('should detect error rate anomalies', async () => {
            // Create mostly successful requests
            const successfulUsage = Array.from({ length: 50 }, () => 
                createMockUsage({
                    userId: testUserId,
                    errorOccurred: false,
                    cost: 0.02,
                    createdAt: new Date(Date.now() - Math.random() * 3600000)
                })
            );

            // Create recent error spike
            const errorUsage = Array.from({ length: 15 }, () => 
                createMockUsage({
                    userId: testUserId,
                    errorOccurred: true,
                    errorType: 'server_error',
                    cost: 0,
                    createdAt: new Date(Date.now() - Math.random() * 300000) // Last 5 minutes
                })
            );

            await Usage.insertMany([...successfulUsage, ...errorUsage]);

            const anomalies = await performanceService.runAnomalyDetection();

            const errorAnomaly = anomalies.find(a => a.type === 'error_rate_spike');
            expect(errorAnomaly).toBeDefined();
            expect(errorAnomaly?.severity).toBe('critical');
        });

        it('should detect cost anomalies', async () => {
            // Create normal cost usage
            const normalUsage = Array.from({ length: 30 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.02 + Math.random() * 0.01, // $0.02-$0.03
                    createdAt: new Date(Date.now() - Math.random() * 3600000)
                })
            );

            // Create high-cost usage (anomaly)
            const expensiveUsage = Array.from({ length: 5 }, () => 
                createMockUsage({
                    userId: testUserId,
                    cost: 0.5 + Math.random() * 0.2, // $0.50-$0.70 (much higher)
                    createdAt: new Date(Date.now() - Math.random() * 300000)
                })
            );

            await Usage.insertMany([...normalUsage, ...expensiveUsage]);

            const anomalies = await performanceService.runAnomalyDetection();

            const costAnomaly = anomalies.find(a => a.type === 'cost_spike');
            expect(costAnomaly).toBeDefined();
        });
    });

    describe('processAlerts', () => {
        it('should generate alerts for critical anomalies', async () => {
            const criticalAnomalies = [
                {
                    type: 'error_rate_spike',
                    severity: 'critical' as const,
                    description: 'Error rate spiked to 25%',
                    value: 25,
                    threshold: 5,
                    timestamp: new Date()
                }
            ];

            const NotificationService = require('../src/services/notification.service').NotificationService;
            const mockSendPerformanceAlert = jest.fn();
            NotificationService.sendPerformanceAlert = mockSendPerformanceAlert;

            await performanceService.processAlerts(criticalAnomalies);

            expect(mockSendPerformanceAlert).toHaveBeenCalledWith({
                title: 'Critical Performance Alert: Error Rate Spike',
                message: 'Error rate spiked to 25%',
                severity: 'critical',
                metrics: { errorRate: 25, threshold: 5 },
                timestamp: expect.any(Date)
            });
        });

        it('should not generate alerts for low severity anomalies', async () => {
            const lowSeverityAnomalies = [
                {
                    type: 'minor_delay',
                    severity: 'low' as const,
                    description: 'Minor response time increase',
                    value: 1100,
                    threshold: 1000,
                    timestamp: new Date()
                }
            ];

            const NotificationService = require('../src/services/notification.service').NotificationService;
            const mockSendPerformanceAlert = jest.fn();
            NotificationService.sendPerformanceAlert = mockSendPerformanceAlert;

            await performanceService.processAlerts(lowSeverityAnomalies);

            expect(mockSendPerformanceAlert).not.toHaveBeenCalled();
        });

        it('should cache recent alerts to prevent spam', async () => {
            const criticalAnomaly = {
                type: 'error_rate_spike',
                severity: 'critical' as const,
                description: 'Error rate spiked',
                value: 30,
                threshold: 5,
                timestamp: new Date()
            };

            const NotificationService = require('../src/services/notification.service').NotificationService;
            const mockSendPerformanceAlert = jest.fn();
            NotificationService.sendPerformanceAlert = mockSendPerformanceAlert;

            // First alert should be sent
            await performanceService.processAlerts([criticalAnomaly]);
            expect(mockSendPerformanceAlert).toHaveBeenCalledTimes(1);

            // Mock that the alert was cached
            mockRedisClient.exists.mockResolvedValue(1);

            // Second identical alert should be skipped
            await performanceService.processAlerts([criticalAnomaly]);
            expect(mockSendPerformanceAlert).toHaveBeenCalledTimes(1);
        });
    });

    describe('getRecentAlerts', () => {
        it('should return recent alerts from cache', async () => {
            const mockAlerts = [
                { type: 'error_rate_spike', severity: 'high', timestamp: Date.now() - 60000 },
                { type: 'cost_spike', severity: 'medium', timestamp: Date.now() - 120000 }
            ];

            mockRedisClient.keys.mockResolvedValue(['performance_alert:1', 'performance_alert:2']);
            mockRedisClient.get
                .mockResolvedValueOnce(JSON.stringify(mockAlerts[0]))
                .mockResolvedValueOnce(JSON.stringify(mockAlerts[1]));

            const alerts = await performanceService.getRecentAlerts(10);

            expect(alerts).toHaveLength(2);
            expect(alerts[0].type).toBe('error_rate_spike');
        });

        it('should limit results and sort by timestamp', async () => {
            const mockAlerts = Array.from({ length: 20 }, (_, i) => ({
                type: 'test_alert',
                severity: 'low',
                timestamp: Date.now() - (i * 60000)
            }));

            mockRedisClient.keys.mockResolvedValue(mockAlerts.map((_, i) => `performance_alert:${i}`));
            mockRedisClient.get.mockImplementation((key) => {
                const index = parseInt(key.split(':')[1]);
                return Promise.resolve(JSON.stringify(mockAlerts[index]));
            });

            const alerts = await performanceService.getRecentAlerts(5);

            expect(alerts).toHaveLength(5);
            // Should be sorted by timestamp (newest first)
            expect(alerts[0].timestamp).toBeGreaterThan(alerts[1].timestamp);
        });
    });

    describe('error handling', () => {
        it('should handle Redis connection errors gracefully', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));

            // Should not throw error, but return fresh metrics
            const metrics = await performanceService.getCurrentMetrics();
            expect(metrics).toBeDefined();
        });

        it('should handle database query errors gracefully', async () => {
            // Mock database error
            const originalFind = Usage.find;
            Usage.find = jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    limit: jest.fn().mockRejectedValue(new Error('Database error'))
                })
            });

            const metrics = await performanceService.collectRealTimeMetrics();

            // Should return default metrics structure
            expect(metrics.general.totalRequests).toBe(0);
            expect(metrics.general.errorCount).toBe(0);

            // Restore original method
            Usage.find = originalFind;
        });
    });
});