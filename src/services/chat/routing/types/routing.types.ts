/**
 * Routing Types
 * Types for routing decisions, integration detection, and connection checking
 */

import { IntegrationType } from '../../../../mcp/types/permission.types';

export type RouteType = 'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper';

export interface RouteDecision {
    route: RouteType;
    confidence: number;
    reasoning?: string;
}

export interface IntegrationIntent {
    needsIntegration: boolean;
    integrations: IntegrationType[];
    suggestedTools: string[];
    confidence: number;
}

export interface ConnectionStatus {
    isConnected: boolean;
    connectionId?: string;
    connectionName?: string;
}

export interface RouterContext {
    userId: string;
    hasVercelConnection: boolean;
    hasGithubConnection: boolean;
    hasGoogleConnection: boolean;
    conversationSubject?: string;
}

export interface ContextSizeConfig {
    simple: number;
    medium: number;
    complex: number;
}
