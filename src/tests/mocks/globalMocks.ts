/**
 * Global Mocks
 * Comprehensive mock implementations for services and models
 * 
 * These mocks are designed to be used across all test files,
 * providing consistent behavior for common services and models.
 * 
 */

/**
 * Mock Logging Service
 * Comprehensive logging service mock with all methods
 */
export const mockLoggingService = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logBusiness: jest.fn(),
    logSecurity: jest.fn(),
    logPerformance: jest.fn(),
    logAPI: jest.fn()
};

/**
 * Mock Auth Service
 * Authentication and authorization mock
 */
export const mockAuthService = {
    verifyToken: jest.fn().mockResolvedValue({ userId: 'test-user-id' }),
    generateToken: jest.fn().mockResolvedValue('mock-jwt-token'),
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    comparePassword: jest.fn().mockResolvedValue(true),
    validateSession: jest.fn().mockResolvedValue(true)
};

/**
 * Mock S3 Service
 * AWS S3 operations mock
 */
export const mockS3Service = {
    uploadFile: jest.fn().mockResolvedValue({
        key: 'mock-file-key',
        url: 'https://s3.amazonaws.com/bucket/mock-file-key',
        size: 1024
    }),
    deleteFile: jest.fn().mockResolvedValue({ success: true }),
    getSignedUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/signed-url'),
    listFiles: jest.fn().mockResolvedValue([]),
    getFile: jest.fn().mockResolvedValue(Buffer.from('mock file content'))
};

/**
 * Mock Email Service
 * Email sending mock
 */
export const mockEmailService = {
    sendEmail: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
    sendTemplateEmail: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
    sendBulkEmail: jest.fn().mockResolvedValue({ sent: 10, failed: 0 })
};

/**
 * Mock Notification Service
 * Push notifications and alerts mock
 */
export const mockNotificationService = {
    sendNotification: jest.fn().mockResolvedValue({ success: true }),
    sendPush: jest.fn().mockResolvedValue({ success: true }),
    sendAlert: jest.fn().mockResolvedValue({ success: true }),
    markAsRead: jest.fn().mockResolvedValue({ success: true })
};

/**
 * Mock Google Service
 * Google APIs mock (Drive, Calendar, etc.)
 */
export const mockGoogleService = {
    getFileContent: jest.fn().mockResolvedValue('Mock file content'),
    listFiles: jest.fn().mockResolvedValue([]),
    getFileMetadata: jest.fn().mockResolvedValue({
        name: 'test.txt',
        mimeType: 'text/plain',
        size: '1024'
    }),
    uploadFile: jest.fn().mockResolvedValue({ fileId: 'mock-file-id' }),
    deleteFile: jest.fn().mockResolvedValue({ success: true })
};

/**
 * Mock Bedrock Service
 * AWS Bedrock AI service mock
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
 * Mock Integration Service
 * Integration management mock
 */
export const mockIntegrationService = {
    createIntegration: jest.fn().mockResolvedValue({
        _id: 'integration-id',
        type: 'github',
        status: 'active'
    }),
    getIntegration: jest.fn().mockResolvedValue(null),
    updateIntegration: jest.fn().mockResolvedValue({ success: true }),
    deleteIntegration: jest.fn().mockResolvedValue({ success: true }),
    testConnection: jest.fn().mockResolvedValue({ success: true })
};

/**
 * Mock Payment Service
 * Payment processing mock
 */
export const mockPaymentService = {
    createPayment: jest.fn().mockResolvedValue({
        paymentId: 'payment-id',
        status: 'succeeded'
    }),
    refundPayment: jest.fn().mockResolvedValue({ success: true }),
    getPayment: jest.fn().mockResolvedValue({
        paymentId: 'payment-id',
        amount: 1000,
        status: 'succeeded'
    })
};

/**
 * Mock Subscription Service
 * Subscription management mock
 */
export const mockSubscriptionService = {
    createSubscription: jest.fn().mockResolvedValue({
        subscriptionId: 'sub-id',
        status: 'active'
    }),
    cancelSubscription: jest.fn().mockResolvedValue({ success: true }),
    updateSubscription: jest.fn().mockResolvedValue({ success: true }),
    getSubscription: jest.fn().mockResolvedValue({
        subscriptionId: 'sub-id',
        status: 'active',
        plan: 'premium'
    })
};

/**
 * Mock Text Extraction Service
 * File content extraction mock
 */
export const mockTextExtractionService = {
    extractTextFromFile: jest.fn().mockResolvedValue('Extracted text content'),
    extractTextFromPDF: jest.fn().mockResolvedValue('PDF text content'),
    extractTextFromImage: jest.fn().mockResolvedValue('Image text via OCR'),
    extractTextFromDocx: jest.fn().mockResolvedValue('Word document text')
};

/**
 * Mock Google Search Service
 * Web search mock
 */
export const mockGoogleSearchService = {
    search: jest.fn().mockResolvedValue({
        searchResults: [
            {
                title: 'Test Result 1',
                link: 'https://example.com/1',
                snippet: 'Test snippet 1',
                content: 'Full content 1'
            }
        ],
        quotaUsed: 1
    })
};

