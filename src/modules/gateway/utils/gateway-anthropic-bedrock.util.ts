/**
 * Map Anthropic API model IDs (Messages API) to Bedrock inference profile IDs.
 * Output IDs are passed to BedrockService.convertToInferenceProfile for region prefixing.
 */

const DEFAULT_BEDROCK_CLAUDE =
  'anthropic.claude-3-5-sonnet-20241022-v2:0';

/** Exact Anthropic API `model` string → Bedrock modelId */
const API_MODEL_TO_BEDROCK: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'claude-3-5-sonnet-20240620': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'claude-3-opus-20240229': 'anthropic.claude-3-opus-20240229-v1:0',
  'claude-3-haiku-20240307': 'anthropic.claude-3-haiku-20240307-v1:0',
  'claude-3-sonnet-20240229': 'anthropic.claude-3-sonnet-20240229-v1:0',
  'claude-3-5-haiku-20241022': 'anthropic.claude-3-5-haiku-20241022-v1:0',
  'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-sonnet-4-5-20250929': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-opus-4-20250514': 'anthropic.claude-opus-4-20250514-v1:0',
  'claude-opus-4-1-20250805': 'anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-opus-4-5-20250514': 'anthropic.claude-opus-4-5-20250514-v1:0',
  'claude-sonnet-4-6': 'anthropic.claude-sonnet-4-6-v1:0',
  'claude-opus-4-6': 'anthropic.claude-opus-4-6-v1',
};

type PatternRule = { test: (s: string) => boolean; bedrockId: string };

const PATTERN_RULES: PatternRule[] = [
  {
    test: (s) => s.includes('claude-sonnet-4-6'),
    bedrockId: 'anthropic.claude-sonnet-4-6-v1:0',
  },
  {
    test: (s) => s.includes('claude-opus-4-6'),
    bedrockId: 'anthropic.claude-opus-4-6-v1',
  },
  {
    test: (s) => s.includes('claude-sonnet-4-5'),
    bedrockId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  },
  {
    test: (s) => s.includes('claude-opus-4-5'),
    bedrockId: 'anthropic.claude-opus-4-5-20250514-v1:0',
  },
  {
    test: (s) => s.includes('claude-haiku-4-5'),
    bedrockId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  {
    test: (s) => s.includes('claude-sonnet-4'),
    bedrockId: 'anthropic.claude-sonnet-4-20250514-v1:0',
  },
  {
    test: (s) => s.includes('claude-opus-4-1'),
    bedrockId: 'anthropic.claude-opus-4-1-20250805-v1:0',
  },
  {
    test: (s) => s.includes('claude-opus-4'),
    bedrockId: 'anthropic.claude-opus-4-20250514-v1:0',
  },
  {
    test: (s) => s.includes('claude-3-5-sonnet'),
    bedrockId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  },
  {
    test: (s) => s.includes('claude-3-5-haiku'),
    bedrockId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
  },
  {
    test: (s) => s.includes('claude-3-opus'),
    bedrockId: 'anthropic.claude-3-opus-20240229-v1:0',
  },
  {
    test: (s) => s.includes('claude-3-haiku'),
    bedrockId: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
  {
    test: (s) => s.includes('claude-3-sonnet'),
    bedrockId: 'anthropic.claude-3-sonnet-20240229-v1:0',
  },
];

/**
 * Resolve Anthropic Messages API model field to a Bedrock model ID.
 */
export function mapAnthropicApiModelToBedrockId(model: string | undefined): string {
  const raw = (model ?? '').trim();
  if (!raw) {
    return DEFAULT_BEDROCK_CLAUDE;
  }

  if (
    raw.startsWith('anthropic.') ||
    raw.startsWith('us.anthropic.') ||
    raw.startsWith('eu.anthropic.') ||
    raw.startsWith('global.anthropic.')
  ) {
    return raw.replace(/^(us|eu)\./, '');
  }

  const exact = API_MODEL_TO_BEDROCK[raw];
  if (exact) {
    return exact;
  }

  const lower = raw.toLowerCase();
  for (const rule of PATTERN_RULES) {
    if (rule.test(lower)) {
      return rule.bedrockId;
    }
  }

  return DEFAULT_BEDROCK_CLAUDE;
}

/**
 * Build Bedrock InvokeModel body from Anthropic Messages API JSON (minus `model`).
 */
export function buildBedrockAnthropicMessagesPayload(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body };
  delete payload.model;
  delete payload.stream;
  delete payload.metadata;
  payload.anthropic_version = 'bedrock-2023-05-31';
  return payload;
}

export function isOfficialAnthropicGatewayTarget(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'api.anthropic.com' || h.endsWith('.anthropic.com');
}
