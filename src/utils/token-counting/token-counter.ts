import { detectProvider } from './provider-detect';
import {
  AsyncCountOptions,
  CountOptions,
  ProviderName,
  TokenCount,
  UsageBreakdown,
} from './types';
import { countOpenAITokens } from './tokenizers/openai';
import {
  countAnthropicTokensApi,
  countAnthropicTokensLocal,
} from './tokenizers/anthropic';
import {
  countGoogleTokensApi,
  estimateGoogleTokensHeuristic,
} from './tokenizers/google';
import {
  countCohereTokensApi,
  estimateCohereTokensHeuristic,
} from './tokenizers/cohere';
import { countMistralTokensLocal } from './tokenizers/mistral';

/**
 * Generic 4-chars-per-token heuristic. Last-resort fallback only.
 */
function genericHeuristic(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Synchronous token count using the best offline tokenizer for the provider.
 *
 * Returns `{ tokens, source, estimated, provider, model }` so callers can
 * surface accuracy in their reports. Never throws — degrades through the
 * fallback chain (local tokenizer -> heuristic -> 0).
 *
 * Use `countTokensAuthoritative` instead when you have an API key and need
 * an exact count for billing reconciliation.
 */
export function countTokens(text: string, options: CountOptions = {}): TokenCount {
  const provider = detectProvider(options.provider, options.model);
  const safeText = typeof text === 'string' ? text : '';

  if (!safeText) {
    return { tokens: 0, source: 'local_tokenizer', estimated: false, provider, model: options.model };
  }

  switch (provider) {
    case 'openai': {
      const n = countOpenAITokens(safeText, options.model);
      if (n !== null) {
        return { tokens: n, source: 'local_tokenizer', estimated: false, provider, model: options.model };
      }
      return { tokens: genericHeuristic(safeText), source: 'heuristic', estimated: true, provider, model: options.model };
    }
    case 'anthropic': {
      const n = countAnthropicTokensLocal(safeText);
      if (n !== null) {
        // The local Anthropic vocab is Claude 1/2 era; Claude 3+ drifts ~3-7%.
        return { tokens: n, source: 'local_tokenizer', estimated: true, provider, model: options.model };
      }
      return { tokens: genericHeuristic(safeText), source: 'heuristic', estimated: true, provider, model: options.model };
    }
    case 'mistral': {
      const n = countMistralTokensLocal(safeText);
      if (n !== null) {
        return { tokens: n, source: 'local_tokenizer', estimated: false, provider, model: options.model };
      }
      return { tokens: genericHeuristic(safeText), source: 'heuristic', estimated: true, provider, model: options.model };
    }
    case 'google': {
      return {
        tokens: estimateGoogleTokensHeuristic(safeText),
        source: 'heuristic',
        estimated: true,
        provider,
        model: options.model,
      };
    }
    case 'cohere': {
      return {
        tokens: estimateCohereTokensHeuristic(safeText),
        source: 'heuristic',
        estimated: true,
        provider,
        model: options.model,
      };
    }
    case 'meta':
    case 'amazon':
    case 'bedrock':
    case 'unknown':
    default: {
      return {
        tokens: genericHeuristic(safeText),
        source: 'heuristic',
        estimated: true,
        provider,
        model: options.model,
      };
    }
  }
}

/**
 * Authoritative async token count using the provider's count-tokens endpoint
 * when available. Falls back to `countTokens` if no API key, the call fails,
 * or `offline: true` is passed.
 */
export async function countTokensAuthoritative(
  text: string,
  options: AsyncCountOptions = {},
): Promise<TokenCount> {
  const provider = detectProvider(options.provider, options.model);
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) {
    return { tokens: 0, source: 'provider_api', estimated: false, provider, model: options.model };
  }
  if (options.offline || !options.apiKey) {
    return countTokens(safeText, options);
  }

  if (provider === 'anthropic' && options.model) {
    const n = await countAnthropicTokensApi(safeText, {
      apiKey: options.apiKey,
      model: options.model,
    });
    if (n !== null) {
      return { tokens: n, source: 'provider_api', estimated: false, provider, model: options.model };
    }
  } else if (provider === 'google' && options.model) {
    const n = await countGoogleTokensApi(safeText, {
      apiKey: options.apiKey,
      model: options.model,
    });
    if (n !== null) {
      return { tokens: n, source: 'provider_api', estimated: false, provider, model: options.model };
    }
  } else if (provider === 'cohere') {
    const n = await countCohereTokensApi(safeText, {
      apiKey: options.apiKey,
      model: options.model,
    });
    if (n !== null) {
      return { tokens: n, source: 'provider_api', estimated: false, provider, model: options.model };
    }
  }

  return countTokens(safeText, options);
}

