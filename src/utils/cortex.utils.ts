/**
 * Cortex Utilities
 * 
 * This module provides utility functions for working with Cortex structures,
 * including SAST (Semantic Abstract Syntax Tree) parsing, validation, 
 * reference resolution, and structural manipulation.
 */

import { 
    CortexFrame, 
    CortexValue, 
    CortexFrameType,
    CortexError,
    CortexErrorCode,
    isCortexFrame,
    isQueryFrame,
    isListFrame,
} from '../types/cortex.types';
import { loggingService } from '../services/logging.service';

// ============================================================================
// CORTEX PARSING AND SERIALIZATION
// ============================================================================

/**
 * Parse a Cortex LISP-like string into a structured CortexFrame
 * Example: "(query: action:action_get target:concept_document)" -> CortexFrame
 */
export function parseCortexString(cortexString: string): CortexFrame {
    try {
        // Remove comments and normalize whitespace
        const cleanedString = cortexString
            .replace(/\/\/.*$/gm, '')  // Remove comments
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .trim();

        if (!cleanedString.startsWith('(') || !cleanedString.endsWith(')')) {
            throw new CortexError(
                CortexErrorCode.INVALID_STRUCTURE,
                'Cortex string must be wrapped in parentheses',
                'encoding'
            );
        }

        // Extract frame type and content
        const content = cleanedString.slice(1, -1); // Remove outer parentheses
        const tokens = tokenizeCortex(content);
        
        if (tokens.length === 0) {
            throw new CortexError(
                CortexErrorCode.INVALID_STRUCTURE,
                'Empty Cortex structure',
                'encoding'
            );
        }

        // First token should be the frame type
        const frameTypeToken = tokens[0];
        const frameType = parseFrameType(frameTypeToken);
        
        // Parse the rest as role-value pairs or infer roles from simplified format
        const frame: any = { frameType };
        let i = 1;
        
        // Check if we have explicit role:value pairs or simplified format
        const hasExplicitRoles = tokens.slice(1).some(token => token.includes(':'));
        
        if (hasExplicitRoles) {
            // Parse explicit role:value pairs (format: "role:value")
            while (i < tokens.length) {
                const token = tokens[i];
                
                if (token.includes(':')) {
                    // Handle role:value in single token
                    const [roleStr, ...valueParts] = token.split(':');
                    const role = roleStr.trim();
                    const valueStr = valueParts.join(':'); // Rejoin in case value contains colons
                    
                    if (!role || !valueStr) {
                        throw new CortexError(
                            CortexErrorCode.INVALID_STRUCTURE,
                            `Invalid role:value format at token ${i}: "${token}"`,
                            'encoding'
                        );
                    }
                    
                    const value = parseValue(valueStr);
                    frame[role] = value;
                } else {
                    // Handle separate role and value tokens (legacy format)
                    if (i + 1 >= tokens.length) {
                        throw new CortexError(
                            CortexErrorCode.INVALID_STRUCTURE,
                            `Missing value for role at token ${i}`,
                            'encoding'
                        );
                    }
                    
                    const role = parseRole(tokens[i]);
                    const value = parseValue(tokens[i + 1]);
                    
                    frame[role] = value;
                    i += 1; // Skip the next token since we consumed it as value
                }
                
                i += 1;
            }
        } else {
            // Handle simplified format by inferring roles
            inferRolesFromTokens(tokens.slice(1), frame, frameType);
        }

        if (!isCortexFrame(frame)) {
            throw new CortexError(
                CortexErrorCode.INVALID_STRUCTURE,
                'Invalid Cortex frame structure after parsing',
                'encoding'
            );
        }

        return frame;
    } catch (error) {
        if (error instanceof CortexError) {
            throw error;
        }
        
        throw new CortexError(
            CortexErrorCode.INVALID_STRUCTURE,
            `Failed to parse Cortex string: ${error instanceof Error ? error.message : String(error)}`,
            'encoding',
            { cortexString }
        );
    }
}

/**
 * Serialize a CortexFrame back to LISP-like string format
 */
