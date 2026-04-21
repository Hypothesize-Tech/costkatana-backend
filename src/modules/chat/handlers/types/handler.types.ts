/**
 * Handler Types
 * Type definitions for route handlers and processing logic
 */

import { Conversation } from '../../../../schemas/chat/conversation.schema';

export interface HandlerRequest {
  userId: string;
  message?: string;
  originalMessage?: string;
  modelId: string;
  conversationId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional Bedrock system prompt override */
  system?: string;
  /** When false, omit system block entirely */
  useSystemPrompt?: boolean;
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
  slackContext?: Record<string, unknown>;
  discordContext?: Record<string, unknown>;
  jiraContext?: Record<string, unknown>;
  linearContext?: Record<string, unknown>;
  awsContext?: Record<string, unknown>;
  googleContext?: Record<string, unknown>;
  parsedMentions?: Array<{ type: string; id?: string; displayName?: string }>;
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
  thinking?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high' | 'max';
    budgetTokens?: number;
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

  // Extended thinking (reasoning) output from Claude on Bedrock
  reasoning?: {
    content: string;
    mode?: 'adaptive' | 'enabled';
    effort?: 'low' | 'medium' | 'high' | 'max';
    budgetTokens?: number;
  };

  // Tool call history produced during streamed tool-use loops
  toolCalls?: Array<{
    id: string;
    name: string;
    input: unknown;
    output?: {
      content: string;
      sources?: Array<{ title: string; url: string; description?: string }>;
      data?: unknown;
    };
    status: 'success' | 'error';
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
  }>;
  // Aggregated source citations across all tool results
  sources?: Array<{ title: string; url: string; description?: string }>;

  // Success indicator
  success?: boolean;
  error?: string;
}

export interface ProcessingContext {
  conversation?: Conversation;
  recentMessages: any[];
  userId: string;
  messageLength?: number;
}

export interface FallbackResult {
  response: string;
  agentPath: string[];
  optimizationsApplied: string[];
  cacheHit: boolean;
  riskLevel: string;
}
