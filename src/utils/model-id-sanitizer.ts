/**
 * Sanitize model IDs for use in APIs and storage (remove unsafe chars, truncate).
 */
const MAX_MODEL_ID_LENGTH = 256;
const SAFE_MODEL_ID_REGEX = /^[a-zA-Z0-9._:-]+$/;

export function sanitizeModelId(modelId: string): string {
  if (typeof modelId !== 'string') return '';
  const trimmed = modelId.trim();
  if (!trimmed) return '';
  const safe = trimmed.replace(/[^\w.-:]/g, '-');
  return safe.slice(0, MAX_MODEL_ID_LENGTH);
}

export function isValidModelId(modelId: string): boolean {
  return (
    typeof modelId === 'string' &&
    SAFE_MODEL_ID_REGEX.test(modelId.trim()) &&
    modelId.length <= MAX_MODEL_ID_LENGTH
  );
}
