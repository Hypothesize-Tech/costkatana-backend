/**
 * Cortex Hybrid Execution Engine
 * 
 * Executes parts of Cortex queries using deterministic code, tools, and API calls
 * rather than expensive LLM processing. Combines LLM reasoning with programmatic
 * execution for optimal performance and cost efficiency.
 */

import { CortexFrame, CortexValue } from '../types/cortex.types';
import { loggingService } from './logging.service';
import axios, { AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// HYBRID EXECUTION TYPES
// ============================================================================

export interface HybridExecutionResult {
    success: boolean;
    result: CortexValue | CortexFrame;
    executionType: 'deterministic' | 'llm' | 'hybrid';
    executedTools: string[];
    apiCalls: number;
    deterministic: boolean;
    metadata: {
        executionTime: number;
        costSaved: number;
        toolsUsed: HybridToolExecution[];
        errors: string[];
        warnings: string[];
    };
}

export interface HybridToolExecution {
    toolName: string;
    input: any;
    output: any;
    executionTime: number;
    success: boolean;
    error?: string;
}

export interface HybridExecutableFrame {
    frameType: 'executable';
    executionMode: 'tool' | 'api' | 'math' | 'data' | 'logic' | 'database' | 'file';
    toolName?: string;
    apiEndpoint?: string;
    operation?: string;
    parameters?: Record<string, CortexValue>;
    condition?: string;
    code?: string;
}

export interface CortexTool {
    name: string;
    description: string;
    category: 'math' | 'string' | 'date' | 'crypto' | 'data' | 'api' | 'file' | 'logic';
    parameters: {
        [key: string]: {
            type: 'string' | 'number' | 'boolean' | 'array' | 'object';
            required: boolean;
            description: string;
            validation?: (value: any) => boolean;
        };
    };
    execute: (params: Record<string, any>) => Promise<any> | any;
    deterministic: boolean;
    costSavings: number; // Estimated cost savings vs LLM (in tokens)
}

export interface ApiExecutionConfig {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    timeout: number;
    retries: number;
    cacheable: boolean;
    authentication?: {
        type: 'bearer' | 'basic' | 'apikey';
        credentials: Record<string, string>;
    };
}

// ============================================================================
// CORTEX HYBRID EXECUTION ENGINE
// ============================================================================

export class CortexHybridExecutionEngine {
    private static instance: CortexHybridExecutionEngine;
    private tools: Map<string, CortexTool> = new Map();
    private apiCache: Map<string, { data: any; expires: Date }> = new Map();

    private constructor() {
        this.initializeBuiltInTools();
    }

    public static getInstance(): CortexHybridExecutionEngine {
        if (!CortexHybridExecutionEngine.instance) {
            CortexHybridExecutionEngine.instance = new CortexHybridExecutionEngine();
        }
        return CortexHybridExecutionEngine.instance;
    }

    /**
     * Execute a Cortex frame using hybrid approach (deterministic + LLM)
     */
    public async executeHybrid(frame: CortexFrame): Promise<HybridExecutionResult> {
        const startTime = Date.now();
        const executedTools: string[] = [];
        const toolExecutions: HybridToolExecution[] = [];
        let apiCalls = 0;
        let costSaved = 0;

        try {
            // Analyze frame for executable components
            const executableComponents = this.analyzeForExecution(frame);
            
            if (executableComponents.length === 0) {
                // No deterministic execution possible, return for LLM processing
                return {
                    success: true,
                    result: frame,
                    executionType: 'llm',
                    executedTools: [],
                    apiCalls: 0,
                    deterministic: false,
                    metadata: {
                        executionTime: Date.now() - startTime,
                        costSaved: 0,
                        toolsUsed: [],
                        errors: [],
                        warnings: ['No deterministic execution possible']
                    }
                };
            }

            // Execute deterministic components
            let result: CortexValue | CortexFrame = frame;
            let allDeterministic = true;

            for (const component of executableComponents) {
                const toolExecution = await this.executeComponent(component);
                
                toolExecutions.push(toolExecution);
                executedTools.push(toolExecution.toolName);
                costSaved += this.tools.get(toolExecution.toolName)?.costSavings || 0;

                if (!toolExecution.success) {
                    allDeterministic = false;
                }

                // Update result based on execution
                if (toolExecution.success) {
                    result = this.updateFrameWithResult(frame, component, toolExecution.output);
                }
            }

            // Count API calls
            apiCalls = toolExecutions.filter(t => 
                this.tools.get(t.toolName)?.category === 'api'
            ).length;

            loggingService.info('⚡ Hybrid execution completed', {
                executedTools: executedTools.length,
                apiCalls,
                costSaved,
                deterministic: allDeterministic,
                executionTime: Date.now() - startTime
            });

            return {
                success: true,
                result,
                executionType: allDeterministic ? 'deterministic' : 'hybrid',
                executedTools,
                apiCalls,
                deterministic: allDeterministic,
                metadata: {
                    executionTime: Date.now() - startTime,
                    costSaved,
                    toolsUsed: toolExecutions,
                    errors: toolExecutions.filter(t => !t.success).map(t => t.error || 'Unknown error'),
                    warnings: []
                }
            };

        } catch (error) {
            loggingService.error('❌ Hybrid execution failed', {
                error: error instanceof Error ? error.message : String(error),
                frameType: frame.frameType
            });

            return {
                success: false,
                result: frame,
                executionType: 'llm',
                executedTools,
                apiCalls,
                deterministic: false,
                metadata: {
                    executionTime: Date.now() - startTime,
                    costSaved: 0,
                    toolsUsed: toolExecutions,
                    errors: [error instanceof Error ? error.message : String(error)],
                    warnings: []
                }
            };
        }
    }

    /**
     * Register a custom tool for hybrid execution
     */
    public registerTool(tool: CortexTool): void {
        this.tools.set(tool.name, tool);
        loggingService.info('🔧 Registered hybrid execution tool', {
            toolName: tool.name,
            category: tool.category,
            deterministic: tool.deterministic
        });
    }

    /**
     * Get available tools
     */
    public getAvailableTools(): CortexTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Execute API call with caching and error handling
     */
    public async executeApiCall(
        endpoint: string,
        config: ApiExecutionConfig,
        parameters: Record<string, any> = {}
    ): Promise<any> {
        const cacheKey = this.generateCacheKey(endpoint, config, parameters);
        
        // Check cache first
        if (config.cacheable && this.apiCache.has(cacheKey)) {
            const cached = this.apiCache.get(cacheKey)!;
            if (cached.expires > new Date()) {
                loggingService.debug('📊 API cache hit', { endpoint });
                return cached.data;
            }
        }

        let lastError: Error | null = null;
        
        // Retry logic
        for (let attempt = 0; attempt <= config.retries; attempt++) {
            try {
                const axiosConfig: any = {
                    method: config.method,
                    url: endpoint,
                    timeout: config.timeout,
                    headers: config.headers || {}
                };

                // Add authentication
                if (config.authentication) {
                    switch (config.authentication.type) {
                        case 'bearer':
                            axiosConfig.headers.Authorization = `Bearer ${config.authentication.credentials.token}`;
                            break;
                        case 'basic':
                            const auth = Buffer.from(
                                `${config.authentication.credentials.username}:${config.authentication.credentials.password}`
                            ).toString('base64');
                            axiosConfig.headers.Authorization = `Basic ${auth}`;
                            break;
                        case 'apikey':
                            axiosConfig.headers[config.authentication.credentials.header || 'X-API-Key'] = 
                                config.authentication.credentials.key;
                            break;
                    }
                }

                // Add parameters
                if (config.method === 'GET') {
                    axiosConfig.params = parameters;
                } else {
                    axiosConfig.data = parameters;
                }

                const response: AxiosResponse = await axios(axiosConfig);
                
                // Cache successful response
                if (config.cacheable) {
                    this.apiCache.set(cacheKey, {
                        data: response.data,
                        expires: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
                    });
                }

                loggingService.info('🌐 API call successful', {
                    endpoint,
                    method: config.method,
                    status: response.status,
                    cached: false
                });

                return response.data;

            } catch (error) {
                lastError = error as Error;
                loggingService.warn(`⚠️ API call failed (attempt ${attempt + 1}/${config.retries + 1})`, {
                    endpoint,
                    error: error instanceof Error ? error.message : String(error)
                });

                if (attempt < config.retries) {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }

        throw lastError || new Error('API call failed after all retries');
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private analyzeForExecution(frame: CortexFrame): Array<{
        component: string;
        toolName: string;
        parameters: Record<string, any>;
    }> {
        const executableComponents = [];

        // Analyze frame content for deterministic operations
        for (const [key, value] of Object.entries(frame)) {
            if (key === 'frameType') continue;

            // Mathematical operations
            if (this.isMathOperation(key, value)) {
                executableComponents.push({
                    component: key,
                    toolName: 'math_calculator',
                    parameters: { expression: value }
                });
            }

            // String operations
            if (this.isStringOperation(key, value)) {
                executableComponents.push({
                    component: key,
                    toolName: 'string_processor',
                    parameters: { operation: key, input: value }
                });
            }

            // Date operations
            if (this.isDateOperation(key, value)) {
                executableComponents.push({
                    component: key,
                    toolName: 'date_processor',
                    parameters: { operation: key, input: value }
                });
            }

            // Data validation
            if (this.isValidationOperation(key, value)) {
                executableComponents.push({
                    component: key,
                    toolName: 'data_validator',
                    parameters: { type: key, data: value }
                });
            }
        }

        return executableComponents;
    }

    private async executeComponent(component: {
        component: string;
        toolName: string;
        parameters: Record<string, any>;
    }): Promise<HybridToolExecution> {
        const startTime = Date.now();

        try {
            const tool = this.tools.get(component.toolName);
            if (!tool) {
                throw new Error(`Tool not found: ${component.toolName}`);
            }

            // Validate parameters
            this.validateToolParameters(tool, component.parameters);

            // Execute tool
            const result = await tool.execute(component.parameters);

            return {
                toolName: component.toolName,
                input: component.parameters,
                output: result,
                executionTime: Date.now() - startTime,
                success: true
            };

        } catch (error) {
            return {
                toolName: component.toolName,
                input: component.parameters,
                output: null,
                executionTime: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private updateFrameWithResult(
        frame: CortexFrame,
        component: any,
        result: any
    ): CortexFrame {
        // Create updated frame with deterministic result
        return {
            ...frame,
            [component.component]: result
        } as CortexFrame;
    }

    private isMathOperation(key: string, value: any): boolean {
        if (typeof value !== 'string') return false;
        
        const mathKeywords = ['calculate', 'compute', 'sum', 'total', 'multiply', 'divide', 'subtract'];
        const mathPatterns = [
            /^\d+\s*[+\-*/]\s*\d+/,  // Basic arithmetic
            /^Math\./,                // Math functions
            /^\d+%$/,                 // Percentages
            /^\$?\d+\.?\d*/           // Currency/numbers
        ];

        return mathKeywords.some(keyword => key.toLowerCase().includes(keyword)) ||
               mathPatterns.some(pattern => pattern.test(value));
    }

    private isStringOperation(key: string, value: any): boolean {
        if (typeof value !== 'string') return false;

        const stringOperations = ['format', 'transform', 'clean', 'parse', 'extract'];
        return stringOperations.some(op => key.toLowerCase().includes(op));
    }

    private isDateOperation(key: string, value: any): boolean {
        const dateKeywords = ['date', 'time', 'timestamp', 'schedule', 'calendar'];
        return dateKeywords.some(keyword => key.toLowerCase().includes(keyword));
    }

    private isValidationOperation(key: string, value: any): boolean {
        const validationKeywords = ['validate', 'check', 'verify', 'confirm'];
        return validationKeywords.some(keyword => key.toLowerCase().includes(keyword));
    }

    private validateToolParameters(tool: CortexTool, parameters: Record<string, any>): void {
        for (const [paramName, paramConfig] of Object.entries(tool.parameters)) {
            const value = parameters[paramName];

            if (paramConfig.required && (value === undefined || value === null)) {
                throw new Error(`Required parameter missing: ${paramName}`);
            }

            if (value !== undefined && paramConfig.validation && !paramConfig.validation(value)) {
                throw new Error(`Parameter validation failed: ${paramName}`);
            }
        }
    }

    private generateCacheKey(endpoint: string, config: ApiExecutionConfig, parameters: Record<string, any>): string {
        const keyData = {
            endpoint,
            method: config.method,
            parameters: JSON.stringify(parameters, Object.keys(parameters).sort())
        };
        return crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex');
    }

    // ========================================================================
    // BUILT-IN TOOLS INITIALIZATION
    // ========================================================================

    private initializeBuiltInTools(): void {
        // Mathematical Calculator
        this.registerTool({
            name: 'math_calculator',
            description: 'Execute mathematical calculations deterministically',
            category: 'math',
            parameters: {
                expression: {
                    type: 'string',
                    required: true,
                    description: 'Mathematical expression to evaluate',
                    validation: (value) => typeof value === 'string' && value.length > 0
                }
            },
            execute: (params) => {
                try {
                    // Safe mathematical evaluation
                    const sanitized = params.expression
                        .replace(/[^0-9+\-*/().\s]/g, '')
                        .replace(/\s+/g, '');
                    
                    // Basic safety check
                    if (!/^[\d+\-*/().\s]+$/.test(sanitized)) {
                        throw new Error('Invalid mathematical expression');
                    }

                    const result = Function(`"use strict"; return (${sanitized})`)();
                    return typeof result === 'number' && !isNaN(result) ? result : null;
                } catch {
                    throw new Error('Mathematical evaluation failed');
                }
            },
            deterministic: true,
            costSavings: 50 // Saves ~50 tokens vs LLM calculation
        });

        // String Processor
        this.registerTool({
            name: 'string_processor',
            description: 'Process strings deterministically',
            category: 'string',
            parameters: {
                operation: {
                    type: 'string',
                    required: true,
                    description: 'String operation type'
                },
                input: {
                    type: 'string',
                    required: true,
                    description: 'Input string to process'
                }
            },
            execute: (params) => {
                const { operation, input } = params;
                
                switch (operation.toLowerCase()) {
                    case 'uppercase':
                    case 'upper':
                        return input.toUpperCase();
                    case 'lowercase':
                    case 'lower':
                        return input.toLowerCase();
                    case 'trim':
                        return input.trim();
                    case 'length':
                        return input.length;
                    case 'reverse':
                        return input.split('').reverse().join('');
                    case 'slugify':
                        return input.toLowerCase()
                            .replace(/[^\w\s-]/g, '')
                            .replace(/[\s_-]+/g, '-')
                            .replace(/^-+|-+$/g, '');
                    default:
                        throw new Error(`Unknown string operation: ${operation}`);
                }
            },
            deterministic: true,
            costSavings: 30
        });

        // Date Processor
        this.registerTool({
            name: 'date_processor',
            description: 'Process dates and times deterministically',
            category: 'date',
            parameters: {
                operation: {
                    type: 'string',
                    required: true,
                    description: 'Date operation type'
                },
                input: {
                    type: 'string',
                    required: false,
                    description: 'Input date/time'
                }
            },
            execute: (params) => {
                const { operation, input } = params;
                const date = input ? new Date(input) : new Date();

                if (isNaN(date.getTime())) {
                    throw new Error('Invalid date input');
                }

                switch (operation.toLowerCase()) {
                    case 'now':
                    case 'current':
                        return new Date().toISOString();
                    case 'timestamp':
                        return date.getTime();
                    case 'year':
                        return date.getFullYear();
                    case 'month':
                        return date.getMonth() + 1;
                    case 'day':
                        return date.getDate();
                    case 'hour':
                        return date.getHours();
                    case 'minute':
                        return date.getMinutes();
                    case 'second':
                        return date.getSeconds();
                    case 'iso':
                        return date.toISOString();
                    case 'format':
                        return date.toLocaleDateString('en-US');
                    default:
                        throw new Error(`Unknown date operation: ${operation}`);
                }
            },
            deterministic: true,
            costSavings: 40
        });

        // Data Validator
        this.registerTool({
            name: 'data_validator',
            description: 'Validate data types and formats deterministically',
            category: 'data',
            parameters: {
                type: {
                    type: 'string',
                    required: true,
                    description: 'Validation type'
                },
                data: {
                    type: 'string',
                    required: true,
                    description: 'Data to validate'
                }
            },
            execute: (params) => {
                const { type, data } = params;

                switch (type.toLowerCase()) {
                    case 'email':
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        return emailRegex.test(data);
                    case 'url':
                        try {
                            new URL(data);
                            return true;
                        } catch {
                            return false;
                        }
                    case 'phone':
                        const phoneRegex = /^\+?[\d\s\-()]+$/;
                        return phoneRegex.test(data) && data.replace(/\D/g, '').length >= 10;
                    case 'number':
                        return !isNaN(Number(data)) && data.trim() !== '';
                    case 'integer':
                        return Number.isInteger(Number(data));
                    case 'uuid':
                        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                        return uuidRegex.test(data);
                    case 'json':
                        try {
                            JSON.parse(data);
                            return true;
                        } catch {
                            return false;
                        }
                    default:
                        throw new Error(`Unknown validation type: ${type}`);
                }
            },
            deterministic: true,
            costSavings: 60
        });

        // Crypto Utilities
        this.registerTool({
            name: 'crypto_util',
            description: 'Cryptographic operations',
            category: 'crypto',
            parameters: {
                operation: {
                    type: 'string',
                    required: true,
                    description: 'Crypto operation type'
                },
                input: {
                    type: 'string',
                    required: true,
                    description: 'Input data'
                }
            },
            execute: (params) => {
                const { operation, input } = params;

                switch (operation.toLowerCase()) {
                    case 'hash':
                    case 'sha256':
                        return crypto.createHash('sha256').update(input).digest('hex');
                    case 'md5':
                        return crypto.createHash('md5').update(input).digest('hex');
                    case 'uuid':
                        return crypto.randomUUID();
                    case 'base64_encode':
                        return Buffer.from(input).toString('base64');
                    case 'base64_decode':
                        try {
                            return Buffer.from(input, 'base64').toString('utf8');
                        } catch {
                            throw new Error('Invalid base64 input');
                        }
                    default:
                        throw new Error(`Unknown crypto operation: ${operation}`);
                }
            },
            deterministic: true,
            costSavings: 70
        });

        // File Operations
        this.registerTool({
            name: 'file_processor',
            description: 'File system operations',
            category: 'file',
            parameters: {
                operation: {
                    type: 'string',
                    required: true,
                    description: 'File operation type'
                },
                filepath: {
                    type: 'string',
                    required: true,
                    description: 'File path'
                },
                content: {
                    type: 'string',
                    required: false,
                    description: 'File content (for write operations)'
                }
            },
            execute: async (params) => {
                const { operation, filepath, content } = params;
                
                // Security check - only allow operations in safe directories
                const safePath = path.resolve('./tmp', path.basename(filepath));
                
                switch (operation.toLowerCase()) {
                    case 'read':
                        try {
                            return await fs.readFile(safePath, 'utf8');
                        } catch {
                            throw new Error('File not found or not readable');
                        }
                    case 'write':
                        if (!content) throw new Error('Content required for write operation');
                        await fs.writeFile(safePath, content, 'utf8');
                        return 'File written successfully';
                    case 'exists':
                        try {
                            await fs.access(safePath);
                            return true;
                        } catch {
                            return false;
                        }
                    case 'size':
                        try {
                            const stats = await fs.stat(safePath);
                            return stats.size;
                        } catch {
                            throw new Error('Cannot get file size');
                        }
                    default:
                        throw new Error(`Unknown file operation: ${operation}`);
                }
            },
            deterministic: true,
            costSavings: 80
        });

        loggingService.info('⚡ Initialized built-in hybrid execution tools', {
            toolCount: this.tools.size,
            categories: ['math', 'string', 'date', 'data', 'crypto', 'file']
        });
    }
}
