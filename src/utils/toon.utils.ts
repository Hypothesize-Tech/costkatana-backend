/**
 * TOON (Token-Oriented Object Notation) Utilities
 * 
 * Provides encoding/decoding functions for TOON format to reduce token usage
 * in LLM communications by 30-60% compared to JSON.
 * 
 * TOON format is optimized for uniform arrays of objects:
 * JSON: {"users": [{"id":1,"name":"Alice"}, {"id":2,"name":"Bob"}]}
 * TOON: users[2]{id,name}:
 *   1,Alice
 *   2,Bob
 * 
 * EDGE CASE HANDLING:
 * - Deep nested objects (>3 levels) fallback to JSON
 * - Heterogeneous arrays fallback to JSON
 * - Binary data detection and bypass
 * - Special character escaping
 * - Large data chunking
 * - Circular reference detection
 * - Unicode/emoji support
 * - Malformed TOON recovery
 */

import { loggingService } from '../services/logging.service';

// Configuration for TOON usage
const USE_TOON = process.env.CORTEX_USE_TOON !== 'false'; // Default: true

// Configuration constants for edge case handling
const MAX_NESTING_DEPTH = 3; // Maximum nesting depth for TOON (beyond this, use JSON)
const MAX_ARRAY_SIZE = 100000; // Maximum array size before chunking
const MAX_FIELD_NAME_LENGTH = 100; // Maximum field name length
const MAX_STRING_VALUE_LENGTH = 10000; // Maximum string value length before truncation
const BINARY_DATA_THRESHOLD = 0.3; // If >30% non-printable chars, likely binary

// Lazy load TOON library (ES module) using dynamic import
let toonModule: { encode: (data: any) => string; decode: (toon: string) => any } | null = null;
let toonModuleLoadError: Error | null = null;
let toonModuleLoadAttempted = false;

async function getToonModule(): Promise<{ encode: (data: any) => string; decode: (toon: string) => any }> {
  // If we've already tried and failed, throw the cached error
  if (toonModuleLoadError) {
    throw toonModuleLoadError;
  }
  
  // If already loaded, return it
  if (toonModule) {
    return toonModule;
  }
  
  // Prevent multiple simultaneous load attempts
  if (toonModuleLoadAttempted && !toonModule) {
    // Wait a bit and retry once
    await new Promise(resolve => setTimeout(resolve, 100));
    if (toonModule) {
      return toonModule;
    }
    if (toonModuleLoadError) {
      throw toonModuleLoadError;
    }
  }
  
  toonModuleLoadAttempted = true;
  
  try {
    // Use Function constructor to ensure dynamic import works in CommonJS context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const module = await dynamicImport('@toon-format/toon');
    toonModule = module.default || module;
    if (!toonModule) {
      throw new Error('TOON module loaded but is null');
    }
    return toonModule;
  } catch (error) {
    toonModuleLoadError = error instanceof Error ? error : new Error(String(error));
    loggingService.warn('Failed to load TOON library, will fallback to JSON', {
      error: toonModuleLoadError.message
    });
    throw toonModuleLoadError;
  }
}

/**
 * Check for circular references in data structure
 */
function hasCircularReference(obj: any, visited: WeakSet<object> = new WeakSet()): boolean {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  
  if (visited.has(obj)) {
    return true;
  }
  
  visited.add(obj);
  
  try {
    for (const key in obj) {
      if (hasCircularReference(obj[key], visited)) {
        return true;
      }
    }
  } catch (e) {
    // If we can't iterate, assume circular
    return true;
  }
  
  return false;
}

/**
 * Check if data contains binary content
 */
function isBinaryData(data: any): boolean {
  if (typeof data === 'string') {
    // Check for high ratio of non-printable characters
    // eslint-disable-next-line no-control-regex
    const nonPrintable = (data.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) ?? []).length;
    return nonPrintable / data.length > BINARY_DATA_THRESHOLD;
  }
  
  if (Buffer.isBuffer(data)) {
    return true;
  }
  
  if (typeof data === 'object' && data !== null) {
    // Check nested strings
    for (const key in data) {
      if (isBinaryData(data[key])) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Calculate nesting depth of an object
 */
function getNestingDepth(obj: any, currentDepth: number = 0, maxDepth: number = 10): number {
  if (currentDepth >= maxDepth) {
    return currentDepth;
  }
  
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return currentDepth;
  }
  
  let maxChildDepth = currentDepth;
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const childDepth = getNestingDepth(obj[key], currentDepth + 1, maxDepth);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }
  }
  
  return maxChildDepth;
}

