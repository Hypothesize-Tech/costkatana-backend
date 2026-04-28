import { ProviderName } from './types';

/**
 * Map a provider string + model id onto a canonical provider name.
 * Tolerant of casing and Bedrock-style model ids ("anthropic.claude-3-..").
 */
export function detectProvider(
  provider?: string,
  model?: string,
): ProviderName {
  const p = (provider || '').toLowerCase();
  const m = (model || '').toLowerCase();

  if (p === 'openai' || p === 'azure' || p === 'azure-openai') return 'openai';
  if (p === 'anthropic') return 'anthropic';
  if (p === 'google' || p === 'palm' || p === 'vertex' || p === 'gemini') {
    return 'google';
  }
  if (p === 'cohere') return 'cohere';
  if (p === 'mistral' || p === 'mistralai') return 'mistral';
  if (p === 'meta') return 'meta';
  if (p === 'amazon' || p === 'aws' || p === 'bedrock') {
    if (m.includes('claude')) return 'anthropic';
    if (m.includes('cohere')) return 'cohere';
    if (m.includes('mistral')) return 'mistral';
    if (m.includes('llama')) return 'meta';
    if (m.startsWith('amazon.') || m.includes('nova') || m.includes('titan')) {
      return 'amazon';
    }
    return 'bedrock';
  }

  if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return 'openai';
  }
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini') || m.includes('palm')) return 'google';
  if (m.includes('command') || m.includes('cohere')) return 'cohere';
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral';
  if (m.includes('llama')) return 'meta';
  if (m.includes('nova') || m.includes('titan')) return 'amazon';

  return 'unknown';
}
