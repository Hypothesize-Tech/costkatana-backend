import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

// Encryption/Decryption for API keys
const algorithm = 'aes-256-gcm';
const keyLength = 32;

export const encrypt = (
  text: string,
  configService?: ConfigService,
): { encrypted: string; iv: string; authTag: string } => {
  // Get encryption key from config or use default
  const keyString =
    configService?.get('ENCRYPTION_KEY') ||
    'default-encryption-key-for-development-only';
  const key = Buffer.from(keyString.padEnd(keyLength, '0').slice(0, keyLength));

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
};

export const decrypt = (
  encrypted: string,
  iv: string,
  authTag: string,
  configService?: ConfigService,
): string => {
  // Get encryption key from config or use default
  const keyString =
    configService?.get('ENCRYPTION_KEY') ||
    'default-encryption-key-for-development-only';
  const key = Buffer.from(keyString.padEnd(keyLength, '0').slice(0, keyLength));

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(iv, 'hex'),
  );

  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

// Generate random tokens
export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

// Calculate date ranges
export const getDateRange = (
  period: 'daily' | 'weekly' | 'monthly',
  date: Date = new Date(),
) => {
  const start = new Date(date);
  const end = new Date(date);

  switch (period) {
    case 'daily':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'weekly':
      const day = start.getDay();
      const diff = start.getDate() - day;
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'monthly':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
};

// Format currency
export const formatCurrency = (
  amount: number,
  currency: string = 'USD',
): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};

// Sleep utility for testing/rate limiting
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Validate email format
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Generate secure random string
export const generateSecureToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('base64url');
};

/**
 * Normalize provider names to consistent format
 */
export const normalizeProvider = (provider: string): string => {
  return provider
    .toLowerCase()
    .replace(/-/g, ' ') // aws-bedrock -> aws bedrock
    .replace(/\s+/g, ' ') // normalize spaces
    .trim();
};

/**
 * Classify HTTP status codes into error types
 * @param statusCode - HTTP status code
 * @returns Error type classification
 */
export const classifyHttpError = (
  statusCode: number,
): {
  errorType:
    | 'client_error'
    | 'server_error'
    | 'network_error'
    | 'auth_error'
    | 'rate_limit'
    | 'timeout'
    | 'validation_error'
    | 'integration_error';
  isClientError: boolean;
  isServerError: boolean;
} => {
  let errorType:
    | 'client_error'
    | 'server_error'
    | 'network_error'
    | 'auth_error'
    | 'rate_limit'
    | 'timeout'
    | 'validation_error'
    | 'integration_error';
  let isClientError = false;
  let isServerError = false;

  if (statusCode >= 400 && statusCode < 500) {
    isClientError = true;
    switch (statusCode) {
      case 401:
      case 403:
        errorType = 'auth_error';
        break;
      case 422:
      case 400:
        errorType = 'validation_error';
        break;
      case 429:
        errorType = 'rate_limit';
        break;
      case 408:
        errorType = 'timeout';
        break;
      default:
        errorType = 'client_error';
    }
  } else if (statusCode >= 500) {
    isServerError = true;
    errorType = 'server_error';
  } else if (statusCode === 0 || statusCode < 100) {
    errorType = 'network_error';
  } else {
    errorType = 'integration_error';
  }

  return { errorType, isClientError, isServerError };
};

/**
 * Extract error details from request/response data
 * @param data - Request data that may contain error information
 * @param req - Express request object for additional context
 * @returns Processed error details
 */
export const extractErrorDetails = (data: any, req: any) => {
  const errorDetails: any = {};

  // Extract HTTP status code
  let httpStatusCode: number | undefined;
  if (data.httpStatusCode || data.statusCode || data.status) {
    httpStatusCode = data.httpStatusCode || data.statusCode || data.status;
  }

  // Extract error details from various possible sources
  if (data.error || data.errorDetails || data.errorInfo) {
    const error = data.error || data.errorDetails || data.errorInfo;

    errorDetails.code = error.code || error.error_code || error.errorCode;
    errorDetails.type = error.type || error.error_type || error.errorType;
    errorDetails.statusText = error.statusText || error.message;
    errorDetails.requestId = error.requestId || error.request_id;
    errorDetails.timestamp = new Date();
    errorDetails.endpoint = data.endpoint || req.originalUrl;
    errorDetails.method = req.method;
    errorDetails.userAgent = req.headers['user-agent'];
    errorDetails.clientVersion =
      req.headers['x-client-version'] || req.headers['user-agent'];

    // Include any additional error properties
    Object.keys(error).forEach((key) => {
      if (!errorDetails[key] && key !== 'message') {
        errorDetails[key] = error[key];
      }
    });
  }

  // Classify the error if we have a status code
  let errorClassification = null;
  if (httpStatusCode) {
    errorClassification = classifyHttpError(httpStatusCode);
  }

  return {
    httpStatusCode,
    errorDetails:
      Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
    ...errorClassification,
  };
};
