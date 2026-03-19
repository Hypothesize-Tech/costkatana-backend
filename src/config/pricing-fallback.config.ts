/**
 * Hardcoded pricing fallback used when pricing registry and DB lookup fail.
 * Last verified: 2026-03. Update periodically against provider docs.
 */

export interface FallbackPriceEntry {
  inputCostPer1K: number;
  outputCostPer1K: number;
}

export type ProviderModelMatcher = (
  provider: string,
  model: string,
) => FallbackPriceEntry | null;

/**
 * Match provider/model and return pricing. Order matters - more specific matches first.
 */
const PRICING_RULES: Array<{
  match: (provider: string, model: string) => boolean;
  inputCostPer1K: number;
  outputCostPer1K: number;
}> = [
  // OpenAI
  {
    match: (p, m) => p === 'openai' && m.includes('o4-mini'),
    inputCostPer1K: 0.0011,
    outputCostPer1K: 0.0044,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('o4'),
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.06,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('o3-mini'),
    inputCostPer1K: 0.0011,
    outputCostPer1K: 0.0044,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('o3'),
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.06,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('o1-mini'),
    inputCostPer1K: 0.0003,
    outputCostPer1K: 0.0012,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('o1'),
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.06,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('gpt-4o-mini'),
    inputCostPer1K: 0.00015,
    outputCostPer1K: 0.0006,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('gpt-4.1'),
    inputCostPer1K: 0.002,
    outputCostPer1K: 0.008,
  },
  {
    match: (p, m) =>
      p === 'openai' &&
      (m.includes('gpt-4o') ||
        m.includes('gpt-4-turbo') ||
        m.includes('gpt-4-1106')),
    inputCostPer1K: 0.0025,
    outputCostPer1K: 0.01,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('gpt-4'),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.006,
  },
  {
    match: (p, m) => p === 'openai' && m.includes('gpt-3.5-turbo'),
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0015,
  },
  // Anthropic
  {
    match: (p, m) =>
      p === 'anthropic' &&
      (m.includes('claude-4-sonnet') || m.includes('claude-sonnet-4')),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  {
    match: (p, m) =>
      p === 'anthropic' &&
      (m.includes('claude-3-7-sonnet') ||
        m.includes('claude-3-5-sonnet') ||
        m.includes('claude-sonnet-3')),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  {
    match: (p, m) =>
      p === 'anthropic' &&
      (m.includes('claude-4-haiku') || m.includes('claude-haiku-4')),
    inputCostPer1K: 0.001,
    outputCostPer1K: 0.005,
  },
  {
    match: (p, m) =>
      p === 'anthropic' &&
      (m.includes('claude-3-5-haiku') || m.includes('claude-haiku-3')),
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.004,
  },
  {
    match: (p, m) => p === 'anthropic' && m.includes('claude-3-opus'),
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
  },
  {
    match: (p, m) => p === 'anthropic' && m.includes('claude-3-sonnet'),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  {
    match: (p, m) => p === 'anthropic' && m.includes('claude-3-haiku'),
    inputCostPer1K: 0.00025,
    outputCostPer1K: 0.00125,
  },
  {
    match: (p, m) => p === 'anthropic' && m.includes('claude'),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  // Google
  {
    match: (p, m) => p === 'google' && m.includes('gemini-2.5-pro'),
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.01,
  },
  {
    match: (p, m) =>
      p === 'google' &&
      (m.includes('gemini-2.0-flash') || m.includes('gemini-2-flash')),
    inputCostPer1K: 0.0001,
    outputCostPer1K: 0.0004,
  },
  {
    match: (p, m) => p === 'google' && m.includes('gemini-2.0'),
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.005,
  },
  {
    match: (p, m) => p === 'google' && m.includes('gemini-1.5-pro'),
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.005,
  },
  {
    match: (p, m) => p === 'google' && m.includes('gemini-pro'),
    inputCostPer1K: 0.00025,
    outputCostPer1K: 0.0005,
  },
  {
    match: (p, m) => p === 'google' && m.includes('gemini'),
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0015,
  },
  // AWS Bedrock
  {
    match: (p, m) =>
      (p === 'bedrock' || p === 'amazon') &&
      (m.includes('llama-3.1-70b') || m.includes('llama-3-70b')),
    inputCostPer1K: 0.00265,
    outputCostPer1K: 0.0035,
  },
  {
    match: (p, m) =>
      (p === 'bedrock' || p === 'amazon') &&
      (m.includes('llama-3.1-8b') || m.includes('llama-3-8b')),
    inputCostPer1K: 0.0003,
    outputCostPer1K: 0.0006,
  },
  {
    match: (p, m) => (p === 'bedrock' || p === 'amazon') && m.includes('llama'),
    inputCostPer1K: 0.001,
    outputCostPer1K: 0.0015,
  },
  {
    match: (p, m) =>
      (p === 'bedrock' || p === 'amazon') &&
      (m.includes('claude-sonnet') || m.includes('claude-3-5-sonnet')),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  {
    match: (p, m) =>
      (p === 'bedrock' || p === 'amazon') && m.includes('claude'),
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
  },
  {
    match: (p) => p === 'bedrock' || p === 'amazon',
    inputCostPer1K: 0.0015,
    outputCostPer1K: 0.002,
  },
  // Groq (per-model)
  {
    match: (p, m) => p === 'groq' && m.includes('llama-3.3-70b'),
    inputCostPer1K: 0.00059,
    outputCostPer1K: 0.00079,
  },
  {
    match: (p, m) => p === 'groq' && m.includes('llama-3.1-8b'),
    inputCostPer1K: 0.00005,
    outputCostPer1K: 0.00008,
  },
  {
    match: (p, m) => p === 'groq' && m.includes('mixtral'),
    inputCostPer1K: 0.00024,
    outputCostPer1K: 0.00024,
  },
  {
    match: (p, m) => p === 'groq',
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0005,
  },
  // Mistral
  {
    match: (p, m) => p === 'mistral' && m.includes('large'),
    inputCostPer1K: 0.002,
    outputCostPer1K: 0.006,
  },
  {
    match: (p, m) => p === 'mistral' && m.includes('medium'),
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.0024,
  },
  {
    match: (p, m) => p === 'mistral' && m.includes('small'),
    inputCostPer1K: 0.0002,
    outputCostPer1K: 0.0006,
  },
  {
    match: (p, m) => p === 'mistral',
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0015,
  },
  // Cohere
  {
    match: (p, m) => p === 'cohere' && m.includes('command-r'),
    inputCostPer1K: 0.00015,
    outputCostPer1K: 0.0006,
  },
  {
    match: (p, m) => p === 'cohere' && m.includes('command'),
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0015,
  },
  {
    match: (p, m) => p === 'cohere',
    inputCostPer1K: 0.0003,
    outputCostPer1K: 0.0006,
  },
];

const DEFAULT_FALLBACK: FallbackPriceEntry = {
  inputCostPer1K: 0.0015,
  outputCostPer1K: 0.002,
};

/**
 * Look up hardcoded fallback pricing for a provider/model.
 */
export function getHardcodedFallbackPricing(
  provider: string,
  model: string,
): FallbackPriceEntry {
  for (const rule of PRICING_RULES) {
    if (rule.match(provider, model)) {
      return {
        inputCostPer1K: rule.inputCostPer1K,
        outputCostPer1K: rule.outputCostPer1K,
      };
    }
  }
  return DEFAULT_FALLBACK;
}
