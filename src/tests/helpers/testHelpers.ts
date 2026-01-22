/**
 * Test Helpers
 * Utility functions for setup, teardown, and assertions in tests
 * 
 * These helpers provide a consistent way to setup test environments,
 * make common assertions, and handle test lifecycle across all test files.
 * 
 */

import { Response } from 'express';
import { setupAllMocks, resetAllMocks } from '../mocks/globalMocks';

// ============================================================
// SETUP AND TEARDOWN
// ============================================================

/**
 * Setup test environment
 * Initializes all mocks and prepares test environment
 * Call this in beforeEach()
 * 
 * @param options - Optional setup configuration
 * 
 */
export const setupTest = (options: {
    mockTimers?: boolean;
    mockDate?: Date;
} = {}) => {
    // Setup all mocks
    setupAllMocks();

    // Mock timers if requested
    if (options.mockTimers) {
        jest.useFakeTimers();
    }

    // Mock date if provided
    if (options.mockDate) {
        jest.setSystemTime(options.mockDate);
    }

    // Reset module registry to ensure clean state
    jest.resetModules();
};

/**
 * Teardown test environment
 * Cleans up mocks and restores original state
 * Call this in afterEach()
 * 
 */
export const teardownTest = () => {
    // Reset all mocks
    resetAllMocks();

    // Restore real timers if they were mocked
    if (jest.isMockFunction(setTimeout)) {
        jest.useRealTimers();
    }

    // Clear all timers
    jest.clearAllTimers();
};

// ============================================================
// RESPONSE ASSERTIONS
// ============================================================

/**
 * Assert that response indicates success
 * Checks status code and success field
 * 
 * @param res - Response object (mock)
 * @param expectedData - Optional expected data in response
 * @param expectedStatus - Expected status code (default: 200)
 * 
 */
export const expectSuccess = (
    res: any,
    expectedData?: any,
    expectedStatus: number = 200
) => {
    // Check status code was called
    if (expectedStatus !== 200) {
        expect(res.status).toHaveBeenCalledWith(expectedStatus);
    }

    // Check json response
    expect(res.json).toHaveBeenCalled();
    const jsonCall = res.json.mock.calls[0][0];

    // Check success field
    expect(jsonCall).toHaveProperty('success', true);

    // Check data if provided
    if (expectedData !== undefined) {
        expect(jsonCall).toHaveProperty('data');
        if (expectedData !== null) {
            expect(jsonCall.data).toEqual(expectedData);
        }
    }
};

/**
 * Assert that response indicates error
 * Checks status code, success field, and error message
 * 
 * @param res - Response object (mock)
 * @param expectedStatus - Expected error status code
 * @param expectedMessage - Optional expected error message (can be substring)
 * 
 */
export const expectError = (
    res: any,
    expectedStatus: number,
    expectedMessage?: string
) => {
    // Check status code
    expect(res.status).toHaveBeenCalledWith(expectedStatus);

    // Check json response
    expect(res.json).toHaveBeenCalled();
    const jsonCall = res.json.mock.calls[0][0];

    // Check success field is false
    expect(jsonCall).toHaveProperty('success', false);

    // Check message field exists
    expect(jsonCall).toHaveProperty('message');

    // Check message content if provided
    if (expectedMessage) {
        expect(jsonCall.message).toContain(expectedMessage);
    }
};

/**
 * Assert that response has pagination
 * Checks for pagination metadata
 * 
 * @param res - Response object (mock)
 * @param expectedTotal - Optional expected total count
 * 
 */
export const expectPagination = (res: any, expectedTotal?: number) => {
    expect(res.json).toHaveBeenCalled();
    const jsonCall = res.json.mock.calls[0][0];

    // Check pagination object exists
    expect(jsonCall).toHaveProperty('pagination');
    expect(jsonCall.pagination).toHaveProperty('total');
    expect(jsonCall.pagination).toHaveProperty('page');
    expect(jsonCall.pagination).toHaveProperty('limit');
    expect(jsonCall.pagination).toHaveProperty('totalPages');

    // Check total if provided
    if (expectedTotal !== undefined) {
        expect(jsonCall.pagination.total).toBe(expectedTotal);
    }
};

/**
 * Assert that response was redirected
 * 
 * @param res - Response object (mock)
 * @param expectedUrl - Expected redirect URL
 * @param expectedStatus - Expected redirect status (default: 302)
 * 
 */
export const expectRedirect = (
    res: any,
    expectedUrl: string,
    expectedStatus: number = 302
) => {
    if (expectedStatus !== 302) {
        expect(res.status).toHaveBeenCalledWith(expectedStatus);
    }
    expect(res.redirect).toHaveBeenCalledWith(expectedUrl);
};

// ============================================================
// MOCK ASSERTIONS
// ============================================================

/**
 * Assert that a service method was called
 * 
 * @param serviceMock - Service mock object
 * @param methodName - Method name
 * @param expectedArgs - Optional expected arguments
 * 
 */
export const expectServiceCalled = (
    serviceMock: any,
    methodName: string,
    expectedArgs?: any[]
) => {
    expect(serviceMock[methodName]).toHaveBeenCalled();
    
    if (expectedArgs) {
        expect(serviceMock[methodName]).toHaveBeenCalledWith(...expectedArgs);
    }
};

