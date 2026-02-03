import { ComprehensiveTrackingService } from '../src/services/comprehensive-tracking.service';
import { Usage } from '../src/models/Usage';
import { Telemetry } from '../src/models/Telemetry';
import { connectTestDb, disconnectTestDb } from './helpers/database';
import { createMockUsage, createMockUser } from './helpers/mocks';

// Mock external services
jest.mock('../src/services/logging.service');
jest.mock('../src/services/mixpanel.service');
jest.mock('../src/services/telemetry.service');

describe('ComprehensiveTrackingService', () => {
    let trackingService: ComprehensiveTrackingService;
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
        await Telemetry.deleteMany({});

        trackingService = ComprehensiveTrackingService.getInstance();

        // Create test user
        const testUser = await createMockUser();
        testUserId = testUser._id.toString();
    });

    describe('processComprehensiveTracking', () => {
        it('should process client-side and server-side tracking data', async () => {
            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: {
                    userAgent: 'Mozilla/5.0 (Test Browser)',
                    platform: 'darwin',
                    hostname: 'test.local',
                    sdkVersion: '2.0.0'
                },
                network: {
                    endpoint: 'https://api.openai.com/v1/chat/completions',
                    method: 'POST',
                    protocol: 'https:',
                    port: 443
                },
                request: {
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer sk-***'
                    },
                    body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }),
                    size: 150
                },
                response: {
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ choices: [{ message: { content: 'Hello there!' } }] }),
                    size: 200
                },
                performance: {
                    totalTime: 1500,
                    dnsTime: 50,
                    tcpTime: 100,
                    tlsTime: 200,
                    requestTime: 1150
                },
                timestamp: new Date()
            };

            const serverData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                serverInfo: {
                    hostname: 'server.costkatana.com',
                    ip: '10.0.0.1',
                    port: 8080
                },
                clientInfo: {
                    ip: '192.168.1.100',
                    userAgent: 'Mozilla/5.0 (Test Browser)'
                },
                request: {
                    headers: {
                        'host': 'api.costkatana.com',
                        'user-agent': 'Mozilla/5.0 (Test Browser)'
                    },
                    body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }),
                    size: 150
                },
                response: {
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ choices: [{ message: { content: 'Hello there!' } }] }),
                    size: 200,
                    statusCode: 200
                },
                performance: {
                    totalTime: 1500,
                    processingTime: 1300,
                    cpuUsage: 45.6,
                    memoryUsage: 78.2
                },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                clientData,
                serverData
            );

            expect(result.usageId).toBeDefined();
            expect(result.telemetrySpanId).toBeDefined();

            // Verify usage record was created with comprehensive data
            const usage = await Usage.findById(result.usageId);
            expect(usage).toBeDefined();
            expect(usage?.requestTracking).toBeDefined();
            expect(usage?.requestTracking?.clientInfo.userAgent).toBe('Mozilla/5.0 (Test Browser)');
            expect(usage?.requestTracking?.networking.endpoint).toBe('https://api.openai.com/v1/chat/completions');
            expect(usage?.requestTracking?.performance.totalTime).toBe(1500);
            expect(usage?.optimizationOpportunities).toBeDefined();

            // Verify telemetry span was created
            const telemetry = await Telemetry.findById(result.telemetrySpanId);
            expect(telemetry).toBeDefined();
            expect(telemetry?.networkingMetadata).toBeDefined();
        });

        it('should handle missing server data gracefully', async () => {
            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: {
                    userAgent: 'Test Agent',
                    platform: 'linux'
                },
                network: {
                    endpoint: 'https://api.anthropic.com/v1/messages',
                    method: 'POST'
                },
                request: {
                    headers: {},
                    body: '{"model": "claude-3"}',
                    size: 100
                },
                response: {
                    headers: {},
                    body: '{"content": "response"}',
                    size: 150
                },
                performance: {
                    totalTime: 2000
                },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                clientData,
                undefined
            );

            expect(result.usageId).toBeDefined();
            expect(result.telemetrySpanId).toBeDefined();

            const usage = await Usage.findById(result.usageId);
            expect(usage?.requestTracking).toBeDefined();
            expect(usage?.requestTracking?.clientInfo.userAgent).toBe('Test Agent');
        });

        it('should sanitize sensitive data in headers and body', async () => {
            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: {
                    userAgent: 'Test Agent'
                },
                network: {
                    endpoint: 'https://api.openai.com/v1/completions',
                    method: 'POST'
                },
                request: {
                    headers: {
                        'authorization': 'Bearer sk-real-secret-key-123',
                        'x-api-key': 'secret-api-key-456',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'Hello' }],
                        api_key: 'another-secret-key'
                    }),
                    size: 200
                },
                response: {
                    headers: {},
                    body: '{"content": "response"}',
                    size: 100
                },
                performance: {
                    totalTime: 1000
                },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                clientData
            );

            const usage = await Usage.findById(result.usageId);
            
            // Check that sensitive headers are sanitized
            expect(usage?.requestTracking?.headers.request['authorization']).toBe('[REDACTED]');
            expect(usage?.requestTracking?.headers.request['x-api-key']).toBe('[REDACTED]');
            expect(usage?.requestTracking?.headers.request['content-type']).toBe('application/json'); // Not sensitive

            // Check that sensitive body content is sanitized
            const sanitizedBody = JSON.parse(usage?.requestTracking?.payload.requestBody || '{}');
            expect(sanitizedBody.api_key).toBe('[REDACTED]');
            expect(sanitizedBody.model).toBe('gpt-4'); // Not sensitive
            expect(sanitizedBody.messages).toBeDefined(); // Not sensitive
        });

        it('should generate optimization opportunities based on data', async () => {
            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: {
                    userAgent: 'Test Agent'
                },
                network: {
                    endpoint: 'https://api.openai.com/v1/completions',
                    method: 'POST'
                },
                request: {
                    headers: {},
                    body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'A'.repeat(5000) }] }), // Large request
                    size: 5200 // Large size
                },
                response: {
                    headers: {},
                    body: JSON.stringify({ choices: [{ text: 'B'.repeat(3000) }] }), // Large response
                    size: 3200
                },
                performance: {
                    totalTime: 8000, // Slow response
                    dnsTime: 100,
                    tcpTime: 200
                },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                clientData
            );

            const usage = await Usage.findById(result.usageId);
            const opportunities = usage?.optimizationOpportunities;

            expect(opportunities).toBeDefined();
            
            // Should identify performance optimization (slow response)
            expect(opportunities?.performanceOptimization.bottleneckType).toBe('high_latency');
            expect(opportunities?.performanceOptimization.suggestions).toContain('Consider using a faster model or optimizing prompt length');

            // Should identify data efficiency opportunities (large payloads)
            expect(opportunities?.dataEfficiency.compressionOpportunity).toBeGreaterThan(0);
            expect(opportunities?.dataEfficiency.suggestions).toContain('Enable request/response compression');
        });
    });

    describe('processServerSideTracking', () => {
        it('should process server-side only tracking data', async () => {
            const serverData = {
                sessionId: 'server-session-123',
                requestId: 'server-request-456',
                serverInfo: {
                    hostname: 'api.costkatana.com',
                    ip: '10.0.0.2',
                    port: 8080
                },
                clientInfo: {
                    ip: '192.168.1.50',
                    userAgent: 'Cost Katana SDK v2.0'
                },
                request: {
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ service: 'openai', model: 'gpt-3.5-turbo' }),
                    size: 120
                },
                response: {
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ usage: { total_tokens: 150 }, cost: 0.003 }),
                    size: 180,
                    statusCode: 200
                },
                performance: {
                    totalTime: 1200,
                    processingTime: 1000,
                    cpuUsage: 30.5,
                    memoryUsage: 65.8
                },
                timestamp: new Date()
            };

            const result = await trackingService.processServerSideTracking(
                testUserId,
                serverData
            );

            expect(result.usageId).toBeDefined();
            expect(result.telemetrySpanId).toBeDefined();

            const usage = await Usage.findById(result.usageId);
            expect(usage).toBeDefined();
            expect(usage?.requestTracking?.clientInfo.userAgent).toBe('Cost Katana SDK v2.0');
            expect(usage?.requestTracking?.performance.serverProcessingTime).toBe(1000);
        });
    });

    describe('data analysis and insights', () => {
        it('should calculate compression ratio correctly', async () => {
            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: { userAgent: 'Test' },
                network: { endpoint: 'https://api.test.com', method: 'POST' },
                request: {
                    headers: { 'content-encoding': 'gzip' },
                    body: 'compressed content',
                    size: 100 // Compressed size
                },
                response: {
                    headers: {},
                    body: 'A'.repeat(1000), // Large uncompressed content
                    size: 1000
                },
                performance: { totalTime: 1000 },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                clientData
            );

            const usage = await Usage.findById(result.usageId);
            
            // Should calculate compression ratio based on content vs size difference
            expect(usage?.requestTracking?.payload.compressionRatio).toBeDefined();
            expect(usage?.requestTracking?.payload.compressionRatio).toBeGreaterThan(0);
        });

        it('should identify bottlenecks correctly', async () => {
            const slowNetworkData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: { userAgent: 'Test' },
                network: { endpoint: 'https://api.test.com', method: 'POST' },
                request: { headers: {}, body: 'test', size: 50 },
                response: { headers: {}, body: 'response', size: 80 },
                performance: {
                    totalTime: 5000, // Total 5s
                    dnsTime: 2000, // DNS is the bottleneck
                    tcpTime: 500,
                    tlsTime: 500,
                    requestTime: 2000
                },
                timestamp: new Date()
            };

            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                slowNetworkData
            );

            const usage = await Usage.findById(result.usageId);
            const opportunities = usage?.optimizationOpportunities;

            expect(opportunities?.performanceOptimization.bottleneckType).toBe('dns_slow');
            expect(opportunities?.performanceOptimization.suggestions).toContain('Consider using a DNS cache or alternative DNS resolver');
        });
    });

    describe('error handling', () => {
        it('should handle invalid data gracefully', async () => {
            const invalidClientData = {
                // Missing required fields
                sessionId: 'test-session-123'
                // No requestId, environment, etc.
            } as any;

            // Should not throw error, but should handle gracefully
            const result = await trackingService.processComprehensiveTracking(
                testUserId,
                invalidClientData
            );

            expect(result.usageId).toBeDefined();
            
            const usage = await Usage.findById(result.usageId);
            expect(usage).toBeDefined();
            // Should have minimal tracking data
            expect(usage?.requestTracking).toBeDefined();
        });

        it('should handle database errors gracefully', async () => {
            // Mock a database error
            const originalCreate = Usage.create;
            Usage.create = jest.fn().mockRejectedValue(new Error('Database error'));

            const clientData = {
                sessionId: 'test-session-123',
                requestId: 'test-request-456',
                environment: { userAgent: 'Test' },
                network: { endpoint: 'https://api.test.com', method: 'POST' },
                request: { headers: {}, body: 'test', size: 50 },
                response: { headers: {}, body: 'response', size: 80 },
                performance: { totalTime: 1000 },
                timestamp: new Date()
            };

            await expect(trackingService.processComprehensiveTracking(testUserId, clientData))
                .rejects.toThrow('Database error');

            // Restore original method
            Usage.create = originalCreate;
        });
    });
});