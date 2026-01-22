/**
 * Global Test Factories
 * Generic factory functions for creating test data across all features
 * 
 * These factories are designed to be used by any controller/service test,
 * not just chat-specific tests. They provide a consistent way to create
 * mock data throughout the test suite.
 * 
 * @example
 * ```typescript
 * import { createMockRequest, createMockResponse, createMockUser } from '@tests/helpers/globalFactories';
 * 
 * const req = createMockRequest({ userId: 'test-user-id' });
 * const res = createMockResponse();
 * const user = createMockUser({ email: 'test@example.com' });
 * ```
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest, PaginationMeta } from '@utils/controllerHelper';

/**
 * Create mock Express Request object
 * 
 * @param overrides - Optional overrides for request properties
 * @returns Mock Request object
 * 
 */
export const createMockRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest => {
    return {
        userId: undefined,
        user: undefined,
        body: {},
        params: {},
        query: {},
        headers: {
            'x-request-id': 'test-request-id',
            'user-agent': 'jest-test'
        },
        path: '/test',
        method: 'GET',
        url: '/test',
        originalUrl: '/test',
        ip: '127.0.0.1',
        ...overrides
    } as AuthenticatedRequest;
};

/**
 * Create mock Express Response object
 * Includes jest mock functions for all response methods
 * 
 * @returns Mock Response object with jest functions
 * 
 */
export const createMockResponse = (): Response => {
    const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        sendStatus: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        cookie: jest.fn().mockReturnThis(),
        clearCookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        render: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
        locals: {},
        headersSent: false
    };
    return res as Response;
};

/**
 * Create mock User object
 * 
 * @param overrides - Optional overrides for user properties
 * @returns Mock User object
 * 
 */
export const createMockUser = (overrides: any = {}) => ({
    _id: 'test-user-id',
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    ...overrides
});

/**
 * Create mock Pagination metadata
 * 
 * @param overrides - Optional overrides for pagination properties
 * @returns Pagination metadata object
 * 
 */
export const createMockPagination = (overrides: Partial<PaginationMeta> = {}): PaginationMeta => ({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    ...overrides
});

/**
 * Create mock MongoDB document
 * Generic factory for any Mongoose model
 * 
 * @param overrides - Optional overrides for document properties
 * @returns Mock MongoDB document
 * 
 */
export const createMockDocument = (overrides: any = {}) => ({
    _id: 'mock-id',
    id: 'mock-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(this),
    remove: jest.fn().mockResolvedValue(this),
    delete: jest.fn().mockResolvedValue(this),
    toObject: jest.fn().mockReturnValue({ ...overrides }),
    toJSON: jest.fn().mockReturnValue({ ...overrides }),
    ...overrides
});

/**
 * Create mock Project object
 * 
 * @param overrides - Optional overrides for project properties
 * @returns Mock Project object
 */
export const createMockProject = (overrides: any = {}) => ({
    _id: 'test-project-id',
    id: 'test-project-id',
    name: 'Test Project',
    description: 'A test project',
    userId: 'test-user-id',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
});

/**
 * Create mock Integration object
 * 
 * @param overrides - Optional overrides for integration properties
 * @returns Mock Integration object
 */
export const createMockIntegration = (overrides: any = {}) => ({
    _id: 'test-integration-id',
    id: 'test-integration-id',
    type: 'github',
    name: 'Test Integration',
    userId: 'test-user-id',
    status: 'active',
    credentials: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
});

/**
 * Create mock Task object
 * 
 * @param overrides - Optional overrides for task properties
 * @returns Mock Task object
 */
export const createMockTask = (overrides: any = {}) => ({
    _id: 'test-task-id',
    id: 'test-task-id',
    title: 'Test Task',
    description: 'A test task',
    userId: 'test-user-id',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
});

/**
 * Create mock Error object
 * 
 * @param message - Error message
 * @param code - Optional error code
 * @returns Mock Error object
 * 
 */
export const createMockError = (message: string = 'Test error', code?: string) => {
    const error: any = new Error(message);
    if (code) error.code = code;
    error.stack = 'Error stack trace';
    return error;
};

/**
 * Create array of mock items
 * Useful for testing pagination and list operations
 * 
 * @param factory - Factory function to create individual items
 * @param count - Number of items to create
 * @param overrides - Optional overrides applied to each item
 * @returns Array of mock items
 * 
 */
export const createMockArray = <T>(
    factory: (overrides?: any) => T,
    count: number,
    overrides?: any
): T[] => {
    return Array.from({ length: count }, (_, i) => factory({
        ...overrides,
        _id: `mock-id-${i}`,
        id: `mock-id-${i}`
    }));
};

/**
 * Create mock API key
 * 
 * @param overrides - Optional overrides for API key properties
 * @returns Mock API key object
 */
export const createMockApiKey = (overrides: any = {}) => ({
    _id: 'test-apikey-id',
    id: 'test-apikey-id',
    key: 'test-api-key-value',
    name: 'Test API Key',
    userId: 'test-user-id',
    permissions: ['read'],
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides
});

/**
 * Create mock session object
 * 
 * @param overrides - Optional overrides for session properties
 * @returns Mock session object
 */
export const createMockSession = (overrides: any = {}) => ({
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    createdAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides
});

/**
 * Create mock file upload
 * 
 * @param overrides - Optional overrides for file properties
 * @returns Mock uploaded file object
 */
export const createMockFile = (overrides: any = {}) => ({
    fieldname: 'file',
    originalname: 'test.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    buffer: Buffer.from('test content'),
    size: 1024,
    ...overrides
});

/**
 * Create mock query parameters
 * 
 * @param overrides - Optional overrides for query parameters
 * @returns Mock query parameters object
 * 
 */
export const createMockQuery = (overrides: any = {}) => ({
    limit: '20',
    offset: '0',
    page: '1',
    sort: 'createdAt:desc',
    ...overrides
});

/**
 * Create mock date range
 * 
 * @param daysAgo - Number of days ago for start date (default: 7)
 * @returns Object with startDate and endDate
 * 
 */
export const createMockDateRange = (daysAgo: number = 7) => ({
    startDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date().toISOString()
});

/**
 * Wait for a specified time
 * Useful for testing async operations
 * 
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after specified time
 * 
 */
export const wait = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Type exports for TypeScript
 */
export type MockRequest = ReturnType<typeof createMockRequest>;
export type MockResponse = ReturnType<typeof createMockResponse>;
export type MockUser = ReturnType<typeof createMockUser>;
export type MockProject = ReturnType<typeof createMockProject>;
export type MockIntegration = ReturnType<typeof createMockIntegration>;
export type MockTask = ReturnType<typeof createMockTask>;
