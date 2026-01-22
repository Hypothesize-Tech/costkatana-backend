/**
 * Test Factories
 * Factory functions for creating test data
 */

import {
    HandlerRequest,
    HandlerResult,
    ProcessingContext
} from '@services/chat/handlers/types/handler.types';
import {
    ConversationContext,
    ExtractedEntities
} from '@services/chat/context/types/context.types';
import {
    RouteType,
    IntegrationIntent,
    ConnectionStatus
} from '@services/chat/routing/types/routing.types';

/**
 * Create mock HandlerRequest
 */
export const createMockHandlerRequest = (overrides: Partial<HandlerRequest> = {}): HandlerRequest => ({
    userId: 'test-user-id',
    message: 'test message',
    modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    conversationId: 'test-conversation-id',
    temperature: 0.7,
    maxTokens: 4096,
    chatMode: 'balanced',
    useMultiAgent: false,
    useWebSearch: false,
    documentIds: [],
    attachments: [],
    ...overrides
});

/**
 * Create mock ConversationContext
 */
export const createMockConversationContext = (
    overrides: Partial<ConversationContext> = {}
): ConversationContext => ({
    conversationId: 'test-conversation-id',
    currentSubject: 'testing',
    currentIntent: 'query',
    lastReferencedEntities: [],
    lastDomain: 'general',
    languageFramework: undefined,
    subjectConfidence: 0.8,
    timestamp: new Date(),
    ...overrides
});

/**
 * Create mock HandlerResult
 */
export const createMockHandlerResult = (overrides: Partial<HandlerResult> = {}): HandlerResult => ({
    response: 'Mock response',
    agentPath: ['test_handler'],
    optimizationsApplied: [],
    cacheHit: false,
    riskLevel: 'low',
    ...overrides
});

/**
 * Create mock recent messages
 */
export const createMockRecentMessages = (count: number = 3): any[] => {
    return Array.from({ length: count }, (_, i) => ({
        _id: `message-${i}`,
        content: `Message ${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        timestamp: new Date(Date.now() - (count - i) * 60000)
    }));
};

/**
 * Create mock ExtractedEntities
 */
export const createMockExtractedEntities = (
    overrides: Partial<ExtractedEntities> = {}
): ExtractedEntities => ({
    codeReferences: [],
    fileReferences: [],
    toolMentions: [],
    technicalTerms: [],
    timestamps: [],
    numbers: [],
    ...overrides
});

/**
 * Create mock IntegrationIntent
 */
export const createMockIntegrationIntent = (
    overrides: Partial<IntegrationIntent> = {}
): IntegrationIntent => ({
    detected: false,
    integration: undefined,
    confidence: 0,
    reasoning: 'No integration detected',
    ...overrides
});

/**
 * Create mock ConnectionStatus
 */
export const createMockConnectionStatus = (
    overrides: Partial<ConnectionStatus> = {}
): ConnectionStatus => ({
    hasConnection: false,
    integration: 'github',
    connectionId: undefined,
    metadata: {},
    ...overrides
});

/**
 * Create mock conversation document
 */
export const createMockConversation = (overrides: any = {}) => ({
    _id: 'test-conversation-id',
    userId: 'test-user-id',
    title: 'Test Conversation',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    archived: false,
    pinned: false,
    save: jest.fn().mockResolvedValue(this),
    ...overrides
});

/**
 * Create mock chat message document
 */
export const createMockChatMessage = (overrides: any = {}) => ({
    _id: 'test-message-id',
    conversationId: 'test-conversation-id',
    userId: 'test-user-id',
    role: 'user',
    content: 'Test message',
    timestamp: new Date(),
    save: jest.fn().mockResolvedValue(this),
    ...overrides
});

/**
 * Create mock attachment
 */
export const createMockAttachment = (overrides: any = {}) => ({
    type: 'uploaded' as const,
    fileId: 'test-file-id',
    fileName: 'test.txt',
    fileSize: 1024,
    mimeType: 'text/plain',
    fileType: 'text',
    url: 'https://example.com/test.txt',
    ...overrides
});

/**
 * Create mock GitHub context
 */
export const createMockGithubContext = (overrides: any = {}) => ({
    connectionId: 'github-connection-id',
    repositoryId: 12345,
    repositoryName: 'test-repo',
    repositoryFullName: 'testuser/test-repo',
    ...overrides
});

/**
 * Create mock Vercel context
 */
export const createMockVercelContext = (overrides: any = {}) => ({
    connectionId: 'vercel-connection-id',
    projectId: 'prj_123',
    projectName: 'test-project',
    ...overrides
});

/**
 * Create mock MongoDB context
 */
export const createMockMongodbContext = (overrides: any = {}) => ({
    connectionId: 'mongodb-connection-id',
    activeDatabase: 'test-db',
    activeCollection: 'test-collection',
    ...overrides
});

/**
 * Sleep utility for async tests
 */
export const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create mock processing context
 */
export const createMockProcessingContext = (
    overrides: Partial<ProcessingContext> = {}
): ProcessingContext => ({
    conversation: createMockConversation(),
    recentMessages: createMockRecentMessages(),
    userId: 'test-user-id',
    messageLength: 100,
    ...overrides
});
