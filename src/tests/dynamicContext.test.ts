/**
 * Dynamic Context Discovery Tests
 * Unit tests for the dynamic context discovery system
 */

import { toolRegistryService } from '../services/toolRegistry.service';
import { contextFileManager } from '../services/contextFileManager.service';
import { mcpToolSyncerService } from '../services/mcpToolSyncer.service';
import { dynamicContextMetrics } from '../services/dynamicContextMetrics.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Dynamic Context Discovery System', () => {
    const testDir = path.join(os.tmpdir(), 'costkatana-test');
    
    beforeAll(async () => {
        // Setup test directories
        process.env.COSTKATANA_TOOLS_DIR = path.join(testDir, 'tools');
        process.env.COSTKATANA_CONTEXT_DIR = path.join(testDir, 'context');
        process.env.COSTKATANA_ENABLE_FILE_CONTEXT = 'true';
        
        await fs.mkdir(testDir, { recursive: true });
        await toolRegistryService.initialize();
        await contextFileManager.initialize();
    });
    
    afterAll(async () => {
        // Cleanup test directories
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            console.warn('Failed to cleanup test directory:', error);
        }
    });
    
    describe('Tool Registry Service', () => {
        it('should initialize tool registry directories', async () => {
            const toolsDir = toolRegistryService.getToolsDirectory();
            const exists = await fs.access(toolsDir).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });
        
        it('should register and retrieve a tool', async () => {
            const testTool = {
                name: 'test_tool',
                description: 'A test tool',
                category: 'test',
                inputSchema: { type: 'object', properties: {} },
                status: 'active' as const,
                metadata: { version: '1.0.0' }
            };
            
            await toolRegistryService.registerTool(testTool);
            const retrieved = await toolRegistryService.getTool('test_tool', 'test');
            
            expect(retrieved).toBeDefined();
            expect(retrieved?.name).toBe('test_tool');
            expect(retrieved?.description).toBe('A test tool');
        });
        
        it('should list tools in a category', async () => {
            const tools = await toolRegistryService.listTools('test');
            expect(tools.length).toBeGreaterThan(0);
            expect(tools.some(t => t.name === 'test_tool')).toBe(true);
        });
        
        it('should update tool status', async () => {
            await toolRegistryService.updateToolStatus('test_tool', 'needs_auth', 'Authentication required');
            const tool = await toolRegistryService.getTool('test_tool', 'test');
            
            expect(tool?.status).toBe('needs_auth');
            expect(tool?.statusMessage).toBe('Authentication required');
        });
        
        it('should get tool statistics', async () => {
            const stats = await toolRegistryService.getStatistics();
            
            expect(stats.totalTools).toBeGreaterThan(0);
            expect(stats.toolsByCategory).toBeDefined();
            expect(stats.cacheSize).toBeGreaterThanOrEqual(0);
        });
    });
    
    describe('Context File Manager', () => {
        it('should write and read large responses', async () => {
            const largeResponse = {
                data: Array(1000).fill({ id: 1, value: 'test data' })
            };
            
            const fileRef = await contextFileManager.writeResponse(largeResponse, {
                userId: 'test-user',
                requestId: 'test-request-1',
                toolName: 'test_tool'
            });
            
            expect(fileRef.type).toBe('file_reference');
            expect(fileRef.size).toBeGreaterThan(0);
            expect(fileRef.summary).toBeDefined();
            
            // Verify file exists
            const content = await contextFileManager.readFile(fileRef.path);
            expect(content).toBeDefined();
            expect(JSON.parse(content)).toEqual(largeResponse);
        });
        
        it('should determine if response should be written to file', () => {
            const smallResponse = { data: 'small' };
            const largeResponse = { data: 'x'.repeat(20000) };
            
            expect(contextFileManager.shouldWriteToFile(smallResponse)).toBe(false);
            expect(contextFileManager.shouldWriteToFile(largeResponse)).toBe(true);
        });
        
        it('should export conversation history', async () => {
            const messages = [
                {
                    role: 'user',
                    content: 'Hello',
                    timestamp: new Date()
                },
                {
                    role: 'assistant',
                    content: 'Hi there!',
                    timestamp: new Date()
                }
            ];
            
            const historyFile = await contextFileManager.exportConversationHistory(
                'test-conv-1',
                'test-user',
                messages,
                'markdown'
            );
            
            expect(historyFile.conversationId).toBe('test-conv-1');
            expect(historyFile.messageCount).toBe(2);
            expect(historyFile.format).toBe('markdown');
            
            const content = await contextFileManager.readFile(historyFile.filePath);
            expect(content).toContain('Hello');
            expect(content).toContain('Hi there!');
        });
        
        it('should search in files', async () => {
            const testData = "Line 1: test\nLine 2: important\nLine 3: test again";
            const fileRef = await contextFileManager.writeResponse({ text: testData }, {
                userId: 'test-user',
                requestId: 'test-search',
                toolName: 'test_tool'
            });
            
            const results = await contextFileManager.searchInFile(fileRef.path, 'test');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(line => line.includes('test'))).toBe(true);
        });
        
        it('should get file tail and head', async () => {
            const lines = Array(100).fill(0).map((_, i) => `Line ${i + 1}`).join('\n');
            const fileRef = await contextFileManager.writeResponse({ text: lines }, {
                userId: 'test-user',
                requestId: 'test-tail-head',
                toolName: 'test_tool'
            });
            
            const tail = await contextFileManager.getFileTail(fileRef.path, 10);
            const head = await contextFileManager.getFileHead(fileRef.path, 10);
            
            expect(tail).toContain('Line 100');
            expect(head).toContain('Line 1');
        });
        
        it('should get context file statistics', async () => {
            const stats = await contextFileManager.getStatistics();
            
            expect(stats).toBeDefined();
            expect(stats.totalFiles).toBeGreaterThanOrEqual(0);
            expect(stats.totalSize).toBeGreaterThanOrEqual(0);
        });
    });
    
    describe('MCP Tool Syncer', () => {
        it('should sync core tools', async () => {
            const result = await mcpToolSyncerService.syncCoreTools();
            
            expect(result.success).toBe(true);
            expect(result.toolsWritten).toBeGreaterThan(0);
            expect(result.errors.length).toBe(0);
        });
        
        it('should sync MongoDB tools', async () => {
            const mockTools = [
                {
                    name: 'find',
                    description: 'Find documents',
                    inputSchema: { type: 'object' }
                }
            ];
            
            const result = await mcpToolSyncerService.syncMongoDBTools(mockTools as any);
            
            expect(result.success).toBe(true);
            expect(result.toolsWritten).toBe(1);
        });
    });
    
    describe('Dynamic Context Metrics', () => {
        it('should record and retrieve metrics', () => {
            const metrics = dynamicContextMetrics.compareContextStrategies({
                requestId: 'test-req-1',
                userId: 'test-user',
                staticPromptLength: 10000,
                dynamicPromptLength: 4000,
                toolsLoaded: 15,
                toolsUsed: 3,
                filesWritten: 1,
                filesRead: 0,
                largeResponsesHandled: 1,
                historyExportsCreated: 0
            });
            
            expect(metrics.tokenReduction).toBe(6000);
            expect(metrics.tokenReductionPercentage).toBe(60);
            expect(metrics.estimatedCostSavings).toBeGreaterThan(0);
        });
        
        it('should generate aggregated metrics', () => {
            const aggregated = dynamicContextMetrics.getAggregatedMetrics();
            
            expect(aggregated.totalRequests).toBeGreaterThan(0);
            expect(aggregated.totalTokensReduced).toBeGreaterThan(0);
            expect(aggregated.averageTokenReductionPercentage).toBeGreaterThan(0);
        });
        
        it('should generate performance report', () => {
            const report = dynamicContextMetrics.generateReport(7);
            
            expect(report).toContain('Dynamic Context Discovery Performance Report');
            expect(report).toContain('Total Requests');
            expect(report).toContain('Total Tokens Reduced');
            expect(report).toContain('Total Cost Savings');
        });
        
        it('should export metrics to JSON', () => {
            const exported = dynamicContextMetrics.exportMetrics();
            const parsed = JSON.parse(exported);
            
            expect(parsed.totalMetrics).toBeGreaterThan(0);
            expect(parsed.metrics).toBeDefined();
            expect(parsed.aggregated).toBeDefined();
        });
    });
    
    describe('Integration Tests', () => {
        it('should demonstrate full workflow', async () => {
            // 1. Register tools
            await mcpToolSyncerService.syncCoreTools();
            
            // 2. Write large response
            const largeData = { items: Array(500).fill({ data: 'test' }) };
            const fileRef = await contextFileManager.writeResponse(largeData, {
                userId: 'integration-test',
                requestId: 'integration-1',
                toolName: 'analytics_manager'
            });
            
            // 3. Export conversation history
            const messages = [
                { role: 'user', content: 'Test message', timestamp: new Date() }
            ];
            const historyFile = await contextFileManager.exportConversationHistory(
                'integration-conv',
                'integration-test',
                messages,
                'markdown'
            );
            
            // 4. Record metrics
            const metrics = dynamicContextMetrics.compareContextStrategies({
                requestId: 'integration-1',
                userId: 'integration-test',
                staticPromptLength: 15000,
                dynamicPromptLength: 5000,
                toolsLoaded: 10,
                toolsUsed: 2,
                filesWritten: 2,
                filesRead: 1,
                largeResponsesHandled: 1,
                historyExportsCreated: 1
            });
            
            // Verify complete workflow
            expect(fileRef).toBeDefined();
            expect(historyFile).toBeDefined();
            expect(metrics.tokenReductionPercentage).toBeGreaterThan(50);
            
            // Generate report
            const report = dynamicContextMetrics.generateReport(1);
            expect(report).toContain('integration-test');
        });
    });
});
