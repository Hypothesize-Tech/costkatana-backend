/**
 * Handler Types
 * Type definitions for route handlers and processing logic
 */

import { IConversation } from '../../../../models';

export interface HandlerRequest {
    userId: string;
    message?: string;
    originalMessage?: string;
    modelId: string;
    conversationId?: string;
    temperature?: number;
    maxTokens?: number;
    chatMode?: 'fastest' | 'cheapest' | 'balanced';
    useMultiAgent?: boolean;
    useWebSearch?: boolean;
    documentIds?: string[];
    githubContext?: {
        connectionId: string;
        repositoryId: number;
        repositoryName: string;
        repositoryFullName: string;
    };
    vercelContext?: {
        connectionId: string;
        projectId: string;
        projectName: string;
    };
    mongodbContext?: {
        connectionId: string;
        activeDatabase?: string;
        activeCollection?: string;
    };
    templateId?: string;
    templateVariables?: Record<string, any>;
    attachments?: Array<{
        type: 'uploaded' | 'google';
        fileId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        fileType: string;
        url: string;
    }>;
    req?: any;
    selectionResponse?: {
        parameterName: string;
        value: string | number | boolean;
        pendingAction: string;
        collectedParams: Record<string, unknown>;
        integration?: string;
    };
}

export interface HandlerResult {
    // Core response fields (always present)
    response: string;
    agentPath: string[];
    optimizationsApplied: string[];
    cacheHit: boolean;
    riskLevel: string;
    
    // Optional thinking/metadata
    agentThinking?: any;
    metadata?: any;
    
    // Web search specific
    webSearchUsed?: boolean;
    aiWebSearchDecision?: any;
    quotaUsed?: number;
    
    // Integration selector
    requiresIntegrationSelector?: boolean;
    integrationSelectorData?: any;
    requiresSelection?: boolean;
    selection?: any;
    
    // Integration-specific data
    mongodbIntegrationData?: any;
    formattedResult?: any;
    githubIntegrationData?: any;
    vercelIntegrationData?: any;
    googleIntegrationData?: any;
    slackIntegrationData?: any;
    discordIntegrationData?: any;
    jiraIntegrationData?: any;
    linearIntegrationData?: any;
    awsIntegrationData?: any;
    
    // Connection requirements
    requiresConnection?: {
        integration: string;
        message: string;
        connectUrl: string;
    };
    
    // Strategy formation
    strategyFormed?: any;
    autonomousActions?: string[];
    proactiveInsights?: string[];
}

export interface ProcessingContext {
    conversation: IConversation;
    recentMessages: any[];
    userId: string;
    messageLength: number;
}

export interface FallbackResult {
    response: string;
    agentPath: string[];
    optimizationsApplied: string[];
    cacheHit: boolean;
    riskLevel: string;
}
