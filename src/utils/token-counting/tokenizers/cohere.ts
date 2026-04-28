/**
 * Cohere tokenization.
 *
 * Cohere's tokenizer is a model-specific BPE. Authoritative counts come from
 * `/v1/tokenize` via cohere-ai (network call, requires API key).
 *
 * For sync fallback we use a 4-chars-per-token heuristic — Cohere's BPE is
 * close to OpenAI's tiktoken so this is in the right ballpark for English.
 */

export interface CohereCountOptions {
  apiKey: string;
  model?: string;
}

export async function countCohereTokensApi(
  text: string,
  options: CohereCountOptions,
): Promise<number | null> {
  if (!text) return 0;
  if (!options.apiKey) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CohereClient } = require('cohere-ai') as {
      CohereClient: new (cfg: { token: string }) => {
        tokenize: (req: {
          text: string;
          model?: string;
        }) => Promise<{ tokens: number[] }>;
      };
    };
    const client = new CohereClient({ token: options.apiKey });
    const res = await client.tokenize({
      text,
      model: options.model || 'command-r',
    });
    return Array.isArray(res.tokens) ? res.tokens.length : null;
  } catch {
    return null;
  }
}

export function estimateCohereTokensHeuristic(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
