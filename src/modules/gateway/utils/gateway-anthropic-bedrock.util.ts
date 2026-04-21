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
 * Extract a rough user-prompt string from an Anthropic Messages body for
 * heuristic budget sizing. Concatenates user-role content; if content is an
 * array of blocks, joins their `text` fields.
 */
function extractPromptForBudget(body: Record<string, unknown>): string {
  const messages = body.messages as unknown;
  if (!Array.isArray(messages)) return '';
  const parts: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as Record<string, unknown>).role;
    if (role !== 'user') continue;
    const content = (m as Record<string, unknown>).content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object') {
          const t = (block as Record<string, unknown>).text;
          if (typeof t === 'string') parts.push(t);
        }
      }
    }
  }
  return parts.join('\n');
}

/**
 * Build Bedrock InvokeModel body from Anthropic Messages API JSON (minus `model`).
 *
 * Thinking passes through unchanged by default. When the caller enables
 * `thinking: { type: 'enabled' }` without a `budget_tokens` value, we compute
 * one dynamically (prompt length × model output price) so the gateway never
 * ships a request that Bedrock will reject.
 *
 * When any thinking is enabled, we also force `temperature = 1` — Claude
 * refuses extended thinking with non-default temperature.
 *
 * When `documentBlocks` is provided, the final user message's `content` is
 * rewritten into a mixed-content array with the documents preceding the text
 * so Claude can cite from them (each block carries `citations.enabled: true`
 * from the builder).
 */
export function buildBedrockAnthropicMessagesPayload(
  body: Record<string, unknown>,
  opts?: {
    bedrockModelId?: string;
    modelMaxTokens?: number;
    outputPricePer1M?: number;
    documentBlocks?: Array<Record<string, unknown>>;
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body };
  delete payload.model;
  delete payload.stream;
  delete payload.metadata;
  payload.anthropic_version = 'bedrock-2023-05-31';

  if (opts?.documentBlocks && opts.documentBlocks.length > 0) {
    payload.messages = injectDocumentBlocks(
      payload.messages,
      opts.documentBlocks,
    );
  }

  const thinking = payload.thinking as Record<string, unknown> | undefined;
  if (thinking && typeof thinking === 'object') {
    payload.temperature = 1;

    // For enabled-mode thinking, compute budget if missing and enforce the
    // Claude invariant `max_tokens > budget_tokens` by bumping max_tokens when
    // the caller's value is too small.
    if (thinking.type === 'enabled') {
      const { computeDynamicBudget } = require(
        '../../bedrock/thinking-capability',
      ) as typeof import('../../bedrock/thinking-capability');
      const modelMax = opts?.modelMaxTokens ?? 32768;
      const answerReserve = 1024;

      let budget: number;
      if (typeof thinking.budget_tokens === 'number') {
        budget = Math.max(
          1024,
          Math.min(thinking.budget_tokens, modelMax - answerReserve),
        );
      } else {
        const prompt = extractPromptForBudget(body);
        budget = computeDynamicBudget(
          opts?.bedrockModelId ?? '',
          prompt,
          modelMax,
          opts?.outputPricePer1M,
        );
      }

      if (budget > 0) {
        payload.thinking = { ...thinking, budget_tokens: budget };
        // Bump max_tokens if caller's value can't fit budget + answer reserve.
        const requestedMax =
          typeof payload.max_tokens === 'number'
            ? (payload.max_tokens as number)
            : modelMax;
        const requiredMax = Math.min(
          modelMax,
          Math.max(requestedMax, budget + answerReserve),
        );
        payload.max_tokens = requiredMax;
      }
    }
  }
  return payload;
}

export function isOfficialAnthropicGatewayTarget(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'api.anthropic.com' || h.endsWith('.anthropic.com');
}

/**
 * Insert `document` content blocks into the last user message so Claude can
 * cite from them. If the user message `content` is a string, it is converted
 * into a single-element text block array. Documents are placed before the
 * text — Anthropic recommends documents-first for citation quality.
 *
 * Does nothing if the messages array has no user-role message.
 */
function injectDocumentBlocks(
  messages: unknown,
  documentBlocks: Array<Record<string, unknown>>,
): unknown {
  if (!Array.isArray(messages)) return messages;
  const lastUserIdx = findLastIndex(messages, (m) => {
    return !!m && typeof m === 'object' && (m as Record<string, unknown>).role === 'user';
  });
  if (lastUserIdx < 0) return messages;

  const target = messages[lastUserIdx] as Record<string, unknown>;
  const existing = target.content;
  const textBlocks: unknown[] =
    typeof existing === 'string'
      ? [{ type: 'text', text: existing }]
      : Array.isArray(existing)
        ? (existing as unknown[])
        : [];

  const updated: Record<string, unknown> = {
    ...target,
    content: [...documentBlocks, ...textBlocks],
  };
  const next = messages.slice();
  next[lastUserIdx] = updated;
  return next;
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}