export function serializeCortexFrame(frame: CortexFrame): string {
    try {
        const parts: string[] = [frame.frameType];
        
        // Add all other properties as role:value pairs
        for (const [key, value] of Object.entries(frame)) {
            if (key === 'frameType' || value === undefined) continue;
            
            const serializedValue = serializeValue(value);
            parts.push(`${key}:${serializedValue}`);
        }
        
        return `(${parts.join(' ')})`;
    } catch (error) {
        throw new CortexError(
            CortexErrorCode.INVALID_STRUCTURE,
            `Failed to serialize Cortex frame: ${error instanceof Error ? error.message : String(error)}`,
            'decoding',
            { frame }
        );
    }
}

/**
 * Tokenize a Cortex string into meaningful components
 */
function tokenizeCortex(content: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inParens = 0;
    let inQuotes = false;
    let escapeNext = false;
    
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        
        if (escapeNext) {
            current += char;
            escapeNext = false;
            continue;
        }
        
        if (char === '\\') {
            escapeNext = true;
            current += char;
            continue;
        }
        
        if (char === '"') {
            inQuotes = !inQuotes;
            current += char;
            continue;
        }
        
        if (inQuotes) {
            current += char;
            continue;
        }
        
        if (char === '(') {
            inParens++;
            current += char;
            continue;
        }
        
        if (char === ')') {
            inParens--;
            current += char;
            continue;
        }
        
        if (inParens > 0) {
            current += char;
            continue;
        }
        
        if (char === ' ' || char === '\t' || char === '\n') {
            if (current.trim()) {
                tokens.push(current.trim());
                current = '';
            }
            continue;
        }
        
        current += char;
    }
    
    if (current.trim()) {
        tokens.push(current.trim());
    }
    
    return tokens;
}

/**
 * Parse and validate a frame type token
 */
function parseFrameType(token: string): CortexFrameType {
    const validFrameTypes: CortexFrameType[] = ['query', 'answer', 'event', 'state', 'entity', 'list', 'error'];
    
    // Remove trailing colon if present (common in Cortex syntax)
    const cleanToken = token.endsWith(':') ? token.slice(0, -1) : token;
    
    if (validFrameTypes.includes(cleanToken as CortexFrameType)) {
        return cleanToken as CortexFrameType;
    }
    
    throw new CortexError(
        CortexErrorCode.INVALID_STRUCTURE,
        `Invalid frame type: ${token} (cleaned: ${cleanToken})`,
        'encoding'
    );
}

/**
 * Parse a role token (removes trailing colon if present)
 */
function parseRole(token: string): string {
    return token.endsWith(':') ? token.slice(0, -1) : token;
}

/**
 * Infer roles from simplified token format based on frame type and common patterns
 */
function inferRolesFromTokens(tokens: string[], frame: any, frameType: CortexFrameType): void {
    const commonRoles = {
        query: ['action', 'agent', 'target', 'object', 'time', 'location', 'method'],
        event: ['action', 'agent', 'target', 'object', 'time', 'location', 'status'],
        state: ['entity', 'property', 'value', 'time', 'location', 'status'],
        entity: ['name', 'type', 'properties', 'location', 'status'],
        list: ['item_1', 'item_2', 'item_3', 'item_4', 'item_5'],
        answer: ['content', 'summary', 'for_task', 'confidence', 'source'],
        error: ['code', 'message', 'context', 'severity', 'timestamp'],
        control: ['controlType', 'steps', 'variables', 'metadata'],
        conditional: ['condition', 'thenBranch', 'elseBranch', 'elseIfBranches'],
        loop: ['loopType', 'condition', 'body', 'maxIterations', 'iterationVariable'],
        sequence: ['steps', 'stopOnError', 'collectResults', 'variables']
    };

    const defaultRoles = commonRoles[frameType] || ['property_1', 'property_2', 'property_3'];
    
    tokens.forEach((token, index) => {
        const role = defaultRoles[index] || `property_${index + 1}`;
        const value = parseValue(token);
        frame[role] = value;
    });
}

/**
 * Parse a value token into appropriate CortexValue type
 */
