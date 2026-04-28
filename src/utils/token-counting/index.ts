/**
 * Canonical token counting for costkatana-backend.
 *
 *   countTokens(text, { provider, model })
 *     -> sync, returns { tokens, source, estimated, provider, model }
 *
 *   countTokensAuthoritative(text, { provider, model, apiKey })
 *     -> async, calls the provider's count-tokens endpoint when possible
 *
 *   extractUsageFromResponse(response, { provider, model })
 *     -> reads the usage block off a real API response (most accurate path)
 *
 * The legacy helpers in `src/utils/tokenCounter.ts`, `token-count.utils.ts`,
 * `tokenEstimator.ts`, and `enhanced-token-counter.ts` delegate to this
 * module so existing call sites get correct per-provider tokenization for
 * free.
 */
export * from './types';
export { detectProvider } from './provider-detect';
export {
  countTokens,
  countTokensAuthoritative,
  extractUsageFromResponse,
  countChatMessageTokens,
} from './token-counter';
