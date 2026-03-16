/**
 * Sanitize model IDs in API responses for consistent formatting and safety.
 * Recursively walks objects/arrays and normalizes string values that look like model IDs.
 */

const MODEL_ID_PATTERN =
  /^(?:[a-zA-Z0-9][\w.-]*\/)?[a-zA-Z0-9][\w.-]*(?::[a-zA-Z0-9][\w.-]*)?$/;

/**
 * Check if a string looks like a model ID (provider/model or model:version)
 */
function looksLikeModelId(value: string): boolean {
  if (typeof value !== 'string' || value.length > 200) return false;
  return (
    value.includes('.') ||
    value.includes(':') ||
    value.includes('/') ||
    MODEL_ID_PATTERN.test(value)
  );
}

/**
 * Sanitize a single model ID string: trim and allow only safe characters.
 */
function sanitizeModelId(id: string): string {
  const trimmed = String(id).trim();
  return trimmed.replace(/[\s\r\n]+/g, ' ').trim();
}

/**
 * Recursively sanitize model IDs in an object or array.
 * Leaves other values unchanged.
 */
export function sanitizeModelIdsInObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return (looksLikeModelId(obj) ? sanitizeModelId(obj) : obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeModelIdsInObject(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeModelIdsInObject(value);
    }
    return result as T;
  }

  return obj;
}