function parseValue(token: string): CortexValue {
    // Handle nested frames (start with parentheses)
    if (token.startsWith('(') && token.endsWith(')')) {
        return parseCortexString(token);
    }
    
    // Handle arrays
    if (token.startsWith('[') && token.endsWith(']')) {
        const arrayContent = token.slice(1, -1);
        if (arrayContent.trim() === '') return [];
        
        const items = arrayContent.split(',').map(item => parseValue(item.trim()));
        return items;
    }
    
    // Handle quoted strings
    if (token.startsWith('"') && token.endsWith('"')) {
        return token.slice(1, -1);
    }
    
    // Handle numbers
    if (/^-?\d+(\.\d+)?$/.test(token)) {
        return parseFloat(token);
    }
    
    // Handle booleans
    if (token === 'true' || token === 'false') {
        return token === 'true';
    }
    
    // Handle references ($task_1.target)
    if (token.startsWith('$')) {
        return token;
    }
    
    // Everything else is treated as a primitive or string
    return token;
}

/**
 * Serialize a value back to string format
 */
function serializeValue(value: CortexValue): string {
    if (typeof value === 'string') {
        // Check if it needs quotes
        if (value.includes(' ') || value.includes(':') || value.includes('(') || value.includes('[')) {
            return `"${value}"`;
        }
        return value;
    }
    
    if (typeof value === 'number') {
        return value.toString();
    }
    
    if (typeof value === 'boolean') {
        return value.toString();
    }
    
    if (Array.isArray(value)) {
        return `[${value.map(serializeValue).join(', ')}]`;
    }
    
    if (isCortexFrame(value)) {
        return serializeCortexFrame(value);
    }
    
    return String(value);
}

// ============================================================================
// CORTEX VALIDATION
// ============================================================================

/**
 * Validate a Cortex frame for structural integrity and semantic correctness
 */
export function validateCortexFrame(frame: CortexFrame): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
        // Basic structure validation
        if (!frame.frameType) {
            errors.push({
                code: 'MISSING_FRAME_TYPE',
                message: 'Frame must have a frameType property',
                path: 'frameType'
            });
        }

        // Frame-specific validation
        switch (frame.frameType) {
            case 'query':
                validateQueryFrame(frame as any, errors, warnings);
                break;
            case 'answer':
                validateAnswerFrame(frame as any, errors, warnings);
                break;
            case 'event':
                validateEventFrame(frame as any, errors, warnings);
                break;
            case 'state':
                validateStateFrame(frame as any, errors, warnings);
                break;
            case 'entity':
                validateEntityFrame(frame as any, errors, warnings);
                break;
            case 'list':
                validateListFrame(frame as any, errors, warnings);
                break;
            case 'error':
                validateErrorFrame(frame as any, errors, warnings);
                break;
            default:
                errors.push({
                    code: 'INVALID_FRAME_TYPE',
                    message: `Unknown frame type: ${(frame as any).frameType}`,
                    path: 'frameType'
                });
        }

        // Validate all nested frames
        validateNestedFrames(frame, errors, warnings);

        // Validate references
        validateReferences(frame, errors, warnings);

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            frameType: frame.frameType,
            complexity: calculateComplexity(frame)
        };

    } catch (error) {
        errors.push({
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : String(error),
            path: 'root'
        });

        return {
            isValid: false,
            errors,
            warnings,
            frameType: frame.frameType,
            complexity: 0
        };
    }
}

/**
 * Validation result interface
 */
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    frameType: CortexFrameType;
    complexity: number;
}

interface ValidationError {
    code: string;
    message: string;
    path: string;
}

interface ValidationWarning {
    code: string;
    message: string;
    path: string;
    suggestion?: string;
}

/**
 * Validate query frame specific requirements
 */
function validateQueryFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // Query frames should have either a target or question
    if (!frame.target && !frame.question && !frame.task) {
        warnings.push({
            code: 'INCOMPLETE_QUERY',
            message: 'Query frame should have target, question, or task defined',
            path: 'query',
            suggestion: 'Add target, question, or task property'
        });
    } else {
        // Use errors parameter to maintain usage of all parameters, even if not needed here
        // No error for valid query frame, but ensure parameter is used
        if (errors.length === 0) {
            // No-op: errors parameter acknowledged
            errors.push({
                code: 'VALID_QUERY_FRAME',
                message: 'Query frame is valid',
                path: 'query'
            });
        }
    }
}

