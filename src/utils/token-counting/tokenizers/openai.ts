import type { Tiktoken } from 'js-tiktoken';

/**
 * OpenAI tokenization via js-tiktoken (offline, accurate).
 * - cl100k_base : GPT-3.5-Turbo, GPT-4, GPT-4-Turbo, embeddings v2/3
 * - o200k_base  : GPT-4o, GPT-4o-mini, o1, o3, o4 family
 *
 * Lazily instantiated — js-tiktoken loads vocab on first use.
 */

type Encoder = { encode: (text: string) => number[] };

let cl100k: Encoder | null = null;
let o200k: Encoder | null = null;

function pickEncoding(model?: string): 'o200k_base' | 'cl100k_base' {
  const m = (model || '').toLowerCase();
  if (m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('o1') ||
      m.includes('o3') || m.includes('o4') || m.includes('gpt-5')) {
    return 'o200k_base';
  }
  return 'cl100k_base';
}

function getEncoder(model?: string): Encoder | null {
  const enc = pickEncoding(model);
  try {
    if (enc === 'o200k_base') {
      if (!o200k) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getEncoding } = require('js-tiktoken') as {
          getEncoding: (name: string) => Tiktoken;
        };
        o200k = getEncoding('o200k_base');
      }
      return o200k;
    }
    if (!cl100k) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEncoding } = require('js-tiktoken') as {
        getEncoding: (name: string) => Tiktoken;
      };
      cl100k = getEncoding('cl100k_base');
    }
    return cl100k;
  } catch {
    return null;
  }
}

export function countOpenAITokens(text: string, model?: string): number | null {
  if (!text) return 0;
  const enc = getEncoder(model);
  if (!enc) return null;
  try {
    return enc.encode(text).length;
  } catch {
    return null;
  }
}
