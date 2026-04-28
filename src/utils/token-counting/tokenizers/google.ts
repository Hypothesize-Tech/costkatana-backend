/**
 * Google / Gemini tokenization.
 *
 * Gemini uses a SentencePiece tokenizer that isn't shipped as an offline JS
 * package. The authoritative path is `model.countTokens(...)` from
 * @google/generative-ai which makes a network call.
 *
 * For sync callers (budget pre-checks where we don't want to await a network
 * round-trip), we use a word-boundary heuristic that is roughly within ~10%
 * of true Gemini counts for English prose. Always mark `estimated: true`.
 */

export interface GoogleCountOptions {
  apiKey: string;
  model: string;
}

export async function countGoogleTokensApi(
  text: string,
  options: GoogleCountOptions,
): Promise<number | null> {
  if (!text) return 0;
  if (!options.apiKey) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleGenerativeAI } = require('@google/generative-ai') as {
      GoogleGenerativeAI: new (key: string) => {
        getGenerativeModel: (cfg: { model: string }) => {
          countTokens: (
            input: string | { contents: { parts: { text: string }[] }[] },
          ) => Promise<{ totalTokens: number }>;
        };
      };
    };
    const client = new GoogleGenerativeAI(options.apiKey);
    const model = client.getGenerativeModel({ model: options.model });
    const result = await model.countTokens(text);
    return typeof result.totalTokens === 'number' ? result.totalTokens : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic for Gemini when no API key is available.
 * SentencePiece on English averages ~1 token per word with ~5% overhead;
 * for code / non-English this skews low.
 */
export function estimateGoogleTokensHeuristic(text: string): number {
  if (!text) return 0;
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return Math.ceil(words * 1.05);
}