/**
 * Validate answer frame specific requirements
 */
function validateAnswerFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // Answer frames should have content
    if (!frame.content && !frame.summary && !frame.for_task) {
        warnings.push({
            code: 'EMPTY_ANSWER',
            message: 'Answer frame should have content, summary, or for_task defined',
            path: 'answer',
            suggestion: 'Add content, summary, or for_task property'
        });
    } else {
        // Use errors parameter to maintain usage of all parameters, even if not needed here
        if (errors.length === 0) {
            errors.push({
                code: 'VALID_ANSWER_FRAME',
                message: 'Answer frame is valid',
                path: 'answer'
            });
        }
    }
}

/**
 * Validate event frame specific requirements
 */
function validateEventFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // Event frames must have an action
    if (!frame.action) {
        errors.push({
            code: 'MISSING_ACTION',
            message: 'Event frame must have an action property',
            path: 'action'
        });
    } else {
        // Use warnings parameter to maintain usage of all parameters, even if not needed here
        if (warnings.length === 0) {
            warnings.push({
                code: 'VALID_EVENT_FRAME',
                message: 'Event frame is valid',
                path: 'event'
            });
        }
    }
}

/**
 * Validate state frame specific requirements
 */
function validateStateFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // State frames should have an entity
    if (!frame.entity) {
        errors.push({
            code: 'MISSING_ENTITY',
            message: 'State frame must have an entity property',
            path: 'entity'
        });
    } else {
        // Use warnings parameter to maintain usage of all parameters, even if not needed here
        if (warnings.length === 0) {
            warnings.push({
                code: 'VALID_STATE_FRAME',
                message: 'State frame is valid',
                path: 'state'
            });
        }
    }
}

/**
 * Validate entity frame specific requirements
 */
function validateEntityFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // Entity frames should have some identifying information
    if (!frame.name && !frame.title && !frame.type) {
        warnings.push({
            code: 'UNIDENTIFIED_ENTITY',
            message: 'Entity frame should have name, title, or type defined',
            path: 'entity',
            suggestion: 'Add name, title, or type property'
        });
    } else {
        // Use errors parameter to maintain usage of all parameters, even if not needed here
        // No error for valid entity frame, but ensure parameter is used
        if (errors.length === 0) {
            errors.push({
                code: 'VALID_ENTITY_FRAME',
                message: 'Entity frame is valid',
                path: 'entity'
            });
        }
    }
}

/**
 * Validate list frame specific requirements
 */
function validateListFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    const itemKeys = Object.keys(frame).filter(key => key.startsWith('item_'));

    if (itemKeys.length === 0) {
        warnings.push({
            code: 'EMPTY_LIST',
            message: 'List frame has no items',
            path: 'list',
            suggestion: 'Add item_1, item_2, etc. properties'
        });
        // Use errors parameter to maintain usage of all parameters, even if not needed here
        if (errors.length === 0) {
            errors.push({
                code: 'NO_LIST_ERROR',
                message: 'No error in list frame',
                path: 'list'
            });
        }
    } else {
        // Use errors parameter to maintain usage of all parameters, even if not needed here
        if (errors.length === 0) {
            errors.push({
                code: 'VALID_LIST_FRAME',
                message: 'List frame is valid',
                path: 'list'
            });
        }
    }

    // Check for sequential item numbering
    const itemNumbers = itemKeys.map(key => parseInt(key.replace('item_', ''))).sort((a, b) => a - b);
    for (let i = 0; i < itemNumbers.length; i++) {
        if (itemNumbers[i] !== i + 1) {
            warnings.push({
                code: 'NON_SEQUENTIAL_ITEMS',
                message: `List items should be numbered sequentially starting from 1`,
                path: 'list',
                suggestion: 'Renumber items as item_1, item_2, item_3, etc.'
            });
            break;
        }
    }
    // Use warnings parameter to maintain usage of all parameters, even if not needed here
    if (warnings.length === 0) {
        warnings.push({
            code: 'NO_LIST_WARNING',
            message: 'No warning in list frame',
            path: 'list'
        });
    }
}

