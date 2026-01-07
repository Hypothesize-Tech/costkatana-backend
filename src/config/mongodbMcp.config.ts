/**
 * MongoDB MCP Configuration
 * 
 * Configuration for MongoDB MCP server operations
 */

export const MongoDBMCPConfig = {
    // Query limits
    MAX_DOCUMENTS: parseInt('500', 10),
    MAX_TIMEOUT_MS: parseInt('8000', 10),
    MAX_RESPONSE_SIZE_MB: parseInt('16', 10),

    // Connection settings
    CONNECTION_IDLE_TIMEOUT: parseInt('600000', 10), // 10 minutes
    CONNECTION_POOL_CLEANUP_INTERVAL: parseInt('300000', 10), // 5 minutes
    
    // Credential settings
    CREDENTIAL_TTL: parseInt('3600000', 10), // 1 hour
    CREDENTIAL_REFRESH_BUFFER: parseInt('300000', 10), // 5 minutes

    // Security
    ENCRYPTION_KEY: process.env.JWT_SECRET ?? '',
    
    // Blocked operators (dangerous MongoDB operations)
    BLOCKED_OPERATORS: [
        '$where',
        '$function',
        '$accumulator',
        '$eval',
        'mapReduce',
        '$expr', // Can contain JavaScript
        'function', // JavaScript functions
    ],

    // Default fields to redact from responses
    REDACTED_FIELDS: [
        'password',
        'passwordHash',
        'encryptedKey',
        'accessToken',
        'refreshToken',
        'apiKey',
        'secret',
        'privateKey',
        'resetPasswordToken',
        'verificationToken',
        'sessionToken',
        'creditCard',
        'ssn',
        'taxId',
    ],

    // Rate limiting
    RATE_LIMIT: {
        MAX_REQUESTS: parseInt('100', 10),
        WINDOW_MS: parseInt('60000', 10), // 1 minute
    },

    // Circuit breaker
    CIRCUIT_BREAKER: {
        THRESHOLD: parseInt('5', 10), // Failures before opening
        TIMEOUT_MS: parseInt('60000', 10), // 1 minute
        RESET_MS: parseInt('300000', 10), // 5 minutes
    },

    // Logging
    LOG_QUERIES: false,
    LOG_RESULTS: false,
};

// Validation
if (!MongoDBMCPConfig.ENCRYPTION_KEY || MongoDBMCPConfig.ENCRYPTION_KEY === 'default-key-change-me') {
    console.warn('WARNING: MongoDB MCP encryption key not properly configured. Set JWT_SECRET.');
}