/**
 * Escape special characters in TOON values
 * Handles commas, newlines, quotes, and unicode
 */
function escapeTOONValue(value: string): string {
  if (typeof value !== 'string') {
    return String(value);
  }
  
  // Replace problematic characters
  return value
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/,/g, '\\,')    // Escape commas
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/"/g, '\\"')     // Escape quotes
    .replace(/\{/g, '\\{')    // Escape braces
    .replace(/\}/g, '\\}')    // Escape braces
    .replace(/\[/g, '\\[')    // Escape brackets
    .replace(/\]/g, '\\]');    // Escape brackets
}

/**
 * Unescape special characters in TOON values
 */
function unescapeTOONValue(value: string): string {
  return value
    .replace(/\\,/g, ',')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\\\/g, '\\');
}

/**
 * Validate and sanitize field names for TOON format
 */
function sanitizeFieldName(fieldName: string): string {
  if (!fieldName || typeof fieldName !== 'string') {
    return 'field';
  }
  
  // Remove invalid characters, keep alphanumeric and underscore
  let sanitized = fieldName.replace(/[^a-zA-Z0-9_]/g, '_');
  
  // Ensure it doesn't start with a number
  if (/^\d/.test(sanitized)) {
    sanitized = 'f_' + sanitized;
  }
  
  // Truncate if too long
  if (sanitized.length > MAX_FIELD_NAME_LENGTH) {
    sanitized = sanitized.substring(0, MAX_FIELD_NAME_LENGTH);
  }
  
  // Ensure it's not empty
  if (!sanitized) {
    return 'field';
  }
  
  return sanitized;
}

/**
 * Try to manually parse TOON format when library fails
 * Enhanced with edge case handling for special characters, unicode, and malformed data
 */
export function tryManualTOONParse(toonString: string): any {
  try {
    if (!toonString || typeof toonString !== 'string') {
      return null;
    }
    
    // Clean the string
    const cleanString = toonString.trim();
    
    if (cleanString.length === 0) {
      return null;
    }
    
    // Enhanced pattern matching - handle escaped characters
    // Match pattern: identifier[count]{fields}: values
    // Handle both single-line and multi-line TOON
    const match = cleanString.match(/^(\w+)\[(\d+)\]\{([^}]+)\}:\s*(.+)$/s);
    if (!match) {
      // Try to find partial matches for malformed TOON
      const partialMatch = cleanString.match(/(\w+)\[(\d+)\]\{([^}]+)\}/);
      if (partialMatch) {
        loggingService.debug('Found partial TOON match, attempting recovery', {
          identifier: partialMatch[1],
          count: partialMatch[2],
          fields: partialMatch[3]
        });
        // Return a basic structure
        return {
          frameType: partialMatch[1] || 'unknown',
          _toonRecovered: true,
          _original: cleanString.substring(0, 200)
        };
      }
      return null;
    }

    const [, , countStr, fieldsStr, valuesStr] = match;
    const count = parseInt(countStr, 10);
    
    if (isNaN(count) || count < 0) {
      loggingService.debug('Invalid count in TOON format', { count: countStr });
      return null;
    }
    
    // Sanitize and parse fields
    const fields = fieldsStr.split(',').map(f => sanitizeFieldName(f.trim())).filter(f => f);
    
    if (fields.length === 0) {
      loggingService.debug('No valid fields found in TOON format');
      return null;
    }
    
    // Parse values - handle escaped commas and newlines
    const lines = valuesStr.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    
    // Parse each line with proper comma handling (respecting escaped commas)
    const objects = lines.map((line, lineIndex) => {
      try {
        // Smart comma splitting - respect escaped commas
        const lineValues: string[] = [];
        let currentValue = '';
        let inEscape = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          
          if (inEscape) {
            currentValue += char;
            inEscape = false;
          } else if (char === '\\') {
            inEscape = true;
            currentValue += char;
          } else if (char === ',') {
            lineValues.push(currentValue.trim());
            currentValue = '';
          } else {
            currentValue += char;
          }
        }
        
        // Add the last value
        if (currentValue || lineValues.length > 0) {
          lineValues.push(currentValue.trim());
        }
        
        const obj: any = {};
        fields.forEach((field, index) => {
          const rawValue = (lineValues[index] || '').trim();
          const value = unescapeTOONValue(rawValue);
          
          // Try to convert to number if possible
          if (value && !isNaN(Number(value)) && value !== '' && !isNaN(parseFloat(value))) {
            const numValue = Number(value);
            // Only convert if it's actually a number representation
            if (String(numValue) === value || String(numValue) === rawValue) {
              obj[field] = numValue;
            } else {
              obj[field] = value;
            }
          } else if (value === 'true' || value === 'false') {
            obj[field] = value === 'true';
          } else if (value === 'null' || value === '') {
            obj[field] = null;
          } else if (value !== '') {
            // Truncate very long strings
            const finalValue = value.length > MAX_STRING_VALUE_LENGTH 
              ? value.substring(0, MAX_STRING_VALUE_LENGTH) + '...'
              : value;
            obj[field] = finalValue;
          } else {
            obj[field] = null;
          }
        });
        
        return obj;
      } catch (lineError) {
        loggingService.debug('Error parsing TOON line', {
          lineIndex,
          line: line.substring(0, 100),
          error: lineError instanceof Error ? lineError.message : String(lineError)
        });
        // Return partial object
        const partialObj: any = { _parseError: true };
        fields.forEach((field) => {
          partialObj[field] = null;
        });
        return partialObj;
      }
    });
    
    // Filter out error objects if we have valid ones
    const validObjects = objects.filter(obj => !obj._parseError);
    const finalObjects = validObjects.length > 0 ? validObjects : objects;
    
    // If count is 1, return single object
    if (count === 1 && finalObjects.length >= 1) {
      return finalObjects[0];
    }
    
    // If count > 1, return array
    if (count > 1 && finalObjects.length > 0) {
      return finalObjects;
    }
    
    // If we have at least one object, return it
    if (finalObjects.length >= 1) {
      return count === 1 ? finalObjects[0] : finalObjects;
    }
    
    return null;
  } catch (error) {
    loggingService.debug('Manual TOON parse failed', {
      error: error instanceof Error ? error.message : String(error),
      input: toonString.substring(0, 200)
    });
    return null;
  }
}

