/**
 * Response Sanitizer Utility
 * Removes MongoDB IDs, technical details, and other internal information
 * from responses before displaying them to users in the chat UI
 */

/**
 * Sanitize a response by removing MongoDB IDs and technical details
 * @param response - The raw response string or object
 * @returns Sanitized response string suitable for display
 */
export function sanitizeResponseForDisplay(response: any): string {
  if (!response) return '';

  let responseStr = typeof response === 'string' ? response : JSON.stringify(response, null, 2);

  // Remove MongoDB ObjectIDs (24 hex characters)
  responseStr = responseStr.replace(/[a-fA-F0-9]{24}/g, '[ID]');

  // Remove common MongoDB fields that users don't need to see
  const fieldsToRemove = [
    /"_id"\s*:\s*"[^"]+"/g,
    /"id"\s*:\s*"[a-fA-F0-9]{24}"/g,
    /"__v"\s*:\s*\d+/g,
    /"createdAt"\s*:\s*"[^"]+"/g,
    /"updatedAt"\s*:\s*"[^"]+"/g,
    /"created_at"\s*:\s*"[^"]+"/g,
    /"updated_at"\s*:\s*"[^"]+"/g,
  ];

  fieldsToRemove.forEach(pattern => {
    responseStr = responseStr.replace(pattern, '');
  });

  // Remove empty objects and arrays left after removing fields
  responseStr = responseStr.replace(/,\s*,/g, ',');
  responseStr = responseStr.replace(/{\s*,/g, '{');
  responseStr = responseStr.replace(/,\s*}/g, '}');
  responseStr = responseStr.replace(/\[\s*,/g, '[');
  responseStr = responseStr.replace(/,\s*]/g, ']');

  // Clean up multiple consecutive newlines
  responseStr = responseStr.replace(/\n{3,}/g, '\n\n');

  // Remove standalone "ID: [ID]" lines
  responseStr = responseStr.replace(/^\s*ID\s*:\s*\[ID\]\s*$/gm, '');

  // Format the response nicely if it's JSON-like
  try {
    // Try to parse as JSON to format it nicely
    const parsed = JSON.parse(responseStr);
    if (typeof parsed === 'object') {
      // Recursively remove IDs from nested objects
      const sanitized = sanitizeObject(parsed);
      return formatObjectForDisplay(sanitized);
    }
  } catch {
    // Not JSON, return as is after cleaning
  }

  return responseStr.trim();
}

/**
 * Recursively sanitize an object by removing MongoDB IDs and technical fields
 */
function sanitizeObject(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip MongoDB-specific fields
      if (key === '_id' || key === '__v') {
        continue;
      }

      // Skip timestamp fields unless they're meaningful (like "Created At" in user-friendly format)
      if (key === 'createdAt' || key === 'updatedAt' || key === 'created_at' || key === 'updated_at') {
        // Only include if it's already formatted nicely
        if (typeof value === 'string' && value.includes('T') && value.includes('Z')) {
          continue; // Skip ISO timestamps
        }
      }

      // Skip MongoDB ObjectID strings
      if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) {
        continue;
      }

      // Recursively sanitize nested objects
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Format an object for display in a user-friendly way
 */
function formatObjectForDisplay(obj: any, indent = 0): string {
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    
    // For arrays of objects, format each item nicely
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      return obj.map(item => formatObjectForDisplay(item, indent + 2)).join('\n\n');
    }
    
    return obj.map(item => formatValueForDisplay(item, indent + 2)).join(', ');
  }

  if (obj && typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';

    const indentStr = ' '.repeat(indent);
    const lines = entries.map(([key, value]) => {
      const formattedKey = formatKey(key);
      const formattedValue = formatValueForDisplay(value, indent + 2);
      return `${indentStr}${formattedKey}: ${formattedValue}`;
    });

    return lines.join('\n');
  }

  return formatValueForDisplay(obj, indent);
}

/**
 * Format a key name for display (humanize it)
 */
function formatKey(key: string): string {
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format a value for display
 */
function formatValueForDisplay(value: any, indent: number): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value.toString();
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map(item => ' '.repeat(indent + 2) + formatValueForDisplay(item, indent + 2)).join(',\n')}\n${' '.repeat(indent)}]`;
  }
  if (typeof value === 'object') {
    return formatObjectForDisplay(value, indent);
  }
  return String(value);
}

/**
 * Format integration command results for display
 * Extracts meaningful information and presents it in a user-friendly format
 * Returns both the display message and metadata for UI rendering
 */
export function formatIntegrationResultForDisplay(result: any): string | { message: string; viewLinks?: any[]; metadata?: any } {
  if (!result || !result.success) {
    return result?.message || 'Command execution failed';
  }

  // If result has viewLinks and metadata (Google services), return structured response
  if (result.viewLinks || result.metadata) {
    return {
      message: result.message || 'Operation completed successfully',
      viewLinks: result.viewLinks,
      metadata: result.metadata
    };
  }

  // If result has a message, use it as base
  let display = result.message || '';

  // If result has data, format it nicely
  if (result.data) {
    const sanitizedData = sanitizeObject(result.data);
    
    // Format based on data type
    if (Array.isArray(sanitizedData)) {
      if (sanitizedData.length === 0) {
        display += '\n\nNo items found.';
      } else {
        display += '\n\n';
        sanitizedData.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            // Extract meaningful fields (name, title, description, etc.)
            const name = item.name || item.title || item.label || item.identifier || `Item ${index + 1}`;
            const description = item.description || item.summary || '';
            const type = item.type || '';
            
            display += `\n**${name}**`;
            if (type) display += ` (${type})`;
            if (description) display += `\n${description}`;
            display += '\n';
          } else {
            display += `\n- ${item}`;
          }
        });
      }
    } else if (typeof sanitizedData === 'object') {
      // Format object data
      const formatted = formatObjectForDisplay(sanitizedData);
      if (formatted && formatted !== '{}') {
        display += '\n\n' + formatted;
      }
    }
  }

  return display.trim();
}

