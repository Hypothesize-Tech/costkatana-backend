/**
 * Cortex meta-language and optimization utilities.
 */

/** Escape special tokens for Cortex prompt compression. */
export function escapeCortexSpecialChars(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Estimate token reduction ratio from Cortex-style compression (typical 0.4–0.6). */
export function estimateCortexCompressionRatio(
  originalLength: number,
  compressedLength: number,
): number {
  if (originalLength <= 0) return 1;
  return compressedLength / originalLength;
}

/** Common Cortex semantic primitive prefixes for routing. */
export const CORTEX_PREFIXES = [
  'query',
  'answer',
  'instruction',
  'context',
  'example',
  'constraint',
] as const;

export function hasCortexPrefix(text: string): boolean {
  const lower = (text || '').trim().toLowerCase();
  return CORTEX_PREFIXES.some(
    (p) => lower.startsWith(p + ':') || lower.startsWith(p + ' '),
  );
}