/**
 * Assert that a service method was NOT called
 * 
 * @param serviceMock - Service mock object
 * @param methodName - Method name
 * 
 * @example
 * ```typescript
 * expectServiceNotCalled(mockEmailService, 'sendEmail');
 * ```
 */
export const expectServiceNotCalled = (
    serviceMock: any,
    methodName: string
) => {
    expect(serviceMock[methodName]).not.toHaveBeenCalled();
};

/**
 * Assert that a model method was called with specific query
 * 
 * @param modelMock - Model mock object
 * @param methodName - Method name (e.g., 'findOne', 'create')
 * @param expectedQuery - Optional expected query object
 * 
 */
export const expectModelCalled = (
    modelMock: any,
    methodName: string,
    expectedQuery?: any
) => {
    expect(modelMock[methodName]).toHaveBeenCalled();
    
    if (expectedQuery) {
        expect(modelMock[methodName]).toHaveBeenCalledWith(
            expect.objectContaining(expectedQuery)
        );
    }
};

// ============================================================
// VALIDATION ASSERTIONS
// ============================================================

/**
 * Assert that validation errors were returned
 * 
 * @param res - Response object (mock)
 * @param expectedErrors - Optional array of expected error field names
 * 
 */
export const expectValidationErrors = (
    res: any,
    expectedErrors?: string[]
) => {
    expectError(res, 400);
    
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall).toHaveProperty('errors');
    expect(Array.isArray(jsonCall.errors)).toBe(true);
    expect(jsonCall.errors.length).toBeGreaterThan(0);

    if (expectedErrors) {
        const errorFields = jsonCall.errors.map((e: any) => e.field || e.path);
        expectedErrors.forEach(field => {
            expect(errorFields).toContain(field);
        });
    }
};

// ============================================================
// AUTHENTICATION ASSERTIONS
// ============================================================

/**
 * Assert that unauthorized response was sent
 * 
 * @param res - Response object (mock)
 * 
 */
export const expectUnauthorized = (res: any) => {
    expectError(res, 401, 'Authentication required');
};

/**
 * Assert that forbidden response was sent
 * 
 * @param res - Response object (mock)
 * 
 */
export const expectForbidden = (res: any) => {
    expectError(res, 403);
};

/**
 * Assert that not found response was sent
 * 
 * @param res - Response object (mock)
 * 
 */
export const expectNotFound = (res: any) => {
    expectError(res, 404);
};

// ============================================================
// ASYNC UTILITIES
// ============================================================

/**
 * Wait for all pending promises to resolve
 * Useful for testing async operations
 * 
 */
export const flushPromises = (): Promise<void> => {
    return new Promise(resolve => setImmediate(resolve));
};

/**
 * Wait for a specific time
 * 
 * @param ms - Milliseconds to wait
 * 
 */
export const wait = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Advance timers by specified time
 * Only works when fake timers are enabled
 * 
 * @param ms - Milliseconds to advance
 * 
 */
export const advanceTimers = (ms: number): void => {
    jest.advanceTimersByTime(ms);
};

/**
 * Run all pending timers
 * Only works when fake timers are enabled
 * 
 */
export const runAllTimers = (): void => {
    jest.runAllTimers();
};

// ============================================================
// CUSTOM MATCHERS
// ============================================================

/**
 * Expect value to be a valid MongoDB ObjectId
 * 
 * @param value - Value to check
 * 
 */
export const expectValidObjectId = (value: any) => {
    expect(value).toMatch(/^[0-9a-fA-F]{24}$/);
};

/**
 * Expect value to be a valid ISO8601 date string
 * 
 * @param value - Value to check
 * 
 */
export const expectValidISODate = (value: any) => {
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(value).toString()).not.toBe('Invalid Date');
};

/**
 * Expect value to be a valid email
 * 
 * @param value - Value to check
 * 
 */
export const expectValidEmail = (value: any) => {
    expect(value).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
};

/**
 * Expect value to be a valid URL
 * 
 * @param value - Value to check
 * 
 */
export const expectValidUrl = (value: any) => {
    expect(() => new URL(value)).not.toThrow();
};

// ============================================================
// SNAPSHOT TESTING HELPERS
// ============================================================

/**
 * Create snapshot of response data
 * Useful for API response testing
 * 
 * @param res - Response object (mock)
 * 
 */
export const expectResponseSnapshot = (res: any) => {
    expect(res.json).toHaveBeenCalled();
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall).toMatchSnapshot();
};

/**
 * Create snapshot with dynamic fields removed
 * Removes timestamps, IDs, etc. for consistent snapshots
 * 
 * @param data - Data object to snapshot
 * @param dynamicFields - Fields to remove (default: common dynamic fields)
 * 
 */
export const expectSnapshotWithoutDynamicFields = (
    data: any,
    dynamicFields: string[] = ['_id', 'id', 'createdAt', 'updatedAt', 'timestamp']
) => {
    const sanitized = JSON.parse(JSON.stringify(data));
    
    const removeDynamicFields = (obj: any) => {
        if (Array.isArray(obj)) {
            obj.forEach(removeDynamicFields);
        } else if (obj && typeof obj === 'object') {
            dynamicFields.forEach(field => delete obj[field]);
            Object.values(obj).forEach(removeDynamicFields);
        }
    };
    
    removeDynamicFields(sanitized);
    expect(sanitized).toMatchSnapshot();
};