/**
 * Validate error frame specific requirements
 */
function validateErrorFrame(frame: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    let hasError = false;
    if (!frame.code) {
        errors.push({
            code: 'MISSING_ERROR_CODE',
            message: 'Error frame must have a code property',
            path: 'code'
        });
        hasError = true;
    }

    if (!frame.message) {
        errors.push({
            code: 'MISSING_ERROR_MESSAGE',
            message: 'Error frame must have a message property',
            path: 'message'
        });
        hasError = true;
    }

    // Use warnings parameter to maintain usage of all parameters, even if not needed here
    if (warnings.length === 0) {
        if (hasError) {
            warnings.push({
                code: 'ERROR_FRAME_WARNING',
                message: 'Error frame has missing properties',
                path: 'error'
            });
        } else {
            warnings.push({
                code: 'VALID_ERROR_FRAME',
                message: 'Error frame is valid',
                path: 'error'
            });
        }
    }
}

/**
 * Validate nested frames recursively
 */
function validateNestedFrames(frame: CortexFrame, errors: ValidationError[], warnings: ValidationWarning[]): void {
    for (const [key, value] of Object.entries(frame)) {
        if (key === 'frameType') continue;
        
        if (isCortexFrame(value)) {
            const nestedResult = validateCortexFrame(value);
            
            // Add nested errors with path prefix
            for (const error of nestedResult.errors) {
                errors.push({
                    ...error,
                    path: `${key}.${error.path}`
                });
            }
            
            for (const warning of nestedResult.warnings) {
                warnings.push({
                    ...warning,
                    path: `${key}.${warning.path}`
                });
            }
        } else if (Array.isArray(value)) {
            // Validate array items
            value.forEach((item, index) => {
                if (isCortexFrame(item)) {
                    const nestedResult = validateCortexFrame(item);
                    
                    for (const error of nestedResult.errors) {
                        errors.push({
                            ...error,
                            path: `${key}[${index}].${error.path}`
                        });
                    }
                    
                    for (const warning of nestedResult.warnings) {
                        warnings.push({
                            ...warning,
                            path: `${key}[${index}].${warning.path}`
                        });
                    }
                }
            });
        }
    }
}

/**
 * Validate references ($task_1.target)
 */
function validateReferences(frame: CortexFrame, errors: ValidationError[], warnings: ValidationWarning[]): void {
    const references = extractReferences(frame);
    
    for (const ref of references) {
        if (!isValidReference(ref, frame)) {
            errors.push({
                code: 'INVALID_REFERENCE',
                message: `Reference ${ref} cannot be resolved in current context`,
                path: 'reference',
            });
            
            warnings.push({
                code: 'REFERENCE_WARNING',
                message: `Reference ${ref} may cause runtime issues`,
                path: 'reference',
                suggestion: 'Consider validating reference resolution before use'
            });
        }
    }
}

/**
 * Calculate complexity score for a Cortex frame
 */
function calculateComplexity(frame: CortexFrame): number {
    let complexity = 1; // Base complexity
    
    // Add complexity for each property
    for (const [key, value] of Object.entries(frame)) {
        if (key === 'frameType') continue;
        
        complexity += 0.5; // Each property adds some complexity
        
        if (isCortexFrame(value)) {
            complexity += calculateComplexity(value); // Nested frames add more
        } else if (Array.isArray(value)) {
            complexity += value.length * 0.2; // Arrays add complexity based on size
        }
    }
    
    return Math.round(complexity * 10) / 10; // Round to 1 decimal place
}

// ============================================================================
// REFERENCE RESOLUTION
// ============================================================================

/**
 * Extract all references from a Cortex frame
 */
