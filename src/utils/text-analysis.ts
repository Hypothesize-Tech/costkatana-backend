/**
 * Simple text analysis helpers for prompts and responses.
 */

export function truncateForContext(text: string, maxChars: number): string {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 3) + '...';
}

export function wordCount(text: string): number {
  if (typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(wordCount(text) * 1.35);
}

export function stripPiiPlaceholder(text: string): string {
  return text
    .replace(/\s*\[REDACTED[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