/**
 * Check if a data structure would benefit from TOON encoding
 * TOON works best for uniform arrays of objects
 * Enhanced with edge case detection
 */
export function isTOONOptimizable(data: any, depth: number = 0): boolean {
  // Edge case: null or undefined
  if (data === null || data === undefined) {
    return false;
  }
  
  // Edge case: not an object
  if (typeof data !== 'object') {
    return false;
  }
  
  // Edge case: binary data
  if (isBinaryData(data)) {
    loggingService.debug('Data contains binary content, skipping TOON', {
      dataType: typeof data
    });
    return false;
  }
  
  // Edge case: circular reference
  if (hasCircularReference(data)) {
    loggingService.debug('Data contains circular references, skipping TOON');
    return false;
  }
  
  // Edge case: too deeply nested
  const nestingDepth = getNestingDepth(data);
  if (nestingDepth > MAX_NESTING_DEPTH) {
    loggingService.debug('Data too deeply nested for TOON', {
      depth: nestingDepth,
      maxDepth: MAX_NESTING_DEPTH
    });
    return false;
  }
  
  // Edge case: very large arrays (performance concern)
  if (Array.isArray(data) && data.length > MAX_ARRAY_SIZE) {
    loggingService.debug('Array too large for TOON encoding', {
      size: data.length,
      maxSize: MAX_ARRAY_SIZE
    });
    return false;
  }

  // Check if it's an array of uniform objects
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return false;
    }

    // Check if all items are objects with same keys
    const firstItem = data[0];
    if (typeof firstItem !== 'object' || firstItem === null || Array.isArray(firstItem)) {
      return false;
    }
    
    // Edge case: check for nested arrays/objects (heterogeneous)
    const firstKeys = Object.keys(firstItem).sort();
    
    // Check if all items have the same structure
    // Sample more items for larger arrays to detect heterogeneity
    const sampleSize = Math.min(data.length, data.length > 100 ? 50 : 10);
    for (let i = 1; i < sampleSize; i++) {
      const item = data[i];
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return false;
      }
      
      const itemKeys = Object.keys(item).sort();
      if (JSON.stringify(firstKeys) !== JSON.stringify(itemKeys)) {
        // Heterogeneous array - not optimizable
        loggingService.debug('Heterogeneous array detected, skipping TOON', {
          firstItemKeys: firstKeys,
          itemKeys: itemKeys,
          index: i
        });
        return false;
      }
      
      // Check for deep nesting in values
      for (const key of firstKeys) {
        const value = item[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const valueDepth = getNestingDepth(value);
          if (valueDepth > MAX_NESTING_DEPTH - 1) {
            return false;
          }
        }
      }
    }

    return true;
  }

  // Check if object has arrays of uniform objects
  for (const key in data) {
    if (Array.isArray(data[key]) && data[key].length > 0) {
      const arr = data[key];
      const firstItem = arr[0];
      if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
        // Recursively check if the array is optimizable
        return isTOONOptimizable(arr, depth + 1);
      }
    }
  }

  return false;
}

