/**
 * Mistral tokenization via mistral-tokenizer-js (offline BPE, pure JS).
 * Same vocabulary as Mistral 7B / Mixtral / Mistral Large.
 */

type MistralTokenizer = { encode: (t: string) => number[] };

let tokenizer: MistralTokenizer | null = null;

function getTokenizer(): MistralTokenizer | null {
  if (tokenizer) return tokenizer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('mistral-tokenizer-js');
    const tk = (mod && (mod.default || mod)) as MistralTokenizer;
    tokenizer = tk;
    return tokenizer;
  } catch {
    return null;
  }
}

export function countMistralTokensLocal(text: string): number | null {
  if (!text) return 0;
  const tk = getTokenizer();
  if (!tk) return null;
  try {
    return tk.encode(text).length;
  } catch {
    return null;
  }
}
