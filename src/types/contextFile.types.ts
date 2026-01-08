/**
 * Context File Types
 * Type definitions for file-based context discovery system
 */

export interface ToolDefinition {
    name: string;
    description: string;
    category: string;
    inputSchema: Record<string, unknown>;
    status: 'active' | 'inactive' | 'needs_auth' | 'error';
    statusMessage?: string;
    metadata?: {
        provider?: string;
        version?: string;
        lastSynced?: Date;
    };
}

export interface ToolRegistryConfig {
    toolsDirectory: string;
    enableSync: boolean;
    syncInterval?: number;
}

export interface FileReference {
    type: 'file_reference';
    path: string;
    relativePath: string;
    size: number;
    summary?: string;
    instructions?: string;
    metadata?: {
        toolName?: string;
        userId?: string;
        requestId?: string;
        createdAt: Date;
    };
}

export interface ContextFileMetadata {
    userId: string;
    requestId?: string;
    conversationId?: string;
    toolName?: string;
    type: 'response' | 'conversation' | 'summary';
    format: 'json' | 'markdown' | 'text';
    size: number;
    createdAt: Date;
    expiresAt?: Date;
}

export interface ConversationHistoryFile {
    conversationId: string;
    userId: string;
    filePath: string;
    messageCount: number;
    format: 'markdown' | 'json';
    createdAt: Date;
}

export interface FileCleanupConfig {
    ttl: number; // Time to live in milliseconds
    maxFiles: number;
    cleanupInterval: number;
}

export interface ToolSyncResult {
    success: boolean;
    toolsWritten: number;
    errors: Array<{ tool: string; error: string }>;
    directory: string;
}