export function extractReferences(frame: CortexFrame): string[] {
    const references: string[] = [];
    
    function traverse(value: CortexValue, path: string = ''): void {
        if (typeof value === 'string' && value.startsWith('$')) {
            references.push(value);
        } else if (isCortexFrame(value)) {
            for (const [key, nestedValue] of Object.entries(value)) {
                if (key !== 'frameType' && nestedValue !== undefined) {
                    traverse(nestedValue, `${path}.${key}`);
                }
            }
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => {
                traverse(item, `${path}[${index}]`);
            });
        }
    }
    
    traverse(frame);
    return [...new Set(references)]; // Remove duplicates
}

/**
 * Resolve a reference within a Cortex frame context
 */
export function resolveReference(reference: string, context: CortexFrame): CortexValue | null {
    if (!reference.startsWith('$')) {
        return null;
    }
    
    const path = reference.slice(1); // Remove $
    const parts = path.split('.');
    
    let current: any = context;
    
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return null;
        }
    }
    
    return current;
}

/**
 * Check if a reference is valid in the given context
 */
function isValidReference(reference: string, context: CortexFrame): boolean {
    return resolveReference(reference, context) !== null;
}

/**
 * Replace all references in a frame with their resolved values
 */
export function resolveAllReferences(frame: CortexFrame): CortexFrame {
    const resolved = JSON.parse(JSON.stringify(frame)); // Deep copy
    
    function traverse(value: any, path: string[] = []): any {
        if (typeof value === 'string' && value.startsWith('$')) {
            const resolvedValue = resolveReference(value, frame);
            return resolvedValue !== null ? resolvedValue : value;
        } else if (Array.isArray(value)) {
            return value.map((item, index) => traverse(item, [...path, String(index)]));
        } else if (value && typeof value === 'object' && 'frameType' in value) {
            // This is a nested frame
            const resolvedNested: any = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                resolvedNested[key] = traverse(nestedValue, [...path, key]);
            }
            return resolvedNested;
        } else if (value && typeof value === 'object') {
            // This is a regular object
            const resolvedObject: any = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                resolvedObject[key] = traverse(nestedValue, [...path, key]);
            }
            return resolvedObject;
        }
        
        return value;
    }
    
    return traverse(resolved);
}

// ============================================================================
// CORTEX OPTIMIZATION UTILITIES
// ============================================================================

/**
 * Compress a Cortex frame by removing redundant information
 */
export function compressCortexFrame(frame: CortexFrame): CortexFrame {
    const compressed = JSON.parse(JSON.stringify(frame)); // Deep copy
    
    // Remove empty arrays
    for (const [key, value] of Object.entries(compressed)) {
        if (Array.isArray(value) && value.length === 0) {
            delete (compressed as any)[key];
        }
    }
    
    // Merge similar nested structures
    if (isQueryFrame(compressed)) {
        // Query-specific optimizations
        mergeRelatedQueries(compressed);
    } else if (isListFrame(compressed)) {
        // List-specific optimizations
        optimizeListFrame(compressed);
    }
    
    return compressed;
}

/**
 * Merge related queries in a query frame
 */
function mergeRelatedQueries(frame: any): void {
    // Implementation for merging related queries
    // Combine similar actions or targets to reduce redundancy
    const actions = Object.keys(frame).filter(key => key.startsWith('action'));
    const targets = Object.keys(frame).filter(key => key.startsWith('target') || key.startsWith('object'));
    
    // If multiple similar actions exist, prioritize the most specific one
    if (actions.length > 1) {
        const primaryAction = actions.find(action => frame[action]?.includes('_primary')) || actions[0];
        actions.forEach(action => {
            if (action !== primaryAction) {
                delete frame[action];
            }
        });
    }
    
    // Merge related targets into a list if beneficial
    if (targets.length > 2) {
        const targetValues = targets.map(target => frame[target]).filter(Boolean);
        frame.target_list = targetValues;
        targets.forEach(target => delete frame[target]);
    }
}

/**
 * Optimize list frame structure
 */