// ============================================================
// MODEL MOCKS
// ============================================================

/**
 * Create mock Mongoose model
 * Generic factory for any Mongoose model mock
 */
const createMockModel = () => ({
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    findByIdAndUpdate: jest.fn().mockReturnThis(),
    findByIdAndDelete: jest.fn().mockReturnThis(),
    findOneAndUpdate: jest.fn().mockReturnThis(),
    findOneAndDelete: jest.fn().mockReturnThis(),
    create: jest.fn(),
    insertMany: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    deleteOne: jest.fn()
});

/**
 * Mock User Model
 */
export const mockUserModel = createMockModel();

/**
 * Mock Project Model
 */
export const mockProjectModel = createMockModel();

/**
 * Mock Integration Model
 */
export const mockIntegrationModel = createMockModel();

/**
 * Mock Task Model
 */
export const mockTaskModel = createMockModel();

/**
 * Mock Conversation Model
 */
export const mockConversationModel = createMockModel();

/**
 * Mock ChatMessage Model
 */
export const mockChatMessageModel = createMockModel();

/**
 * Mock Document Model
 */
export const mockDocumentModel = createMockModel();

/**
 * Mock Alert Model
 */
export const mockAlertModel = createMockModel();

/**
 * Mock ApiKey Model
 */
export const mockApiKeyModel = createMockModel();

/**
 * Mock Session Model
 */
export const mockSessionModel = createMockModel();

/**
 * Mock Payment Model
 */
export const mockPaymentModel = createMockModel();

/**
 * Mock Subscription Model
 */
export const mockSubscriptionModel = createMockModel();

// ============================================================
// SETUP AND TEARDOWN
// ============================================================

/**
 * Setup all service mocks
 * Call this in beforeEach() to initialize all service mocks
 */
export const setupServiceMocks = () => {
    jest.mock('@services/logging.service', () => ({
        loggingService: mockLoggingService
    }));

    jest.mock('@services/auth.service', () => ({
        AuthService: mockAuthService
    }));

    jest.mock('@services/s3.service', () => ({
        S3Service: mockS3Service
    }));

    jest.mock('@services/email.service', () => ({
        EmailService: mockEmailService
    }));

    jest.mock('@services/notification.service', () => ({
        NotificationService: mockNotificationService
    }));

    jest.mock('@services/google.service', () => ({
        GoogleService: mockGoogleService
    }));

    jest.mock('@services/tracedBedrock.service', () => ({
        BedrockService: mockBedrockService
    }));

    jest.mock('@services/integration.service', () => ({
        IntegrationService: mockIntegrationService
    }));

    jest.mock('@services/textExtraction.service', () => ({
        TextExtractionService: mockTextExtractionService
    }));

    jest.mock('@services/googleSearch.service', () => ({
        googleSearchService: mockGoogleSearchService
    }));
};

/**
 * Setup all model mocks
 * Call this in beforeEach() to initialize all model mocks
 */
export const setupModelMocks = () => {
    jest.mock('@models/index', () => ({
        User: mockUserModel,
        Project: mockProjectModel,
        Integration: mockIntegrationModel,
        Task: mockTaskModel,
        Conversation: mockConversationModel,
        ChatMessage: mockChatMessageModel,
        Alert: mockAlertModel,
        ApiKey: mockApiKeyModel,
        Session: mockSessionModel,
        Payment: mockPaymentModel,
        Subscription: mockSubscriptionModel
    }));

    jest.mock('@models/Document', () => ({
        DocumentModel: mockDocumentModel
    }));
};

/**
 * Setup all mocks (services + models)
 * Convenience function to setup everything at once
 * 
 * @example
 * ```typescript
 * beforeEach(() => {
 *   setupAllMocks();
 * });
 * ```
 */
export const setupAllMocks = () => {
    setupServiceMocks();
    setupModelMocks();
};

/**
 * Reset all mocks
 * Call this in afterEach() to clean up
 * 
 * @example
 * ```typescript
 * afterEach(() => {
 *   resetAllMocks();
 * });
 * ```
 */
export const resetAllMocks = () => {
    jest.clearAllMocks();
    jest.resetAllMocks();
};

/**
 * Clear specific service mock
 * 
 * @param serviceMock - Service mock to clear
 * 
 * @example
 * ```typescript
 * clearServiceMock(mockLoggingService);
 * ```
 */
export const clearServiceMock = (serviceMock: any) => {
    Object.values(serviceMock).forEach((fn: any) => {
        if (typeof fn === 'function' && fn.mockClear) {
            fn.mockClear();
        }
    });
};

/**
 * Clear specific model mock
 * 
 * @param modelMock - Model mock to clear
 * 
 * @example
 * ```typescript
 * clearModelMock(mockUserModel);
 * ```
 */
export const clearModelMock = (modelMock: any) => {
    Object.values(modelMock).forEach((fn: any) => {
        if (typeof fn === 'function' && fn.mockClear) {
            fn.mockClear();
        }
    });
};
