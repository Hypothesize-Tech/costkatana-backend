/**
 * Model Mocks
 * Mock implementations of Mongoose models for testing
 */

/**
 * Mock ChatMessage Model
 */
export const mockChatMessage = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
    save: jest.fn(),
    populate: jest.fn().mockReturnThis()
};

/**
 * Mock Conversation Model
 */
export const mockConversation = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
    save: jest.fn(),
    populate: jest.fn().mockReturnThis()
};

/**
 * Mock Document Model
 */
export const mockDocumentModel = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn()
};

/**
 * Mock Integration Model
 */
export const mockIntegration = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn()
};

/**
 * Mock Task Model
 */
export const mockTask = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn()
};

/**
 * Setup all model mocks
 */
export const setupModelMocks = () => {
    jest.mock('@models/index', () => ({
        ChatMessage: mockChatMessage,
        Conversation: mockConversation,
        Integration: mockIntegration,
        Task: mockTask
    }));
    
    jest.mock('@models/Document', () => ({
        DocumentModel: mockDocumentModel
    }));
};

/**
 * Reset all model mocks
 */
export const resetModelMocks = () => {
    Object.values(mockChatMessage).forEach(fn => {
        if (typeof fn === 'function' && fn.mockClear) {
            fn.mockClear();
        }
    });
    
    Object.values(mockConversation).forEach(fn => {
        if (typeof fn === 'function' && fn.mockClear) {
            fn.mockClear();
        }
    });
    
    Object.values(mockDocumentModel).forEach(fn => {
        if (typeof fn === 'function' && fn.mockClear) {
            fn.mockClear();
        }
    });
};