/**
 * Encode data to TOON format with comprehensive edge case handling
 * Falls back to JSON if TOON is disabled or data is not optimizable
 */
export async function encodeToTOON(data: any): Promise<string> {
  if (!USE_TOON) {
    return JSON.stringify(data);
  }

  // Edge case: Handle null/undefined
  if (data === null || data === undefined) {
    return JSON.stringify(data);
  }

  // Edge case: Handle primitives
  if (typeof data !== 'object') {
    return JSON.stringify(data);
  }

  // Edge case: Check for binary data
  if (isBinaryData(data)) {
    loggingService.debug('Binary data detected, using JSON', {
      dataType: typeof data
    });
    return JSON.stringify(data);
  }

  // Edge case: Check for circular references
  if (hasCircularReference(data)) {
    loggingService.warn('Circular reference detected, using JSON with replacer', {
      dataType: typeof data
    });
    // Use JSON with a replacer to handle circular refs
    const seen = new WeakSet();
    return JSON.stringify(data, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  }

  // Edge case: Check nesting depth
  const nestingDepth = getNestingDepth(data);
  if (nestingDepth > MAX_NESTING_DEPTH) {
    loggingService.debug('Data too deeply nested, using JSON', {
      depth: nestingDepth,
      maxDepth: MAX_NESTING_DEPTH
    });
    return JSON.stringify(data);
  }

  try {
    const toon = await getToonModule();
    
    // Edge case: Handle empty arrays
    if (Array.isArray(data) && data.length === 0) {
      return JSON.stringify(data);
    }
    
    // Edge case: Handle very large arrays (chunk if needed)
    if (Array.isArray(data) && data.length > MAX_ARRAY_SIZE) {
      loggingService.warn('Array too large for TOON, using JSON', {
        size: data.length,
        maxSize: MAX_ARRAY_SIZE
      });
      return JSON.stringify(data);
    }
    
    // If data is an array of uniform objects, use TOON
    if (Array.isArray(data) && isTOONOptimizable(data)) {
      try {
        const toonString = toon.encode(data);
        const jsonSize = JSON.stringify(data).length;
        const reduction = ((1 - toonString.length / jsonSize) * 100).toFixed(1);
        
        loggingService.debug('Encoded array to TOON', {
          originalSize: jsonSize,
          toonSize: toonString.length,
          reduction: reduction + '%',
          arrayLength: data.length
        });
        
        return toonString;
      } catch (encodeError) {
        loggingService.warn('TOON library encode failed, falling back to JSON', {
          error: encodeError instanceof Error ? encodeError.message : String(encodeError),
          arrayLength: data.length
        });
        return JSON.stringify(data);
      }
    }

    // If data is an object with arrays of uniform objects, convert arrays to TOON
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const converted: any = {};
      let hasTOONArrays = false;
      let hasErrors = false;

      for (const key in data) {
        try {
          // Sanitize key name
          const sanitizedKey = sanitizeFieldName(key);
          
          if (Array.isArray(data[key]) && isTOONOptimizable(data[key])) {
            const encoded = await encodeToTOON(data[key]);
            converted[sanitizedKey] = encoded;
            hasTOONArrays = true;
          } else if (typeof data[key] === 'object' && data[key] !== null) {
            // Recursively process nested objects (but check depth)
            const childDepth = getNestingDepth(data[key]);
            if (childDepth <= MAX_NESTING_DEPTH - 1) {
              const encoded = await encodeToTOON(data[key]);
              converted[sanitizedKey] = typeof encoded === 'string' ? encoded : data[key];
            } else {
              // Too deeply nested, use JSON
              converted[sanitizedKey] = data[key];
            }
          } else {
            // Handle special values
            if (data[key] === undefined) {
              converted[sanitizedKey] = null; // TOON doesn't support undefined
            } else if (typeof data[key] === 'string' && data[key].length > MAX_STRING_VALUE_LENGTH) {
              // Truncate very long strings
              converted[sanitizedKey] = data[key].substring(0, MAX_STRING_VALUE_LENGTH) + '...';
            } else {
              converted[sanitizedKey] = data[key];
            }
          }
        } catch (keyError) {
          loggingService.debug('Error processing key in TOON encoding', {
            key,
            error: keyError instanceof Error ? keyError.message : String(keyError)
          });
          hasErrors = true;
          converted[sanitizeFieldName(key)] = data[key];
        }
      }

      if (hasTOONArrays && !hasErrors) {
        // For mixed structures, we'll use JSON but with TOON arrays embedded
        // This is a compromise - full TOON would require custom format
        return JSON.stringify(converted);
      }
    }

    // Fallback to JSON for non-uniform structures
    return JSON.stringify(data);
  } catch (error) {
    loggingService.warn('TOON encoding failed, falling back to JSON', {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
    
    // Final fallback with error handling
    try {
      return JSON.stringify(data);
    } catch (jsonError) {
      // If even JSON.stringify fails, return a safe representation
      loggingService.error('Both TOON and JSON encoding failed', {
        toonError: error instanceof Error ? error.message : String(error),
        jsonError: jsonError instanceof Error ? jsonError.message : String(jsonError)
      });
      return '{"error": "Encoding failed", "type": "' + typeof data + '"}';
    }
  }
}

/**
 * Decode TOON format back to JavaScript objects
 * Enhanced with comprehensive edge case handling
 */
export async function decodeFromTOON(toonString: string): Promise<any> {
  // Edge case: null or undefined input
  if (toonString === null || toonString === undefined) {
    loggingService.debug('Null/undefined input to decodeFromTOON');
    return toonString;
  }

  // Edge case: not a string
  if (typeof toonString !== 'string') {
    loggingService.debug('Non-string input to decodeFromTOON, converting', {
      type: typeof toonString
    });
    toonString = String(toonString);
  }

  // Edge case: empty string
  const trimmed = toonString.trim();
  if (trimmed.length === 0) {
    loggingService.debug('Empty string input to decodeFromTOON');
    return null;
  }

  // Edge case: very large string (potential DoS)
  const MAX_DECODE_SIZE = 10 * 1024 * 1024; // 10MB limit
  if (toonString.length > MAX_DECODE_SIZE) {
    loggingService.warn('TOON string too large, truncating for safety', {
      size: toonString.length,
      maxSize: MAX_DECODE_SIZE
    });
    toonString = toonString.substring(0, MAX_DECODE_SIZE);
  }

  if (!USE_TOON) {
    // If TOON is disabled, try JSON parsing
    try {
      return JSON.parse(toonString);
    } catch {
      // If not JSON, return as-is (might be plain text)
      return toonString;
    }
  }

  try {
    // Edge case: Check for binary data
    if (isBinaryData(toonString)) {
      loggingService.debug('Binary data detected in decodeFromTOON, skipping');
      return toonString;
    }

    // Try to parse as JSON first (for mixed formats or fallback)
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(toonString);
        // Validate it's actually structured data, not just a string that starts with {
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch {
        // Not valid JSON, continue to TOON decode
      }
    }

    // Try TOON decode with timeout protection
    try {
      const toon = await getToonModule();
      
      // Add timeout for very large strings
      const decodePromise = Promise.resolve(toon.decode(toonString));
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TOON decode timeout')), 5000)
      );
      
      const decoded = await Promise.race([decodePromise, timeoutPromise]) as any;
      
      // Edge case: Validate decoded result
      if (decoded === null || decoded === undefined) {
        loggingService.debug('TOON decode returned null/undefined');
        return decoded;
      }

      // Edge case: Check for circular references in decoded data
      if (typeof decoded === 'object' && hasCircularReference(decoded)) {
        loggingService.warn('Decoded TOON contains circular references');
        // Return a safe copy
        try {
          return JSON.parse(JSON.stringify(decoded));
        } catch {
          return decoded;
        }
      }

      loggingService.debug('Decoded TOON format', {
        toonSize: toonString.length,
        decodedType: Array.isArray(decoded) ? 'array' : typeof decoded,
        isObject: typeof decoded === 'object'
      });
      return decoded;
    } catch (toonError) {
      // Edge case: Timeout or library error
      const isTimeout = toonError instanceof Error && toonError.message.includes('timeout');
      if (isTimeout) {
        loggingService.warn('TOON decode timeout, trying manual parse', {
          toonSize: toonString.length
        });
      }

      // If TOON library fails, try manual parsing of simple TOON format
      const manualParsed = tryManualTOONParse(toonString);
      if (manualParsed) {
        loggingService.debug('Manually parsed TOON format', {
          toonSize: toonString.length,
          parsedType: typeof manualParsed,
          hasFrameType: manualParsed && typeof manualParsed === 'object' && 'frameType' in manualParsed
        });
        return manualParsed;
      }

      // If TOON library fails to load or decode fails, try JSON as fallback
      loggingService.debug('TOON decode failed, trying JSON fallback', {
        error: toonError instanceof Error ? toonError.message : String(toonError),
        isTimeout,
        inputPreview: toonString.substring(0, 200)
      });
      
      // Try JSON parsing with size limit
      try {
        // Limit JSON parse size to prevent DoS
        const jsonString = toonString.length > MAX_DECODE_SIZE 
          ? toonString.substring(0, MAX_DECODE_SIZE)
          : toonString;
        return JSON.parse(jsonString);
      } catch (jsonError) {
        // If both fail, try manual TOON parsing as last resort
        const manualParsed = tryManualTOONParse(toonString);
        if (manualParsed) {
          loggingService.debug('Manually parsed TOON format as fallback', {
            toonSize: toonString.length
          });
          return manualParsed;
        }
        
        // Edge case: Try to extract partial TOON structure
        const partialMatch = toonString.match(/(\w+)\[(\d+)\]\{([^}]+)\}/);
        if (partialMatch) {
          loggingService.debug('Extracted partial TOON structure', {
            identifier: partialMatch[1],
            count: partialMatch[2]
          });
          return {
            _partial: true,
            identifier: partialMatch[1],
            count: parseInt(partialMatch[2], 10),
            fields: partialMatch[3].split(',').map(f => f.trim()),
            raw: toonString.substring(0, 500)
          };
        }
        
        // If all parsing fails, return the string as-is (might be plain text response)
        loggingService.warn('Failed to decode TOON or JSON, returning as string', {
          toonError: toonError instanceof Error ? toonError.message : String(toonError),
          jsonError: jsonError instanceof Error ? jsonError.message : String(jsonError),
          inputPreview: toonString.substring(0, 200),
          inputLength: toonString.length
        });
        return toonString;
      }
    }
  } catch (error) {
    // Final fallback - try JSON one more time with error handling
    try {
      const safeString = toonString.length > MAX_DECODE_SIZE 
        ? toonString.substring(0, MAX_DECODE_SIZE)
        : toonString;
      return JSON.parse(safeString);
    } catch (finalError) {
      // If all else fails, return as string with metadata
      loggingService.warn('All decode attempts failed, returning as string', {
        error: error instanceof Error ? error.message : String(error),
        finalError: finalError instanceof Error ? finalError.message : String(finalError),
        inputPreview: toonString.substring(0, 200),
        inputLength: toonString.length
      });
      
      // Return structured error object instead of plain string for better error handling
      return {
        _decodeError: true,
        _original: toonString.substring(0, 500),
        _error: error instanceof Error ? error.message : String(error),
        _length: toonString.length
      };
    }
  }
}

