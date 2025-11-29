import mongoose from 'mongoose';
import { AutomationConnection, IAutomationConnection } from '../models/AutomationConnection';
import { Usage, IUsage } from '../models/Usage';
import { UsageService } from './usage.service';
import { loggingService } from './logging.service';
import { GuardrailsService } from './guardrails.service';
import { User } from '../models/User';
import crypto from 'crypto';

export interface AutomationWebhookPayload {
    platform: 'zapier' | 'make' | 'n8n';
    workflowId: string;
    workflowName: string;
    workflowStep?: string;
    workflowSequence?: number; // Step order in workflow
    service: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    responseTime?: number;
    metadata?: Record<string, any>;
    tags?: string[];
    prompt?: string;
    completion?: string;
    // Support for non-AI steps
    isAIStep?: boolean; // true for AI steps, false for non-AI steps
    stepType?: 'ai' | 'action' | 'filter' | 'formatter' | 'webhook' | 'other';
    stepApp?: string; // Zapier app name (e.g., "OpenAI", "Anthropic", "Google Sheets", etc.)
}

// Support for batch/multi-step payloads
export interface AutomationBatchWebhookPayload {
    platform: 'zapier' | 'make' | 'n8n';
    workflowId: string;
    workflowName: string;
    workflowExecutionId?: string; // Unique ID for this workflow run
    // Platform-specific execution IDs:
    // - Make: executionId, scenarioExecutionId
    // - n8n: executionId, workflowExecutionId
    // - Zapier: executionId (optional)
    steps: AutomationWebhookPayload[]; // Multiple steps in one request
    totalCost?: number; // Optional: pre-calculated total
    metadata?: Record<string, any>;
    tags?: string[];
}

export interface AutomationAnalytics {
    platform: string;
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
    workflows: Array<{
        workflowId: string;
        workflowName: string;
        totalCost: number;
        totalRequests: number;
        totalTokens: number;
        lastActivity: Date;
    }>;
    timeSeries: Array<{
        date: string;
        cost: number;
        requests: number;
        tokens: number;
    }>;
}

export interface AutomationStats {
    totalConnections: number;
    activeConnections: number;
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
    platformBreakdown: Array<{
        platform: string;
        connections: number;
        cost: number;
        requests: number;
    }>;
    topWorkflows: Array<{
        workflowId: string;
        workflowName: string;
        platform: string;
        cost: number;
        requests: number;
    }>;
}

export class AutomationService {
    /**
     * Calculate orchestration overhead cost for automation platforms
     * This includes platform run fees, data operations, webhook volume, etc.
     */
    private static calculateOrchestrationCost(
        platform: 'zapier' | 'make' | 'n8n',
        stepType: string,
        isAIStep: boolean,
        totalCost: number
    ): { orchestrationCost: number; overheadPercentage: number } {
        // Platform-specific overhead rates
        // These are estimates based on typical automation platform pricing
        const platformOverheadRates: Record<string, { base: number; perStep: number; aiStepMultiplier: number; stepTypeMultipliers: Record<string, number> }> = {
            zapier: {
                base: 0.0001, // Base cost per execution
                perStep: 0.00005, // Additional cost per step
                aiStepMultiplier: 1.2, // AI steps may have higher overhead
                stepTypeMultipliers: {
                    'webhook': 1.0,
                    'api_call': 1.1,
                    'data_transform': 0.9,
                    'filter': 0.8,
                    'delay': 0.5,
                    'default': 1.0
                }
            },
            make: {
                base: 0.0002, // Make typically charges per operation
                perStep: 0.0001,
                aiStepMultiplier: 1.3,
                stepTypeMultipliers: {
                    'webhook': 1.0,
                    'api_call': 1.2,
                    'data_transform': 1.0,
                    'filter': 0.9,
                    'delay': 0.6,
                    'default': 1.0
                }
            },
            n8n: {
                base: 0.00005, // Self-hosted n8n has lower overhead, cloud has similar to Make
                perStep: 0.00003,
                aiStepMultiplier: 1.1,
                stepTypeMultipliers: {
                    'webhook': 0.9,
                    'api_call': 1.0,
                    'data_transform': 0.8,
                    'filter': 0.7,
                    'delay': 0.4,
                    'default': 1.0
                }
            }
        };

        const rates = platformOverheadRates[platform] || platformOverheadRates.zapier;
        let orchestrationCost = rates.base;

        // Add per-step cost
        orchestrationCost += rates.perStep;

        // Apply step type multiplier
        const stepTypeMultiplier = rates.stepTypeMultipliers[stepType] || rates.stepTypeMultipliers['default'];
        orchestrationCost *= stepTypeMultiplier;

        // Apply multiplier for AI steps (they often have more data processing)
        if (isAIStep) {
            orchestrationCost *= rates.aiStepMultiplier;
        }

        // Calculate overhead percentage
        const totalWithOverhead = totalCost + orchestrationCost;
        const overheadPercentage = totalWithOverhead > 0 
            ? (orchestrationCost / totalWithOverhead) * 100 
            : 0;

        return {
            orchestrationCost: Math.round(orchestrationCost * 100000) / 100000, // Round to 5 decimal places
            overheadPercentage: Math.round(overheadPercentage * 100) / 100 // Round to 2 decimal places
        };
    }

    /**
     * Generate unique webhook URL for a connection
     */
    static generateWebhookUrl(connectionId: string): string {
        const baseUrl = process.env.NODE_ENV === 'development' 
            ? 'http://localhost:8000' 
            : 'https://cost-katana-backend.store';
        const webhookPath = `/api/automation/webhook/${connectionId}`;
        return `${baseUrl}${webhookPath}`;
    }

