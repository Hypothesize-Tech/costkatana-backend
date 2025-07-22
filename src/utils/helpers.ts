import crypto from 'crypto';
import { config } from '../config';

// Encryption/Decryption for API keys
const algorithm = 'aes-256-gcm';
const keyLength = 32;

export const encrypt = (text: string): { encrypted: string; iv: string; authTag: string } => {
  const key = Buffer.from(config.encryption.key.padEnd(keyLength, '0').slice(0, keyLength));
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

export const decrypt = (encrypted: string, iv: string, authTag: string): string => {
  const key = Buffer.from(config.encryption.key.padEnd(keyLength, '0').slice(0, keyLength));
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  
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
export const getDateRange = (period: 'daily' | 'weekly' | 'monthly', date: Date = new Date()) => {
  const start = new Date(date);
  const end = new Date(date);
  
  switch (period) {
    case 'daily':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'weekly':
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek;
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setDate(diff + 6);
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
export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
};

// Calculate percentage change
export const calculatePercentageChange = (oldValue: number, newValue: number): number => {
  if (oldValue === 0) return newValue === 0 ? 0 : 100;
  return ((newValue - oldValue) / oldValue) * 100;
};

// Paginate results
export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const paginate = <T>(
  data: T[],
  total: number,
  options: PaginationOptions
): PaginatedResult<T> => {
  const page = options.page || 1;
  const limit = options.limit || 10;
  const pages = Math.ceil(total / limit);
  
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
    },
  };
};

// Sanitize user input
export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '');
};

// Check if date is within range
export const isWithinDateRange = (date: Date, startDate: Date, endDate: Date): boolean => {
  return date >= startDate && date <= endDate;
};

// Group data by key
export const groupBy = <T>(array: T[], key: keyof T): Record<string, T[]> => {
  return array.reduce((result, item) => {
    const group = String(item[key]);
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {} as Record<string, T[]>);
};

// Calculate token cost based on pricing
export const calculateTokenCost = (
  tokens: number,
  pricePerToken: number,
): number => {
  // Most providers charge per 1K tokens
  return (tokens / 1000) * pricePerToken;
};

// Enhanced retry function for external API calls with better throttling handling
export const retry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.name === 'ValidationException' || 
          error.name === 'AccessDeniedException' ||
          error.name === 'ResourceNotFoundException' ||
          error.statusCode === 400) {
        throw error;
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      
      // Special handling for throttling errors
      if (error.name === 'ThrottlingException' || 
          error.statusCode === 429 ||
          error.message?.includes('throttle') ||
          error.message?.includes('rate limit')) {
        // Use longer delays for throttling
        delay = Math.min(baseDelay * Math.pow(3, attempt), maxDelay);
      }
      
      // Add jitter (±25% randomness) to avoid thundering herd
      const jitter = delay * 0.25 * (Math.random() - 0.5);
      delay = Math.max(0, delay + jitter);
      
      console.log(`Retry attempt ${attempt + 1}/${maxRetries + 1} after ${Math.round(delay)}ms for error: ${error.name || 'Unknown'}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

// Format bytes to human readable
export const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};