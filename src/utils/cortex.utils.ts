/**
 * Cortex meta-language and optimization utilities.
 */

import * as crypto from 'crypto';

/** Cortex frame type for validation - accepts any frame-like object */
export type CortexFrameLike = Record<string, unknown> & {
  frameType?: string;
  action?: unknown;
  target?: unknown;
  question?: string;
  task?: unknown;
};

/** Validation result for Cortex frames */
export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  frameType?: string;
  complexity?: number;
}

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

/** Validate a Cortex frame structure */
export function validateCortexFrame(
  frame: CortexFrameLike | null | undefined,
): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];

  if (!frame || typeof frame !== 'object') {
    return {
      isValid: false,
      errors: [{ code: 'INVALID_FRAME', message: 'Frame must be an object' }],
      warnings: [],
    };
  }

  const frameType = frame.frameType ?? undefined;
  if (!frameType) {
    return {
      isValid: false,
      errors: [
        { code: 'MISSING_FRAME_TYPE', message: 'Frame must have frameType' },
      ],
      warnings: [],
    };
  }

  if (frameType === 'event' && !frame.action) {
    errors.push({
      code: 'MISSING_ACTION',
      message: 'Event frames require action',
    });
  }

  const f = frame as Record<string, unknown>;
  if (frameType === 'query' && !f.target && !f.question && !f.task) {
    warnings.push({
      code: 'INCOMPLETE_QUERY',
      message: 'Query may be incomplete',
    });
  }

  let complexity = 1;
  for (const k of Object.keys(f)) {
    if (k !== 'frameType' && f[k] !== undefined) complexity += 1;
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    frameType,
    complexity,
  };
}

/** Generate a deterministic hash for a Cortex frame */
export function generateCortexHash(
  frame: CortexFrameLike | null | undefined,
): string {
  const obj = frame as Record<string, unknown> | null;
  const str = JSON.stringify(obj, Object.keys(obj || {}).sort());
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

/** Serialize a Cortex frame to LISP-like string format */
export function serializeCortexFrame(
  frame: CortexFrameLike | null | undefined,
): string {
  if (!frame) return '';
  const obj = frame as Record<string, unknown>;
  const parts: string[] = [`(${(obj.frameType as string) || 'unknown'}`];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'frameType') continue;
    if (v === undefined || v === null) continue;
    const val =
      typeof v === 'string' && (v.includes(' ') || v.includes('"'))
        ? `"${v.replace(/"/g, '\\"')}"`
        : typeof v === 'object'
          ? JSON.stringify(v)
          : typeof v === 'string'
            ? v
            : JSON.stringify(v);
    parts.push(`${k}:${val}`);
  }
  return parts.join(' ') + ')';
}

/** Resolve $ref references within a frame using optional context (default: frame itself) */
export function resolveAllReferences<T extends object>(
  frame: T,
  context?: CortexFrameLike,
): T {
  if (!frame) return frame;
  const ctx = (context ?? frame) as Record<string, unknown>;
  const out = { ...(frame as object) } as T & Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v.startsWith('$')) {
      const path = v.slice(1).split('.');
      let val: unknown = ctx;
      for (const p of path) {
        val = (val as Record<string, unknown>)?.[p];
      }
      (out as Record<string, unknown>)[k] = val ?? v;
    }
  }
  return out;
}
