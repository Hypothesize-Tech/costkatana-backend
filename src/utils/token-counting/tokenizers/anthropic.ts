/**
 * Anthropic tokenization.
 *
 * - Local (sync): @anthropic-ai/tokenizer ships Anthropic's BPE vocab. This is
 *   the legacy Claude 1/2 tokenizer; for Claude 3+ the vocabulary changed but
 *   the token counts are within ~3-7% which is much better than running an
 *   OpenAI tokenizer through Claude text.
 *
 * - Authoritative (async): Anthropic exposes POST /v1/messages/count_tokens.
 *   This is the only way to get exact Claude 3+ counts without making the
 *   real chat call. Requires an API key.
 *   Docs: https://docs.anthropic.com/en/api/messages-count-tokens
 */

let localTokenizer: { countTokens: (t: string) => number } | null = null;

function getLocalTokenizer(): { countTokens: (t: string) => number } | null {
  if (localTokenizer) return localTokenizer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require('@anthropic-ai/tokenizer') as {
      countTokens: (t: string) => number;
    };
    localTokenizer = { countTokens: lib.countTokens };
    return localTokenizer;
  } catch {
    return null;
  }
}

export function countAnthropicTokensLocal(text: string): number | null {
  if (!text) return 0;
  const tk = getLocalTokenizer();
  if (!tk) return null;
  try {
    return tk.countTokens(text);
  } catch {
    return null;
  }
}

export interface AnthropicCountOptions {
  apiKey: string;
  model: string;
  apiVersion?: string;
  apiBase?: string;
}

/**
 * Authoritative Claude 3+ token count via Anthropic's count_tokens endpoint.
 * Falls back to null on failure — caller should degrade to local tokenizer.
 */
export async function countAnthropicTokensApi(
  text: string,
  options: AnthropicCountOptions,
): Promise<number | null> {
  if (!text) return 0;
  if (!options.apiKey) return null;

  const url =
    (options.apiBase || 'https://api.anthropic.com') +
    '/v1/messages/count_tokens';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': options.apiVersion || '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { input_tokens?: number };
    return typeof data.input_tokens === 'number' ? data.input_tokens : null;
  } catch {
    return null;
  }
}
