/**
 * Service Mocks
 * Mock implementations of external services for testing
 */

/**
 * Mock Logging Service
 */
export const mockLoggingService = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logBusinessEvent: jest.fn(),
    logSecurityEvent: jest.fn()
};

/**
 * Mock Bedrock Service
 */
export const mockBedrockService = {
    invokeModel: jest.fn().mockResolvedValue({
        content: [{ text: 'Mock AI response from Bedrock' }],
        stopReason: 'end_turn',
        usage: {
            inputTokens: 100,
            outputTokens: 50
        }
    }),
    invokeModelStream: jest.fn()
};

/**
 * Mock Google Service
 */
export const mockGoogleService = {
    getFileContent: jest.fn().mockResolvedValue('Mock file content'),
    listFiles: jest.fn().mockResolvedValue([]),
    getFileMetadata: jest.fn().mockResolvedValue({
        name: 'test.txt',
        mimeType: 'text/plain',
        size: '1024'
    })
};

/**
 * Mock Text Extraction Service
 */
export const mockTextExtractionService = {
    extractTextFromFile: jest.fn().mockResolvedValue('Extracted text content'),
    extractTextFromPDF: jest.fn().mockResolvedValue('PDF text content'),
    extractTextFromImage: jest.fn().mockResolvedValue('Image text via OCR')
};

/**
 * Mock Google Search Service
 */
export const mockGoogleSearchService = {
    search: jest.fn().mockResolvedValue({
        searchResults: [
            {
                title: 'Test Result 1',
                link: 'https://example.com/1',
                snippet: 'Test snippet 1',
                content: 'Full content 1'
            },
            {
                title: 'Test Result 2',
                link: 'https://example.com/2',
                snippet: 'Test snippet 2',
                content: 'Full content 2'
            }
        ],
        quotaUsed: 1
    })
};

/**
 * Mock Multi-Agent Flow Service
 */
export const mockMultiAgentFlowService = {
    processMessage: jest.fn().mockResolvedValue({
        response: 'Multi-agent response',
        agentThinking: { steps: ['step1', 'step2'] },
        toolsUsed: ['tool1'],
        metadata: {}
    })
};

/**
 * Mock Conversational Flow Service
 */
export const mockConversationalFlowService = {
    processMessage: jest.fn().mockResolvedValue({
        response: 'Conversational response',
        thinking: 'Agent thinking process'
    })
};

/**
 * Mock Integration Chat Service
 */
export const mockIntegrationChatService = {
    processMessage: jest.fn().mockResolvedValue({
        response: 'Integration response',
        metadata: {}
    }),
    parseMentions: jest.fn().mockReturnValue([])
};

/**
 * Mock MCP Integration Handler
 */
export const mockMCPIntegrationHandler = {
    handleRequest: jest.fn().mockResolvedValue({
        response: 'MCP response',
        metadata: {}
    })
};

/**
 * Mock LLM Security Service
 */
export const mockLLMSecurityService = {
    performSecurityCheck: jest.fn().mockResolvedValue({
        isSafe: true,
        threats: [],
        riskLevel: 'low'
    })
};

/**
 * Mock Governed Agent Service
 */
export const mockGovernedAgentService = {
    initiateTask: jest.fn().mockResolvedValue({
        _id: 'task-id',
        id: 'task-id',
        status: 'initiated'
    })
};

/**
 * Setup all mocks
 * Call this in beforeEach() to reset all mocks
 */
export const setupMocks = () => {
    jest.clearAllMocks();
    
    // Mock logging service
    jest.mock('@services/logging.service', () => ({
        loggingService: mockLoggingService
    }));
    
    // Mock Bedrock service
    jest.mock('@services/tracedBedrock.service', () => ({
        BedrockService: mockBedrockService
    }));
    
    // Mock Google service
    jest.mock('@services/google.service', () => ({
        GoogleService: mockGoogleService
    }));
    
    // Mock text extraction service
    jest.mock('@services/textExtraction.service', () => ({
        TextExtractionService: mockTextExtractionService
    }));
};

/**
 * Reset all mocks
 * Call this in afterEach() to clean up
 */
export const resetMocks = () => {
    jest.resetAllMocks();
};