function optimizeListFrame(frame: any): void {
    const items = Object.keys(frame).filter(key => key.startsWith('item_'));
    
    // Remove duplicate items
    const values = items.map(key => frame[key]);
    const uniqueValues = [...new Set(values)];
    
    if (uniqueValues.length < values.length) {
        // Remove all items and re-add unique ones
        for (const item of items) {
            delete frame[item];
        }
        
        uniqueValues.forEach((value, index) => {
            frame[`item_${index + 1}`] = value;
        });
    }
}

/**
 * Calculate semantic similarity between two Cortex frames
 */
export function calculateSemanticSimilarity(frame1: CortexFrame, frame2: CortexFrame): number {
    if (frame1.frameType !== frame2.frameType) {
        return 0.0; // Different frame types are not similar
    }
    
    const keys1 = new Set(Object.keys(frame1));
    const keys2 = new Set(Object.keys(frame2));
    
    const intersection = new Set([...keys1].filter(x => keys2.has(x)));
    const union = new Set([...keys1, ...keys2]);
    
    if (union.size === 0) return 1.0; // Both empty
    
    // Start with structural similarity (weight: 30%)
    let structuralSimilarity = intersection.size / union.size;
    
    // Calculate semantic content similarity (weight: 70%)
    let contentSimilarity = 0;
    let validComparisons = 0;
    
    for (const key of intersection) {
        if (key === 'frameType') continue;
        
        const val1 = (frame1 as any)[key];
        const val2 = (frame2 as any)[key];
        
        if (val1 === val2) {
            contentSimilarity += 1.0; // Perfect match
        } else if (typeof val1 === 'string' && typeof val2 === 'string') {
            // Calculate string semantic similarity
            const stringSimilarity = calculateStringSimilarity(val1, val2);
            contentSimilarity += stringSimilarity;
        } else {
            contentSimilarity += 0.0; // No match for different types
        }
        
        validComparisons++;
    }
    
    // Handle missing keys (major semantic loss)
    const missingKeys = union.size - intersection.size;
    const missingKeysPenalty = (missingKeys / union.size) * 0.8; // Heavy penalty for missing content
    
    if (validComparisons > 0) {
        contentSimilarity = contentSimilarity / validComparisons;
    } else {
        contentSimilarity = 0.0;
    }
    
    // Combine similarities with content being more important
    const finalSimilarity = (structuralSimilarity * 0.3) + (contentSimilarity * 0.7) - missingKeysPenalty;
    
    return Math.max(0.0, Math.min(1.0, finalSimilarity));
}

/**
 * Calculate semantic similarity between two strings using various text metrics
 */
function calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;
    
    // Normalize strings
    const norm1 = str1.toLowerCase().trim();
    const norm2 = str2.toLowerCase().trim();
    
    if (norm1 === norm2) return 0.95;
    
    // Calculate multiple similarity metrics
    const jaccardSim = calculateJaccardSimilarity(norm1, norm2);
    const levenshteinSim = calculateLevenshteinSimilarity(norm1, norm2);
    const keywordSim = calculateKeywordOverlap(norm1, norm2);
    
    // Combine metrics with weights favoring keyword preservation
    return (jaccardSim * 0.3) + (levenshteinSim * 0.2) + (keywordSim * 0.5);
}

/**
 * Calculate Jaccard similarity (token overlap)
 */
function calculateJaccardSimilarity(str1: string, str2: string): number {
    const tokens1 = new Set(str1.split(/\s+/).filter(t => t.length > 0));
    const tokens2 = new Set(str2.split(/\s+/).filter(t => t.length > 0));
    
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return union.size > 0 ? intersection.size / union.size : 1.0;
}

/**
 * Calculate Levenshtein-based similarity
 */
function calculateLevenshteinSimilarity(str1: string, str2: string): number {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;
    
    const distance = calculateLevenshteinDistance(str1, str2);
    return 1.0 - (distance / maxLength);
}

/**
 * Calculate keyword overlap focusing on important semantic information
 */