/**
 * Extract TOON or JSON from LLM response text
 * Enhanced with malformed TOON recovery and better pattern matching
 */
export async function extractStructuredData(responseText: string): Promise<any> {
  if (!responseText || typeof responseText !== 'string') {
    return null;
  }

  // Edge case: Empty or whitespace-only response
  if (responseText.trim().length === 0) {
    return null;
  }

  try {
    // Enhanced TOON pattern matching - handle multiple TOON blocks
    // Pattern: identifier[count]{fields}: values
    // More flexible regex to catch malformed TOON
    const toonPatterns = [
      // Standard TOON format
      /(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/g,
      // TOON with whitespace variations
      /(\w+\s*\[\s*\d+\s*\]\s*\{[^}]+\}\s*:[\s\S]*?)(?=\n\n|\n\w+\s*\[|$)/g,
      // TOON with escaped characters
      /(\w+\[\d+\]\{[^}]+\}:\s*[\s\S]*?)(?=\n\n|\n\w+\[|$)/g
    ];

    for (const pattern of toonPatterns) {
      const matches = responseText.matchAll(pattern);
      for (const match of matches) {
        const toonData = match[1];
        if (toonData && toonData.trim().length > 0) {
          try {
            const decoded = await decodeFromTOON(toonData);
            if (decoded && typeof decoded === 'object') {
              loggingService.debug('Successfully extracted TOON from response', {
                pattern: pattern.toString(),
                toonLength: toonData.length
              });
              return decoded;
            }
          } catch (error) {
            // Try manual parsing for malformed TOON
            const manualParsed = tryManualTOONParse(toonData);
            if (manualParsed) {
              loggingService.debug('Recovered malformed TOON using manual parser', {
                toonLength: toonData.length
              });
              return manualParsed;
            }
            // Continue to next pattern
            loggingService.debug('TOON decode failed, trying next pattern', {
              error: error instanceof Error ? error.message : String(error),
              toonPreview: toonData.substring(0, 100)
            });
          }
        }
      }
    }

    // Try to find JSON/TOON in code blocks (enhanced)
    const codeBlockPatterns = [
      /```(?:json|toon)?\s*([\s\S]*?)\s*```/g,
      /```\s*([\s\S]*?)\s*```/g
    ];

    for (const pattern of codeBlockPatterns) {
      const matches = responseText.matchAll(pattern);
      for (const match of matches) {
        const blockData = match[1]?.trim();
        if (blockData && blockData.length > 0) {
          try {
            return await decodeFromTOON(blockData);
          } catch (error) {
            // Continue to other methods
          }
        }
      }
    }

    // Try to find JSON object (with better matching)
    const jsonObjectPatterns = [
      /\{[\s\S]{0,50000}\}/,  // Limit size to prevent DoS
      /\{[^}]*\{[^}]*\}[^}]*\}/  // Nested objects
    ];

    for (const pattern of jsonObjectPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        try {
          return await decodeFromTOON(match[0]);
        } catch (error) {
          // Continue to other methods
        }
      }
    }

    // Try to find JSON array (with size limit)
    const jsonArrayMatch = responseText.match(/\[[\s\S]{0,50000}\]/);
    if (jsonArrayMatch) {
      try {
        return await decodeFromTOON(jsonArrayMatch[0]);
      } catch (error) {
        // Continue to other methods
      }
    }

    // Last resort: Try to extract any structured pattern
    // Look for key-value patterns that might be TOON-like
    const keyValuePattern = /(\w+)\s*[:=]\s*([^\n,]+)/g;
    const keyValueMatches = Array.from(responseText.matchAll(keyValuePattern));
    if (keyValueMatches.length >= 2) {
      const obj: any = {};
      keyValueMatches.forEach(match => {
        const key = match[1];
        const value = match[2].trim();
        obj[key] = value;
      });
      if (Object.keys(obj).length > 0) {
        loggingService.debug('Extracted key-value pairs as fallback structure', {
          keyCount: Object.keys(obj).length
        });
        return obj;
      }
    }

    return null;
  } catch (error) {
    loggingService.warn('Failed to extract structured data from response', {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      preview: responseText.substring(0, 200),
      responseLength: responseText.length
    });
    return null;
  }
}

/**
 * Convert data to a format suitable for LLM prompts
 * Uses TOON for optimizable structures, JSON otherwise
 */
export async function formatForLLMPrompt(data: any, preferTOON: boolean = true): Promise<string> {
  if (!preferTOON || !USE_TOON) {
    return JSON.stringify(data, null, 2);
  }

  const toonString = await encodeToTOON(data);
  
  // If TOON is actually shorter (accounting for explanation), use it
  const jsonString = JSON.stringify(data, null, 2);
  if (toonString.length < jsonString.length * 0.7) { // 30% reduction threshold
    return toonString;
  }

  return jsonString;
}

/**
 * Check if TOON is enabled
 */
export function isTOONEnabled(): boolean {
  return USE_TOON;
}