/**
 * Extract usage from a provider response. Recognizes:
 *   - OpenAI:    { prompt_tokens, completion_tokens, total_tokens, completion_tokens_details.reasoning_tokens }
 *   - Anthropic: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 *   - Bedrock:   shape depends on underlying model; we read the inner usage if present
 *   - Gemini:    { promptTokenCount, candidatesTokenCount, totalTokenCount } (usageMetadata)
 *   - Cohere:    { meta.billed_units.input_tokens, output_tokens }
 *
 * Returns `null` if no usage field is present so callers can decide whether
 * to fall back to local estimation.
 */
export function extractUsageFromResponse(
  response: unknown,
  options: CountOptions = {},
): UsageBreakdown | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, any>;
  const provider = detectProvider(options.provider, options.model);

  // Gemini-style usageMetadata
  const meta = r.usageMetadata;
  if (meta && typeof meta === 'object') {
    const inputTokens = Number(meta.promptTokenCount ?? 0) || 0;
    const outputTokens = Number(meta.candidatesTokenCount ?? 0) || 0;
    const totalTokens =
      Number(meta.totalTokenCount ?? inputTokens + outputTokens) || 0;
    if (inputTokens || outputTokens || totalTokens) {
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        source: 'response_usage',
        estimated: false,
        provider,
        model: options.model,
      };
    }
  }

  // Cohere v2 billed_units
  const billed = r.meta?.billed_units;
  if (billed && typeof billed === 'object') {
    const inputTokens = Number(billed.input_tokens ?? 0) || 0;
    const outputTokens = Number(billed.output_tokens ?? 0) || 0;
    if (inputTokens || outputTokens) {
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        source: 'response_usage',
        estimated: false,
        provider,
        model: options.model,
      };
    }
  }

  // OpenAI / Anthropic / Bedrock unified `usage` field
  const usage = r.usage;
  if (usage && typeof usage === 'object') {
    const inputTokens =
      Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
    const outputTokens =
      Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    const totalTokens =
      Number(usage.total_tokens ?? inputTokens + outputTokens) || 0;

    const out: UsageBreakdown = {
      inputTokens,
      outputTokens,
      totalTokens,
      source: 'response_usage',
      estimated: false,
      provider,
      model: options.model,
    };

    if (typeof usage.cache_read_input_tokens === 'number') {
      out.cacheReadInputTokens = usage.cache_read_input_tokens;
    }
    if (typeof usage.cache_creation_input_tokens === 'number') {
      out.cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }
    if (typeof usage.completion_tokens_details?.reasoning_tokens === 'number') {
      out.reasoningTokens = usage.completion_tokens_details.reasoning_tokens;
    }

    if (inputTokens || outputTokens || totalTokens) return out;
  }

  return null;
}

/**
 * Count tokens for a list of chat messages using a provider-aware tokenizer
 * plus a per-message overhead (role markers, separators).
 *
 * Overhead numbers come from OpenAI's published guidance for chat completions
 * (~4 tokens per message). For other providers we use the same constant as a
 * coarse approximation; mark `estimated: true` accordingly.
 */
export function countChatMessageTokens(
  messages: Array<{ role?: string; content?: string }>,
  options: CountOptions = {},
): TokenCount {
  if (!Array.isArray(messages) || messages.length === 0) {
    const provider = detectProvider(options.provider, options.model);
    return { tokens: 0, source: 'local_tokenizer', estimated: false, provider, model: options.model };
  }

  let total = 0;
  let estimated = false;
  let provider: ProviderName = 'unknown';
  let bestSource: TokenCount['source'] = 'local_tokenizer';

  for (const msg of messages) {
    const text = `${msg.role || ''}\n${msg.content || ''}`;
    const c = countTokens(text, options);
    total += c.tokens + 4; // per-message overhead
    estimated = estimated || c.estimated;
    provider = c.provider;
    if (c.source === 'heuristic') bestSource = 'heuristic';
  }
  total += 2; // priming overhead

  return { tokens: total, source: bestSource, estimated, provider, model: options.model };
}
