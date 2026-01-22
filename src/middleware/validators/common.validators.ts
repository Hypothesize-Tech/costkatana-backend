/**
 * Common Validators
 * Reusable validation chains for use across all route files
 * 
 * This module provides standardized validation patterns that are repeated
 * across 60+ controllers. By centralizing these, we eliminate duplication
 * and ensure consistency.
 * 
 */

import { param, query, body, ValidationChain } from 'express-validator';
import { z } from 'zod';

/**
 * ======================
 * EXPRESS-VALIDATOR CHAINS
 * For simple route-level validation (params, query, basic body fields)
 * ======================
 */

export const commonValidators = {
  /**
   * MongoDB ObjectId Validation (URL Parameters)
   * Used in 60+ controllers
   * 
   * @param fieldName - Name of the param field (default: 'id')
   * @returns ValidationChain for MongoDB ObjectId
   * 
   */
  mongoId: (fieldName: string = 'id'): ValidationChain => 
    param(fieldName)
      .isMongoId()
      .withMessage(`Invalid ${fieldName}`),

  /**
   * MongoDB ObjectId Validation (Request Body)
   * 
   * @param fieldName - Name of the body field
   * @param optional - Whether the field is optional
   * @returns ValidationChain for MongoDB ObjectId in body
   * 
   */
  mongoIdBody: (fieldName: string, optional: boolean = false): ValidationChain => {
    const chain = body(fieldName).isMongoId().withMessage(`Invalid ${fieldName}`);
    return optional ? chain.optional() : chain;
  },

  /**
   * MongoDB ObjectId Validation (Query Parameters)
   * 
   * @param fieldName - Name of the query field
   * @param optional - Whether the field is optional (default: true)
   * @returns ValidationChain for MongoDB ObjectId in query
   */
  mongoIdQuery: (fieldName: string, optional: boolean = true): ValidationChain => {
    const chain = query(fieldName).isMongoId().withMessage(`Invalid ${fieldName}`);
    return optional ? chain.optional() : chain;
  },

  /**
   * Pagination Parameters
   * Used in 30+ controllers
   * 
   * Standard pagination with limit, offset, and page
   * - limit: 1-100 (default: 20)
   * - offset: >= 0 (default: 0)
   * - page: >= 1 (default: 1)
   * 
   */
  pagination: [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt()
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .toInt()
      .withMessage('Offset must be >= 0'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('Page must be >= 1')
  ] as ValidationChain[],

  /**
   * Date Range Validation
   * Used in 20+ controllers (analytics, billing, reports)
   * 
   */
  dateRange: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid start date (use ISO8601 format)'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid end date (use ISO8601 format)')
  ] as ValidationChain[],

  /**
   * Email Validation (Body)
   * Used in 15+ controllers
   * 
   * @param optional - Whether email is optional
   * @returns ValidationChain for email validation
   * 
   */
  email: (optional: boolean = false): ValidationChain => {
    const chain = body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Invalid email address');
    return optional ? chain.optional() : chain;
  },

  /**
   * URL Validation (Body)
   * Used in 10+ controllers (webhooks, integrations, projects)
   * 
   * @param fieldName - Name of the URL field (default: 'url')
   * @param optional - Whether URL is optional
   * @returns ValidationChain for URL validation
   * 
   */
  url: (fieldName: string = 'url', optional: boolean = false): ValidationChain => {
    const chain = body(fieldName)
      .isURL()
      .withMessage(`Invalid ${fieldName}`);
    return optional ? chain.optional() : chain;
  },

  /**
   * Boolean Validation (Body)
   * Used in 40+ controllers
   * 
   * @param fieldName - Name of the boolean field
   * @param optional - Whether field is optional
   * @returns ValidationChain for boolean validation
   * 
   */
  boolean: (fieldName: string, optional: boolean = false): ValidationChain => {
    const chain = body(fieldName)
      .isBoolean()
      .withMessage(`${fieldName} must be a boolean`);
    return optional ? chain.optional() : chain;
  },

  /**
   * String Validation with Length (Body)
   * 
   * @param fieldName - Name of the string field
   * @param minLength - Minimum length (default: 1)
   * @param maxLength - Maximum length (default: 255)
   * @param optional - Whether field is optional
   * @returns ValidationChain for string validation
   * 
   */
  string: (
    fieldName: string,
    minLength: number = 1,
    maxLength: number = 255,
    optional: boolean = false
  ): ValidationChain => {
    let chain = body(fieldName)
      .isString()
      .withMessage(`${fieldName} must be a string`)
      .trim()
      .isLength({ min: minLength, max: maxLength })
      .withMessage(`${fieldName} must be between ${minLength} and ${maxLength} characters`);
    
    if (optional) {
      chain = chain.optional();
    } else {
      chain = chain.notEmpty().withMessage(`${fieldName} is required`);
    }
    
    return chain;
  },

  /**
   * Integer Validation (Body/Query)
   * 
   * @param fieldName - Name of the integer field
   * @param min - Minimum value
   * @param max - Maximum value
   * @param location - 'body' or 'query' (default: 'body')
   * @param optional - Whether field is optional
   * @returns ValidationChain for integer validation
   * 
   */
  integer: (
    fieldName: string,
    min?: number,
    max?: number,
    location: 'body' | 'query' = 'body',
    optional: boolean = false
  ): ValidationChain => {
    const validator = location === 'body' ? body : query;
    const constraints: any = {};
    if (min !== undefined) constraints.min = min;
    if (max !== undefined) constraints.max = max;
    
    let chain = validator(fieldName)
      .isInt(constraints)
      .toInt();
    
    if (min !== undefined || max !== undefined) {
      const rangeMsg = min !== undefined && max !== undefined
        ? `${fieldName} must be between ${min} and ${max}`
        : min !== undefined
        ? `${fieldName} must be >= ${min}`
        : `${fieldName} must be <= ${max}`;
      chain = chain.withMessage(rangeMsg);
    } else {
      chain = chain.withMessage(`${fieldName} must be an integer`);
    }
    
    return optional ? chain.optional() : chain;
  },

  /**
   * Enum Validation (Body/Query)
   * 
   * @param fieldName - Name of the enum field
   * @param allowedValues - Array of allowed string values
   * @param location - 'body' or 'query' (default: 'body')
   * @param optional - Whether field is optional
   * @returns ValidationChain for enum validation
   * 
   */
  enum: (
    fieldName: string,
    allowedValues: string[],
    location: 'body' | 'query' = 'body',
    optional: boolean = false
  ): ValidationChain => {
    const validator = location === 'body' ? body : query;
    const chain = validator(fieldName)
      .isIn(allowedValues)
      .withMessage(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
    
    return optional ? chain.optional() : chain;
  },

  /**
   * Array Validation (Body)
   * 
   * @param fieldName - Name of the array field
   * @param minLength - Minimum array length
   * @param maxLength - Maximum array length
   * @param optional - Whether field is optional
   * @returns ValidationChain for array validation
   * 
   */
  array: (
    fieldName: string,
    minLength?: number,
    maxLength?: number,
    optional: boolean = false
  ): ValidationChain => {
    let chain = body(fieldName)
      .isArray()
      .withMessage(`${fieldName} must be an array`);
    
    if (minLength !== undefined || maxLength !== undefined) {
      const lengthConstraints: any = {};
      if (minLength !== undefined) lengthConstraints.min = minLength;
      if (maxLength !== undefined) lengthConstraints.max = maxLength;
      
      chain = chain.isLength(lengthConstraints);
      
      const rangeMsg = minLength !== undefined && maxLength !== undefined
        ? `${fieldName} must contain ${minLength}-${maxLength} items`
        : minLength !== undefined
        ? `${fieldName} must contain at least ${minLength} items`
        : `${fieldName} must contain at most ${maxLength} items`;
      
      chain = chain.withMessage(rangeMsg);
    }
    
    return optional ? chain.optional() : chain;
  },

  /**
   * UUID Validation (Body/Param/Query)
   * 
   * @param fieldName - Name of the UUID field
   * @param location - 'body', 'param', or 'query' (default: 'param')
   * @param optional - Whether field is optional
   * @returns ValidationChain for UUID validation
   * 
   */
  uuid: (
    fieldName: string = 'uuid',
    location: 'body' | 'param' | 'query' = 'param',
    optional: boolean = false
  ): ValidationChain => {
    const validator = location === 'body' ? body : location === 'param' ? param : query;
    const chain = validator(fieldName)
      .isUUID()
      .withMessage(`Invalid ${fieldName} (must be UUID)`);
    
    return optional ? chain.optional() : chain;
  },

  /**
   * Phone Number Validation (Body)
   * 
   * @param fieldName - Name of the phone field (default: 'phone')
   * @param optional - Whether field is optional
   * @returns ValidationChain for phone validation
   * 
   */
  phone: (fieldName: string = 'phone', optional: boolean = false): ValidationChain => {
    const chain = body(fieldName)
      .isMobilePhone('any')
      .withMessage(`Invalid ${fieldName}`);
    
    return optional ? chain.optional() : chain;
  },

  /**
   * JSON String Validation (Body)
   * Validates that a string is valid JSON
   * 
   * @param fieldName - Name of the JSON field
   * @param optional - Whether field is optional
   * @returns ValidationChain for JSON validation
   * 
   */
  jsonString: (fieldName: string, optional: boolean = false): ValidationChain => {
    const chain = body(fieldName)
      .isJSON()
      .withMessage(`Invalid JSON in ${fieldName}`);
    
    return optional ? chain.optional() : chain;
  },

  /**
   * Sort Order Validation (Query)
   * Standard sort query parameter (field:order format)
   * 
   */
  sortOrder: query('sort')
    .optional()
    .matches(/^[a-zA-Z0-9_]+:(asc|desc)$/)
    .withMessage('Sort format must be field:order (e.g., createdAt:desc)')
};

/**
 * ======================
 * ZOD SCHEMAS
 * For complex body validation with nested objects and transformations
 * ======================
 */

/**
 * Pagination Schema (Zod)
 * For query parameters with default values and transformations
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional()
});

/**
 * Date Range Schema (Zod)
 * For query parameters with date parsing
 */
export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional()
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

/**
 * MongoDB ObjectId Schema (Zod)
 * For validating MongoDB ObjectIds in request bodies
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

/**
 * Helper to create an array of ObjectId schema
 */
export const objectIdArraySchema = (min?: number, max?: number) => {
  let schema = z.array(objectIdSchema);
  if (min !== undefined) schema = schema.min(min);
  if (max !== undefined) schema = schema.max(max);
  return schema;
};

/**
 * Type exports for TypeScript inference
 */
export type PaginationQuery = z.infer<typeof paginationSchema>;
export type DateRangeQuery = z.infer<typeof dateRangeSchema>;