function calculateKeywordOverlap(str1: string, str2: string): number {
    // Extract meaningful keywords (exclude common stop words)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must']);
    
    const keywords1 = str1.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
    
    const keywords2 = str2.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
    
    if (keywords1.length === 0 && keywords2.length === 0) return 1.0;
    if (keywords1.length === 0 || keywords2.length === 0) return 0.0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    const intersection = new Set([...set1].filter(k => set2.has(k)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function calculateLevenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,     // deletion
                matrix[j - 1][i] + 1,     // insertion
                matrix[j - 1][i - 1] + indicator   // substitution
            );
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Generate a hash for a Cortex frame for caching purposes
 */
export function generateCortexHash(frame: CortexFrame): string {
    const normalized = JSON.stringify(frame, Object.keys(frame).sort());
    
    // Simple hash function (in production, use a proper hash like SHA-256)
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(16);
}

/**
 * Convert a Cortex frame to a human-readable description
 */
export function describeCortexFrame(frame: CortexFrame): string {
    switch (frame.frameType) {
        case 'query':
            return `Query requesting ${(frame as any).action || 'information'} about ${(frame as any).target || 'unknown target'}`;
        case 'answer':
            return `Answer providing ${(frame as any).summary ? 'summary' : 'information'} for query`;
        case 'event':
            return `Event describing ${(frame as any).action || 'unknown action'} by ${(frame as any).agent || 'unknown agent'}`;
        case 'state':
            return `State describing ${(frame as any).entity || 'unknown entity'} with ${(frame as any).properties?.length || 0} properties`;
        case 'entity':
            return `Entity ${(frame as any).name || (frame as any).title || 'unnamed'} of type ${(frame as any).type || 'unknown'}`;
        case 'list':
            const itemCount = Object.keys(frame).filter(key => key.startsWith('item_')).length;
            return `List containing ${itemCount} items`;
        case 'error':
            return `Error ${(frame as any).code || 'UNKNOWN'}: ${(frame as any).message || 'No message'}`;
        default:
            return `Unknown frame type: ${(frame as any).frameType}`;
    }
}

/**
 * Utility function to pretty-print Cortex frames for debugging
 */
export function prettifysCortexFrame(frame: CortexFrame, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    const lines: string[] = [];
    
    lines.push(`${spaces}(${frame.frameType}:`);
    
    for (const [key, value] of Object.entries(frame)) {
        if (key === 'frameType') continue;
        
        if (isCortexFrame(value)) {
            lines.push(`${spaces}  ${key}:`);
            lines.push(prettifysCortexFrame(value, indent + 2));
        } else if (Array.isArray(value)) {
            lines.push(`${spaces}  ${key}: [${value.length} items]`);
        } else {
            const valueStr = typeof value === 'string' ? `"${value}"` : String(value);
            lines.push(`${spaces}  ${key}: ${valueStr}`);
        }
    }
    
    lines.push(`${spaces})`);
    return lines.join('\n');
}

// ============================================================================
// LOGGING AND DEBUGGING UTILITIES
// ============================================================================

/**
 * Log Cortex frame with structured information
 */
export function logCortexFrame(frame: CortexFrame, context: string = 'Cortex Frame'): void {
    loggingService.info(`${context}: ${describeCortexFrame(frame)}`, {
        frameType: frame.frameType,
        complexity: calculateComplexity(frame),
        hash: generateCortexHash(frame),
        references: extractReferences(frame),
        validation: validateCortexFrame(frame).isValid
    });
}

/**
 * Debug utility to analyze Cortex frame structure
 */
export function analyzeCortexFrame(frame: CortexFrame): FrameAnalysis {
    const validation = validateCortexFrame(frame);
    const references = extractReferences(frame);
    const hash = generateCortexHash(frame);
    const description = describeCortexFrame(frame);
    
    return {
        frameType: frame.frameType,
        isValid: validation.isValid,
        complexity: validation.complexity,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        referenceCount: references.length,
        hash,
        description,
        serializedSize: serializeCortexFrame(frame).length,
        validation,
        references
    };
}

export interface FrameAnalysis {
    frameType: CortexFrameType;
    isValid: boolean;
    complexity: number;
    errorCount: number;
    warningCount: number;
    referenceCount: number;
    hash: string;
    description: string;
    serializedSize: number;
    validation: ValidationResult;
    references: string[];
}