    /**
     * Generate unique connection ID
     */
    static generateConnectionId(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Validate webhook payload structure
     * Supports both single step and batch/multi-step payloads
     */
    static validateWebhookPayload(payload: any): { valid: boolean; error?: string; isBatch?: boolean } {
        if (!payload) {
            return { valid: false, error: 'Payload is required' };
        }

        // Check if this is a batch payload (multiple steps)
        if (payload.steps && Array.isArray(payload.steps)) {
            // Validate batch payload structure
            if (!payload.platform || !['zapier', 'make', 'n8n'].includes(payload.platform)) {
                return { valid: false, error: 'Invalid or missing platform. Must be zapier, make, or n8n' };
            }

            if (!payload.workflowId || typeof payload.workflowId !== 'string') {
                return { valid: false, error: 'workflowId is required and must be a string' };
            }

            if (!payload.workflowName || typeof payload.workflowName !== 'string') {
                return { valid: false, error: 'workflowName is required and must be a string' };
            }

            if (payload.steps.length === 0) {
                return { valid: false, error: 'steps array cannot be empty' };
            }

            // Validate each step
            for (let i = 0; i < payload.steps.length; i++) {
                const step = payload.steps[i];
                const stepValidation = this.validateSingleStepPayload(step, i);
                if (!stepValidation.valid) {
                    return { valid: false, error: `Step ${i + 1}: ${stepValidation.error}` };
                }
            }

            return { valid: true, isBatch: true };
        }

        // Validate single step payload
        const stepValidation = this.validateSingleStepPayload(payload);
        if (!stepValidation.valid) {
            return stepValidation;
        }

        return { valid: true, isBatch: false };
    }

    /**
     * Validate a single step payload
     */
    private static validateSingleStepPayload(step: any, index?: number): { valid: boolean; error?: string } {
        const prefix = index !== undefined ? `Step ${index + 1}: ` : '';

        // For non-AI steps, some fields are optional
        const isAIStep = step.isAIStep !== false; // Default to true if not specified

        if (!step.service || typeof step.service !== 'string') {
            if (isAIStep) {
                return { valid: false, error: `${prefix}service is required and must be a string` };
            }
            // For non-AI steps, use a default service
            step.service = step.service || 'zapier';
        }

        if (!step.model || typeof step.model !== 'string') {
            if (isAIStep) {
                return { valid: false, error: `${prefix}model is required and must be a string` };
            }
            // For non-AI steps, use a default model
            step.model = step.model || 'non-ai-action';
        }

        // Token fields are required for AI steps, optional for non-AI
        if (isAIStep) {
            if (typeof step.promptTokens !== 'number' || step.promptTokens < 0) {
                return { valid: false, error: `${prefix}promptTokens is required and must be a non-negative number` };
            }

            if (typeof step.completionTokens !== 'number' || step.completionTokens < 0) {
                return { valid: false, error: `${prefix}completionTokens is required and must be a non-negative number` };
            }

            if (typeof step.totalTokens !== 'number' || step.totalTokens < 0) {
                return { valid: false, error: `${prefix}totalTokens is required and must be a non-negative number` };
            }
        } else {
            // For non-AI steps, default to 0
            step.promptTokens = step.promptTokens || 0;
            step.completionTokens = step.completionTokens || 0;
            step.totalTokens = step.totalTokens || 0;
        }

        // Cost is always required but can be 0 for non-AI steps
        if (typeof step.cost !== 'number' || step.cost < 0) {
            return { valid: false, error: `${prefix}cost is required and must be a non-negative number` };
        }

        return { valid: true };
    }

    /**
     * Detect AI service from app name or service field
     * Supports Zapier, Make, and n8n app names
     */
    private static detectAIService(stepApp?: string, service?: string, platform?: 'zapier' | 'make' | 'n8n'): { service: string; model: string; isAI: boolean } {
        const appName = (stepApp || service || '').toLowerCase();
        
        // Map all AI app names across all platforms (Zapier, Make, n8n) to AI services
        // Comprehensive list of AI services available on automation platforms
        const serviceMap: Record<string, { service: string; defaultModel: string }> = {
            // OpenAI
            'openai': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'gpt': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'gpt-3': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'gpt-4': { service: 'openai', defaultModel: 'gpt-4' },
            'gpt-4o': { service: 'openai', defaultModel: 'gpt-4o' },
            'chatgpt': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'dall-e': { service: 'openai', defaultModel: 'dall-e-3' },
            'dalle': { service: 'openai', defaultModel: 'dall-e-3' },
            
            // Anthropic / Claude
            'anthropic': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'claude': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'claude-3': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'claude-3.5': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'claude-4': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            
            // Google AI / Gemini
            'google ai': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'google-ai': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'gemini': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'google': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'palm': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'vertex ai': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'vertex': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'bard': { service: 'google-ai', defaultModel: 'gemini-pro' },
            
            // AWS Bedrock
            'aws bedrock': { service: 'aws-bedrock', defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
            'bedrock': { service: 'aws-bedrock', defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
            'amazon bedrock': { service: 'aws-bedrock', defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
            
            // Cohere
            'cohere': { service: 'cohere', defaultModel: 'command' },
            'cohere command': { service: 'cohere', defaultModel: 'command' },
            
            // HuggingFace
            'huggingface': { service: 'huggingface', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
            'hugging face': { service: 'huggingface', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
            'hf': { service: 'huggingface', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
            
            // Mistral AI
            'mistral': { service: 'mistral', defaultModel: 'mistral-medium' },
            'mistral ai': { service: 'mistral', defaultModel: 'mistral-medium' },
            'mistral-ai': { service: 'mistral', defaultModel: 'mistral-medium' },
            
            // xAI / Grok
            'xai': { service: 'xai', defaultModel: 'grok-beta' },
            'grok': { service: 'xai', defaultModel: 'grok-beta' },
            'grok-2': { service: 'xai', defaultModel: 'grok-beta' },
            
            // DeepSeek
            'deepseek': { service: 'deepseek', defaultModel: 'deepseek-chat' },
            'deep seek': { service: 'deepseek', defaultModel: 'deepseek-chat' },
            
            // Azure OpenAI
            'azure openai': { service: 'azure-openai', defaultModel: 'gpt-3.5-turbo' },
            'azure': { service: 'azure-openai', defaultModel: 'gpt-3.5-turbo' },
            'azure-ai': { service: 'azure-openai', defaultModel: 'gpt-3.5-turbo' },
            
            // Replicate
            'replicate': { service: 'replicate', defaultModel: 'meta/llama-2-7b-chat' },
            
            // Meta / Llama
            'meta': { service: 'meta', defaultModel: 'llama-2-7b-chat' },
            'llama': { service: 'meta', defaultModel: 'llama-2-7b-chat' },
            'llama-2': { service: 'meta', defaultModel: 'llama-2-7b-chat' },
            'llama-3': { service: 'meta', defaultModel: 'llama-3-8b' },
            'meta llama': { service: 'meta', defaultModel: 'llama-2-7b-chat' },
            
            // Ollama
            'ollama': { service: 'ollama', defaultModel: 'llama2' },
            
            // Stability AI
            'stability ai': { service: 'stability-ai', defaultModel: 'stable-diffusion-xl' },
            'stability': { service: 'stability-ai', defaultModel: 'stable-diffusion-xl' },
            'stable diffusion': { service: 'stability-ai', defaultModel: 'stable-diffusion-xl' },
            'stablediffusion': { service: 'stability-ai', defaultModel: 'stable-diffusion-xl' },
            
            // AI21 Labs
            'ai21': { service: 'ai21', defaultModel: 'j2-ultra' },
            'ai21 labs': { service: 'ai21', defaultModel: 'j2-ultra' },
            'j2': { service: 'ai21', defaultModel: 'j2-ultra' },
            'jurassic': { service: 'ai21', defaultModel: 'j2-ultra' },
            
            // Together AI
            'together ai': { service: 'together-ai', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
            'together': { service: 'together-ai', defaultModel: 'meta-llama/Llama-2-7b-chat-hf' },
            
            // Perplexity
            'perplexity': { service: 'perplexity', defaultModel: 'llama-3.1-sonar-large-128k-online' },
            'pplx': { service: 'perplexity', defaultModel: 'llama-3.1-sonar-large-128k-online' },
            
            // Aleph Alpha
            'aleph alpha': { service: 'aleph-alpha', defaultModel: 'luminous-base' },
            'aleph-alpha': { service: 'aleph-alpha', defaultModel: 'luminous-base' },
            'luminous': { service: 'aleph-alpha', defaultModel: 'luminous-base' },
            
            // Nomic AI
            'nomic': { service: 'nomic', defaultModel: 'nomic-embed-text-v1' },
            'nomic ai': { service: 'nomic', defaultModel: 'nomic-embed-text-v1' },
            
            // Content Writing AI Services (mapped to appropriate services)
            'jasper': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Jasper uses OpenAI
            'jasper ai': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'copy.ai': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Copy.ai uses OpenAI
            'copyai': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'writesonic': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Writesonic uses OpenAI
            'anyword': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Anyword uses OpenAI
            'rytr': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Rytr uses OpenAI
            'simplified': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Simplified uses OpenAI
            'contentbot': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // ContentBot uses OpenAI
            'wordtune': { service: 'openai', defaultModel: 'gpt-3.5-turbo' }, // Wordtune uses OpenAI
            
            // Platform-specific variations (for better matching)
            'openai (make)': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'openai (n8n)': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'openai (zapier)': { service: 'openai', defaultModel: 'gpt-3.5-turbo' },
            'anthropic (make)': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'anthropic (n8n)': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'anthropic (zapier)': { service: 'anthropic', defaultModel: 'claude-3-5-sonnet' },
            'google ai (make)': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'google ai (n8n)': { service: 'google-ai', defaultModel: 'gemini-pro' },
            'google ai (zapier)': { service: 'google-ai', defaultModel: 'gemini-pro' }
        };

        // Check if it's an AI service
        for (const [key, value] of Object.entries(serviceMap)) {
            if (appName.includes(key)) {
                return { service: value.service, model: value.defaultModel, isAI: true };
            }
        }

        // Check service field directly
        if (service) {
            const normalizedService = service.toLowerCase().replace(/[_-]/g, '');
            for (const [key, value] of Object.entries(serviceMap)) {
                if (normalizedService.includes(key)) {
                    return { service: value.service, model: value.defaultModel, isAI: true };
                }
            }
        }

        // Not an AI service - return platform-appropriate default
        const defaultService = platform === 'make' ? 'make' : platform === 'n8n' ? 'n8n' : 'zapier';
        return { service: defaultService, model: 'non-ai-action', isAI: false };
    }

    /**
     * Normalize platform data to common structure
     * Enhanced to support all Zapier, Make, and n8n apps and non-AI steps
     */
    static normalizePlatformData(payload: any, platform: 'zapier' | 'make' | 'n8n'): AutomationWebhookPayload {
        // Detect if this is an AI step
        const isAIStep = payload.isAIStep !== false; // Default to true if not specified
        
        // Platform-specific field name mappings
        let stepApp: string | undefined;
        let workflowId: string | undefined;
        let workflowName: string | undefined;
        let workflowStep: string | undefined;
        let workflowSequence: number | undefined;
        
        if (platform === 'make') {
            // Make uses: scenario, scenarioId, scenarioName, module, moduleName
            stepApp = payload.stepApp || payload.app || payload.appName || payload.module || payload.moduleName;
            workflowId = payload.workflowId || payload.workflow_id || payload.scenarioId || payload.scenario_id || payload.id;
            workflowName = payload.workflowName || payload.workflow_name || payload.scenarioName || payload.scenario_name || payload.scenario || payload.name;
            workflowStep = payload.workflowStep || payload.workflow_step || payload.step || payload.module || payload.moduleName || stepApp;
            workflowSequence = payload.workflowSequence || payload.workflow_sequence || payload.sequence || payload.stepNumber || payload.moduleOrder || 0;
        } else if (platform === 'n8n') {
            // n8n uses: workflow, workflowId, workflowName, node, nodeName
            stepApp = payload.stepApp || payload.app || payload.appName || payload.node || payload.nodeName;
            workflowId = payload.workflowId || payload.workflow_id || payload.id;
            workflowName = payload.workflowName || payload.workflow_name || payload.workflow || payload.name;
            workflowStep = payload.workflowStep || payload.workflow_step || payload.step || payload.node || payload.nodeName || stepApp;
            workflowSequence = payload.workflowSequence || payload.workflow_sequence || payload.sequence || payload.stepNumber || payload.nodeIndex || 0;
        } else {
            // Zapier (default)
            stepApp = payload.stepApp || payload.app || payload.appName || payload.zapierApp;
            workflowId = payload.workflowId || payload.workflow_id || payload.id;
            workflowName = payload.workflowName || payload.workflow_name || payload.name;
            workflowStep = payload.workflowStep || payload.workflow_step || payload.step || stepApp;
            workflowSequence = payload.workflowSequence || payload.workflow_sequence || payload.sequence || payload.stepNumber || 0;
        }
        
        // Detect AI service from app name or service field (pass platform for default service)
        const aiDetection = this.detectAIService(stepApp, payload.service, platform);
        const detectedService = aiDetection.service;
        const detectedModel = payload.model || payload.model_name || aiDetection.model;
        
        // Determine if this is actually an AI step
        const actualIsAI = isAIStep && aiDetection.isAI;
        const stepType = actualIsAI ? 'ai' : (payload.stepType || payload.step_type || 'other');

        // Normalize to common structure
        const normalized: AutomationWebhookPayload = {
            platform,
            workflowId: workflowId || 'unknown',
            workflowName: workflowName || 'Unknown Workflow',
            workflowStep: workflowStep || 'Unknown Step',
            workflowSequence: workflowSequence || 0,
            service: detectedService,
            model: detectedModel,
            promptTokens: actualIsAI ? (payload.promptTokens || payload.prompt_tokens || payload.input_tokens || 0) : 0,
            completionTokens: actualIsAI ? (payload.completionTokens || payload.completion_tokens || payload.output_tokens || 0) : 0,
            totalTokens: actualIsAI ? (payload.totalTokens || payload.total_tokens || 
                ((payload.promptTokens || payload.prompt_tokens || payload.input_tokens || 0) + 
                 (payload.completionTokens || payload.completion_tokens || payload.output_tokens || 0))) : 0,
            cost: payload.cost || payload.estimated_cost || payload.estimatedCost || (actualIsAI ? 0 : 0),
            responseTime: payload.responseTime || payload.response_time || payload.latency || 0,
            metadata: {
                ...(payload.metadata || payload.meta || {}),
                stepApp: stepApp,
                originalService: payload.service || payload.provider,
                originalModel: payload.model || payload.model_name,
                // Platform-specific metadata
                ...(platform === 'make' && {
                    scenarioId: payload.scenarioId || payload.scenario_id,
                    moduleName: payload.moduleName || payload.module
                }),
                ...(platform === 'n8n' && {
                    nodeName: payload.nodeName || payload.node,
                    workflowExecutionId: payload.workflowExecutionId || payload.executionId
                })
            },
            tags: payload.tags || payload.tag || [],
            prompt: payload.prompt || payload.input || '',
            completion: payload.completion || payload.output || '',
            isAIStep: actualIsAI,
            stepType: stepType as 'ai' | 'action' | 'filter' | 'formatter' | 'webhook' | 'other',
            stepApp: stepApp
        };

        return normalized;
    }

    /**
     * Extract and store workflow metadata from webhook payload
     */
    private static extractWorkflowMetadata(
        payload: AutomationWebhookPayload | AutomationBatchWebhookPayload
    ): {
        stepCount: number;
        aiStepCount: number;
        nonAIStepCount: number;
        stepTypes: Array<'ai' | 'action' | 'filter' | 'formatter' | 'webhook' | 'other'>;
        triggerType?: 'scheduled' | 'webhook' | 'polling' | 'manual';
        hasLoops?: boolean;
        hasConcurrentBranches?: boolean;
        complexityScore: number;
    } {
        const isBatch = 'steps' in payload && Array.isArray(payload.steps);
        const steps = isBatch ? payload.steps : [payload as AutomationWebhookPayload];

        const stepTypes = new Set<string>();
        let aiStepCount = 0;
        let nonAIStepCount = 0;

        steps.forEach(step => {
            const stepType = step.stepType || (step.isAIStep !== false ? 'ai' : 'other');
            stepTypes.add(stepType);
            if (step.isAIStep !== false) {
                aiStepCount++;
            } else {
                nonAIStepCount++;
            }
        });

        // Calculate complexity score (0-100)
        // Factors: step count, AI steps, step variety
        const stepCount = steps.length;
        const stepVariety = stepTypes.size;
        const complexityScore = Math.min(100, 
            (stepCount * 5) + // More steps = more complex
            (aiStepCount * 3) + // AI steps add complexity
            (stepVariety * 10) // More step types = more complex
        );

        return {
            stepCount,
            aiStepCount,
            nonAIStepCount,
            stepTypes: Array.from(stepTypes) as Array<'ai' | 'action' | 'filter' | 'formatter' | 'webhook' | 'other'>,
            triggerType: payload.metadata?.triggerType || 'webhook',
            hasLoops: payload.metadata?.hasLoops || false,
            hasConcurrentBranches: payload.metadata?.hasConcurrentBranches || false,
            complexityScore: Math.round(complexityScore)
        };
    }

    /**
     * Process webhook data and create usage record(s)
     * Supports both single step and batch/multi-step payloads
     */
    static async processWebhookData(
        userId: string,
        connectionId: string | null,
        payload: any
    ): Promise<IUsage | IUsage[]> {
        try {
            // Validate payload
            const validation = this.validateWebhookPayload(payload);
            if (!validation.valid) {
                throw new Error(validation.error || 'Invalid payload');
            }

            // Handle batch/multi-step payloads
            if (validation.isBatch && payload.steps) {
                return await this.processBatchWebhookData(userId, connectionId, payload);
            }

            // Handle single step payload
            const normalized = this.normalizePlatformData(payload, payload.platform);

            // Get connection if connectionId provided
            let connection: IAutomationConnection | null = null;
            if (connectionId) {
                // Try to find by String _id first, then fallback to ObjectId for backward compatibility
                try {
                    connection = await AutomationConnection.findById(connectionId);
                } catch (error) {
                    // If String _id fails, try as ObjectId (for old connections)
                    if (connectionId.length === 24) {
                        try {
                            connection = await AutomationConnection.findById(new mongoose.Types.ObjectId(connectionId));
                        } catch (e) {
                            // Ignore and continue without connection
                        }
                    }
                }
                
                if (connection && connection.userId.toString() !== userId) {
                    throw new Error('Connection not found or access denied');
                }
            }

            // Calculate orchestration overhead
            const overhead = this.calculateOrchestrationCost(
                normalized.platform,
                normalized.stepType || 'other',
                normalized.isAIStep !== false,
                normalized.cost
            );

            // Create usage record
            const usageData: any = {
                userId,
                service: normalized.service,
                model: normalized.model,
                prompt: normalized.prompt || '',
                completion: normalized.completion,
                promptTokens: normalized.promptTokens,
                completionTokens: normalized.completionTokens,
                totalTokens: normalized.totalTokens,
                cost: normalized.cost,
                responseTime: normalized.responseTime || 0,
                metadata: {
                    ...normalized.metadata,
                    automationPlatform: normalized.platform,
                    source: 'automation_webhook'
                },
                tags: normalized.tags || [],
                workflowId: normalized.workflowId,
                workflowName: normalized.workflowName,
                workflowStep: normalized.workflowStep,
                automationPlatform: normalized.platform,
                automationConnectionId: connectionId || undefined,
                orchestrationCost: overhead.orchestrationCost,
                orchestrationOverheadPercentage: overhead.overheadPercentage
            };

            // Track usage
            const usage = await UsageService.trackUsage(usageData);

            if (!usage) {
                throw new Error('Failed to create usage record');
            }

            // Update connection statistics if connection exists
            if (connection) {
                connection.stats.totalRequests += 1;
                connection.stats.totalCost += normalized.cost;
                connection.stats.totalTokens += normalized.totalTokens;
                connection.stats.lastActivityAt = new Date();
                connection.stats.lastRequestAt = new Date();
                connection.stats.averageCostPerRequest = connection.stats.totalCost / connection.stats.totalRequests;
                connection.stats.averageTokensPerRequest = connection.stats.totalTokens / connection.stats.totalRequests;
                
                // Extract and update workflow metadata
                const workflowMetadata = this.extractWorkflowMetadata(payload);
                
                // Update metadata with last workflow name and workflow metadata
                connection.metadata = {
                    ...connection.metadata,
                    lastWorkflowName: normalized.workflowName,
                    workflowMetadata: {
                        ...connection.metadata?.workflowMetadata,
                        ...workflowMetadata
                    }
                };
                await connection.save();
            }

            // Trigger workflow alert checks and version tracking in background (non-blocking)
            if (normalized.workflowId) {
                setImmediate(() => {
                    (async () => {
                        try {
                            const { WorkflowAlertingService } = await import('./workflowAlerting.service');
                            const { WorkflowVersioningService } = await import('./workflowVersioning.service');
                            
                            // Check alerts in parallel
                            const alertPromises = [
                                WorkflowAlertingService.checkWorkflowSpikeAlerts(userId, normalized.workflowId),
                                WorkflowAlertingService.checkWorkflowInefficiencyAlerts(userId, normalized.workflowId),
                                WorkflowAlertingService.checkWorkflowFailureAlerts(userId, normalized.workflowId)
                            ];
                            
                            // Track workflow version if structure metadata is available
                            const versionPromise = connection?.metadata?.workflowMetadata
                                ? WorkflowVersioningService.createWorkflowVersion(
                                      userId,
                                      normalized.workflowId,
                                      normalized.workflowName,
                                      normalized.platform,
                                      {
                                          stepCount: connection.metadata.workflowMetadata.stepCount ?? 0,
                                          aiStepCount: connection.metadata.workflowMetadata.aiStepCount ?? 0,
                                          stepTypes: connection.metadata.workflowMetadata.stepTypes ?? [],
                                          complexityScore: connection.metadata.workflowMetadata.complexityScore ?? 0
                                      }
                                  )
                                : Promise.resolve(null);
                            
                            await Promise.all([...alertPromises, versionPromise]);
                        } catch (error) {
                            // Log but don't fail the webhook processing
                            loggingService.error('Error in background workflow processing', {
                                component: 'AutomationService',
                                operation: 'processWebhookData',
                                error: error instanceof Error ? error.message : String(error),
                                workflowId: normalized.workflowId
                            });
                        }
                    })();
                });
            }

            loggingService.info('Automation webhook processed successfully', {
                component: 'AutomationService',
                operation: 'processWebhookData',
                userId,
                connectionId,
                platform: normalized.platform,
                workflowId: normalized.workflowId,
                cost: normalized.cost
            });

            return usage;
        } catch (error) {
            loggingService.error('Error processing automation webhook', {
                component: 'AutomationService',
                operation: 'processWebhookData',
                error: error instanceof Error ? error.message : String(error),
                userId,
                connectionId
            });
            throw error;
        }
    }

    /**
     * Process batch/multi-step webhook data
     * Creates usage records for all steps in a workflow execution
     * Supports Zapier, Make, and n8n batch payloads
     */
    static async processBatchWebhookData(
        userId: string,
        connectionId: string | null,
        batchPayload: AutomationBatchWebhookPayload
    ): Promise<IUsage[]> {
        try {
            const { platform, workflowId, workflowName, steps, metadata, tags } = batchPayload;
            
            // Support platform-specific execution IDs
            let workflowExecutionId: string | undefined;
            if (platform === 'make') {
                workflowExecutionId = batchPayload.workflowExecutionId || (batchPayload as any).executionId || (batchPayload as any).scenarioExecutionId;
            } else if (platform === 'n8n') {
                workflowExecutionId = batchPayload.workflowExecutionId || (batchPayload as any).executionId;
            } else {
                // Zapier
                workflowExecutionId = batchPayload.workflowExecutionId || (batchPayload as any).executionId;
            }

            // Get connection if connectionId provided
            let connection: IAutomationConnection | null = null;
            if (connectionId) {
                try {
                    connection = await AutomationConnection.findById(connectionId);
                } catch (error) {
                    if (connectionId.length === 24) {
                        try {
                            connection = await AutomationConnection.findById(new mongoose.Types.ObjectId(connectionId));
                        } catch (e) {
                            // Ignore and continue without connection
                        }
                    }
                }
                
                if (connection && connection.userId.toString() !== userId) {
                    throw new Error('Connection not found or access denied');
                }
            }

            // Process all steps
            const usageRecords: IUsage[] = [];
            let totalCost = 0;
            let totalTokens = 0;

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const normalized = this.normalizePlatformData(step, platform);

                // Ensure workflowSequence is set
                if (!normalized.workflowSequence || normalized.workflowSequence === 0) {
                    normalized.workflowSequence = i + 1;
                }

                // Calculate orchestration overhead for this step
                const overhead = this.calculateOrchestrationCost(
                    platform,
                    normalized.stepType || 'other',
                    normalized.isAIStep !== false,
                    normalized.cost
                );

                // Create usage record for this step
                const usageData: any = {
                    userId,
                    service: normalized.service,
                    model: normalized.model,
                    prompt: normalized.prompt || '',
                    completion: normalized.completion,
                    promptTokens: normalized.promptTokens,
                    completionTokens: normalized.completionTokens,
                    totalTokens: normalized.totalTokens,
                    cost: normalized.cost,
                    responseTime: normalized.responseTime || 0,
                    metadata: {
                        ...normalized.metadata,
                        ...metadata,
                        automationPlatform: platform,
                        source: 'automation_webhook',
                        workflowExecutionId: workflowExecutionId,
                        stepIndex: i,
                        isAIStep: normalized.isAIStep,
                        stepType: normalized.stepType,
                        stepApp: normalized.stepApp
                    },
                    tags: [...(normalized.tags || []), ...(tags || [])],
                    workflowId: normalized.workflowId,
                    workflowName: normalized.workflowName,
                    workflowStep: normalized.workflowStep,
                    workflowSequence: normalized.workflowSequence,
                    automationPlatform: platform,
                    automationConnectionId: connectionId || undefined,
                    orchestrationCost: overhead.orchestrationCost,
                    orchestrationOverheadPercentage: overhead.overheadPercentage
                };

                const usage = await UsageService.trackUsage(usageData);
                if (usage) {
                    usageRecords.push(usage);
                    totalCost += normalized.cost;
                    totalTokens += normalized.totalTokens;
                }
            }

            // Update connection statistics
            if (connection && usageRecords.length > 0) {
                connection.stats.totalRequests += usageRecords.length;
                connection.stats.totalCost += totalCost;
                connection.stats.totalTokens += totalTokens;
                connection.stats.lastActivityAt = new Date();
                connection.stats.lastRequestAt = new Date();
                connection.stats.averageCostPerRequest = connection.stats.totalCost / connection.stats.totalRequests;
                connection.stats.averageTokensPerRequest = connection.stats.totalTokens / connection.stats.totalRequests;
                
                // Extract and update workflow metadata from batch payload
                const workflowMetadata = this.extractWorkflowMetadata(batchPayload);
                
                if (workflowName) {
                    connection.metadata = {
                        ...connection.metadata,
                        lastWorkflowName: workflowName,
                        workflowMetadata: {
                            ...connection.metadata?.workflowMetadata,
                            ...workflowMetadata
                        }
                    };
                }
                await connection.save();
            }

            // Trigger workflow alert checks in background (non-blocking)
            if (workflowId) {
                setImmediate(async () => {
                    try {
                        const { WorkflowAlertingService } = await import('./workflowAlerting.service');
                        await WorkflowAlertingService.checkWorkflowSpikeAlerts(userId, workflowId);
                        await WorkflowAlertingService.checkWorkflowInefficiencyAlerts(userId, workflowId);
                        await WorkflowAlertingService.checkWorkflowFailureAlerts(userId, workflowId);
                    } catch (error) {
                        // Log but don't fail the webhook processing
                        loggingService.error('Error checking workflow alerts in background', {
                            component: 'AutomationService',
                            operation: 'processBatchWebhookData',
                            error: error instanceof Error ? error.message : String(error),
                            workflowId
                        });
                    }
                });
            }

            loggingService.info('Automation batch webhook processed successfully', {
                component: 'AutomationService',
                operation: 'processBatchWebhookData',
                userId,
                connectionId,
                platform,
                workflowId,
                stepCount: usageRecords.length,
                totalCost,
                totalTokens
            });

            return usageRecords;
        } catch (error) {
            loggingService.error('Error processing automation batch webhook', {
                component: 'AutomationService',
                operation: 'processBatchWebhookData',
                error: error instanceof Error ? error.message : String(error),
                userId,
                connectionId
            });
            throw error;
        }
    }

    /**
     * Get orchestration overhead analytics
     */
    static async getOrchestrationOverheadAnalytics(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            platform?: 'zapier' | 'make' | 'n8n';
        } = {}
    ): Promise<{
        totalOrchestrationCost: number;
        totalAICost: number;
        totalCost: number;
        averageOverheadPercentage: number;
        platformBreakdown: Array<{
            platform: string;
            orchestrationCost: number;
            aiCost: number;
            totalCost: number;
            overheadPercentage: number;
        }>;
    }> {
        try {
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                automationPlatform: { $exists: true, $ne: null },
                orchestrationCost: { $exists: true, $gt: 0 }
            };

            if (options.startDate || options.endDate) {
                match.createdAt = {};
                if (options.startDate) match.createdAt.$gte = options.startDate;
                if (options.endDate) match.createdAt.$lte = options.endDate;
            }

            if (options.platform) {
                match.automationPlatform = options.platform;
            }

            const analytics = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$automationPlatform',
                        totalOrchestrationCost: { $sum: '$orchestrationCost' },
                        totalAICost: { $sum: '$cost' },
                        totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } },
                        avgOverheadPercentage: { $avg: '$orchestrationOverheadPercentage' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            const platformBreakdown = analytics.map((item: any) => ({
                platform: item._id,
                orchestrationCost: item.totalOrchestrationCost || 0,
                aiCost: item.totalAICost || 0,
                totalCost: item.totalCost || 0,
                overheadPercentage: item.totalCost > 0 
                    ? ((item.totalOrchestrationCost || 0) / item.totalCost) * 100 
                    : 0
            }));

            const totalOrchestrationCost = platformBreakdown.reduce((sum, p) => sum + p.orchestrationCost, 0);
            const totalAICost = platformBreakdown.reduce((sum, p) => sum + p.aiCost, 0);
            const totalCost = totalOrchestrationCost + totalAICost;
            const averageOverheadPercentage = totalCost > 0 
                ? (totalOrchestrationCost / totalCost) * 100 
                : 0;

            return {
                totalOrchestrationCost,
                totalAICost,
                totalCost,
                averageOverheadPercentage: Math.round(averageOverheadPercentage * 100) / 100,
                platformBreakdown
            };
        } catch (error) {
            loggingService.error('Error getting orchestration overhead analytics', {
                component: 'AutomationService',
                operation: 'getOrchestrationOverheadAnalytics',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Get automation analytics grouped by platform and workflow
     */
    static async getAutomationAnalytics(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            platform?: 'zapier' | 'make' | 'n8n';
            workflowId?: string;
        } = {}
    ): Promise<AutomationAnalytics[]> {
        try {
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                automationPlatform: { $exists: true, $ne: null }
            };

            if (options.startDate || options.endDate) {
                match.createdAt = {};
                if (options.startDate) match.createdAt.$gte = options.startDate;
                if (options.endDate) match.createdAt.$lte = options.endDate;
            }

            if (options.platform) {
                match.automationPlatform = options.platform;
            }

            if (options.workflowId) {
                match.workflowId = options.workflowId;
            }

            // Aggregate by platform
            const platformAnalytics = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$automationPlatform',
                        totalCost: { $sum: '$cost' },
                        totalRequests: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        workflows: {
                            $push: {
                                workflowId: '$workflowId',
                                workflowName: '$workflowName',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                createdAt: '$createdAt'
                            }
                        }
                    }
                }
            ]);

            // Process each platform
            const analytics: AutomationAnalytics[] = await Promise.all(
                platformAnalytics.map(async (platformData) => {
                    const platform = platformData._id as string;
                    const totalRequests = platformData.totalRequests;
                    const totalCost = platformData.totalCost;
                    const totalTokens = platformData.totalTokens;

                    // Group workflows
                    const workflowMap = new Map<string, {
                        workflowId: string;
                        workflowName: string;
                        totalCost: number;
                        totalRequests: number;
                        totalTokens: number;
                        lastActivity: Date;
                    }>();

                    platformData.workflows.forEach((wf: any) => {
                        const key = wf.workflowId || 'unknown';
                        if (!workflowMap.has(key)) {
                            workflowMap.set(key, {
                                workflowId: key,
                                workflowName: wf.workflowName || 'Unknown Workflow',
                                totalCost: 0,
                                totalRequests: 0,
                                totalTokens: 0,
                                lastActivity: new Date(0)
                            });
                        }
                        const entry = workflowMap.get(key)!;
                        entry.totalCost += wf.cost || 0;
                        entry.totalRequests += 1;
                        entry.totalTokens += wf.tokens || 0;
                        if (wf.createdAt && new Date(wf.createdAt) > entry.lastActivity) {
                            entry.lastActivity = new Date(wf.createdAt);
                        }
                    });

                    // Get time series data
                    const timeSeriesData = await Usage.aggregate([
                        {
                            $match: {
                                ...match,
                                automationPlatform: platform
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    $dateToString: {
                                        format: '%Y-%m-%d',
                                        date: '$createdAt'
                                    }
                                },
                                cost: { $sum: '$cost' },
                                requests: { $sum: 1 },
                                tokens: { $sum: '$totalTokens' }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ]);

                    return {
                        platform,
                        totalCost,
                        totalRequests,
                        totalTokens,
                        averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
                        averageTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
                        workflows: Array.from(workflowMap.values()).sort((a, b) => b.totalCost - a.totalCost),
                        timeSeries: timeSeriesData.map((item: any) => ({
                            date: item._id,
                            cost: item.cost,
                            requests: item.requests,
                            tokens: item.tokens
                        }))
                    };
                })
            );

            return analytics;
        } catch (error) {
            loggingService.error('Error getting automation analytics', {
                component: 'AutomationService',
                operation: 'getAutomationAnalytics',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Get aggregated statistics for all automation connections
     */
    static async getAutomationStats(userId: string): Promise<AutomationStats> {
        try {
            // Get connections
            const connections = await AutomationConnection.find({ userId });
            const activeConnections = connections.filter(c => c.status === 'active');

            // Get usage statistics
            const usageStats = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        automationPlatform: { $exists: true, $ne: null }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalRequests: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        platforms: {
                            $push: {
                                platform: '$automationPlatform',
                                cost: '$cost',
                                requests: 1
                            }
                        },
                        workflows: {
                            $push: {
                                workflowId: '$workflowId',
                                workflowName: '$workflowName',
                                platform: '$automationPlatform',
                                cost: '$cost',
                                requests: 1
                            }
                        }
                    }
                }
            ]);

            const stats = usageStats[0] || {
                totalCost: 0,
                totalRequests: 0,
                totalTokens: 0,
                platforms: [],
                workflows: []
            };

            // Platform breakdown
            const platformMap = new Map<string, { platform: string; connections: number; cost: number; requests: number }>();
            connections.forEach(conn => {
                const key = conn.platform;
                if (!platformMap.has(key)) {
                    platformMap.set(key, {
                        platform: key,
                        connections: 0,
                        cost: 0,
                        requests: 0
                    });
                }
                const entry = platformMap.get(key)!;
                entry.connections += 1;
            });

            stats.platforms.forEach((p: any) => {
                const key = p.platform;
                if (platformMap.has(key)) {
                    const entry = platformMap.get(key)!;
                    entry.cost += p.cost || 0;
                    entry.requests += 1;
                }
            });

            // Top workflows
            const workflowMap = new Map<string, {
                workflowId: string;
                workflowName: string;
                platform: string;
                cost: number;
                requests: number;
            }>();

            stats.workflows.forEach((wf: any) => {
                const key = `${wf.platform}_${wf.workflowId}`;
                if (!workflowMap.has(key)) {
                    workflowMap.set(key, {
                        workflowId: wf.workflowId || 'unknown',
                        workflowName: wf.workflowName || 'Unknown Workflow',
                        platform: wf.platform,
                        cost: 0,
                        requests: 0
                    });
                }
                const entry = workflowMap.get(key)!;
                entry.cost += wf.cost || 0;
                entry.requests += 1;
            });

            return {
                totalConnections: connections.length,
                activeConnections: activeConnections.length,
                totalCost: stats.totalCost,
                totalRequests: stats.totalRequests,
                totalTokens: stats.totalTokens,
                platformBreakdown: Array.from(platformMap.values()),
                topWorkflows: Array.from(workflowMap.values())
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 10)
            };
        } catch (error) {
            loggingService.error('Error getting automation stats', {
                component: 'AutomationService',
                operation: 'getAutomationStats',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Get workflow quota status for a user
     */
    static async getWorkflowQuotaStatus(userId: string): Promise<{
        current: number;
        limit: number;
        percentage: number;
        plan: string;
        canCreate: boolean;
        violation?: {
            type: string;
            message: string;
            suggestions: string[];
        };
    }> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const planName = user.subscription?.plan || 'free';
            
            // Count active automation connections
            const activeConnections = await AutomationConnection.countDocuments({
                userId: new mongoose.Types.ObjectId(userId),
                status: 'active'
            });

            // Get plan limits - access through type assertion (temporary until we add a getter)
            const planLimits = (GuardrailsService as any).SUBSCRIPTION_PLANS?.[planName];
            if (!planLimits) {
                throw new Error('Unknown subscription plan');
            }

            const current = activeConnections;
            const limit = planLimits.workflows === -1 ? Infinity : planLimits.workflows;
            const limitValue = limit === Infinity ? -1 : limit;
            const percentage = limit === Infinity ? 0 : (current / limit) * 100;
            const canCreate = limit === Infinity || current < limit;

            // Check for violations
            const quotaCheck = await GuardrailsService.checkWorkflowQuota(userId);
            const violation = quotaCheck ? {
                type: quotaCheck.type,
                message: quotaCheck.message,
                suggestions: quotaCheck.suggestions
            } : undefined;

            return {
                current,
                limit: limitValue,
                percentage,
                plan: planName,
                canCreate,
                violation
            };
        } catch (error) {
            loggingService.error('Error getting workflow quota status', {
                component: 'AutomationService',
                operation: 'getWorkflowQuotaStatus',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Get connection statistics
     */
    static async getConnectionStats(connectionId: string, userId: string): Promise<any> {
        try {
            const connection = await AutomationConnection.findOne({
                _id: connectionId,
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!connection) {
                throw new Error('Connection not found');
            }

            // Get usage for this connection
            const usageStats = await Usage.aggregate([
                {
                    $match: {
                        automationConnectionId: new mongoose.Types.ObjectId(connectionId),
                        userId: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalRequests: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        averageCost: { $avg: '$cost' },
                        averageTokens: { $avg: '$totalTokens' },
                        lastActivity: { $max: '$createdAt' }
                    }
                }
            ]);

            return {
                connection: {
                    id: connection._id,
                    platform: connection.platform,
                    name: connection.name,
                    status: connection.status,
                    stats: connection.stats
                },
                usage: usageStats[0] || {
                    totalCost: 0,
                    totalRequests: 0,
                    totalTokens: 0,
                    averageCost: 0,
                    averageTokens: 0,
                    lastActivity: null
                }
            };
        } catch (error) {
            loggingService.error('Error getting connection stats', {
                component: 'AutomationService',
                operation: 'getConnectionStats',
                error: error instanceof Error ? error.message : String(error),
                connectionId,
                userId
            });
            throw error;
        }
    }
}

