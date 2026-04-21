/**
 * Anthropic / AWS Bedrock Claude Messages API — automatic prompt caching breakpoints.
 *
 * Uses the same wire shape for direct Anthropic and Bedrock InvokeModel (Messages API).
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */

/** Minimum cumulative prefix tokens (through breakpoint) for a cache write */
export const CLAUDE_PROMPT_CACHE_MIN_PREFIX_TOKENS = 1024;

export const CLAUDE_PROMPT_CACHE_MAX_BREAKPOINTS = 4;

/** Beta feature id for direct Anthropic API (Bedrock does not use this header). */
export const ANTHROPIC_PROMPT_CACHING_BETA = 'prompt-caching-2024-07-31';

function estimateJsonTokens(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return Math.max(1, Math.ceil(s.length / 4));
  } catch {
    return 1;
  }
}

export function bodyHasCacheControl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some(bodyHasCacheControl);
  }
  if (typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  if ('cache_control' in o && o.cache_control != null) return true;
  return Object.values(o).some(bodyHasCacheControl);
}

export function isClaudeModelForPromptCaching(model: unknown): boolean {
  if (typeof model !== 'string' || !model.trim()) return false;
  const m = model.toLowerCase();
  return (
    m.includes('claude') ||
    m.includes('anthropic.') ||
    m.startsWith('us.anthropic.') ||
    m.startsWith('eu.anthropic.') ||
    m.startsWith('global.anthropic.')
  );
}

function normalizeMessageContentToBlocks(
  msg: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const c = msg.content;
  if (typeof c === 'string') {
    const blocks = [{ type: 'text', text: c }];
    msg.content = blocks;
    return blocks;
  }
  if (Array.isArray(c)) {
    return c as Array<Record<string, unknown>>;
  }
  return null;
}

function applyBreakpointToLastTextBlock(
  blocks: Array<Record<string, unknown>>,
): boolean {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b && typeof b === 'object' && b.type === 'text') {
      blocks[i] = { ...b, cache_control: { type: 'ephemeral' } };
      return true;
    }
  }
  return false;
}

/**
 * Adds up to four `cache_control: { type: "ephemeral" }` breakpoints in provider order:
 * tools → system → prior messages (never the final message turn).
 * Skips if the client already set any cache_control or the model is not Claude.
 */
export function applyClaudePromptCachingToBody(input: Record<string, unknown>): {
  body: Record<string, unknown>;
  appliedBreakpoints: number;
  outboundAnthropicBeta?: string;
} {
  if (!input || typeof input !== 'object') {
    return { body: input, appliedBreakpoints: 0 };
  }
  if (!isClaudeModelForPromptCaching(input.model)) {
    return { body: input, appliedBreakpoints: 0 };
  }
  if (bodyHasCacheControl(input)) {
    return { body: input, appliedBreakpoints: 0 };
  }

  const body = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  let breakpoints = 0;
  let cum = 0;

  const tools = body.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    cum += estimateJsonTokens(tools);
    if (
      breakpoints < CLAUDE_PROMPT_CACHE_MAX_BREAKPOINTS &&
      cum >= CLAUDE_PROMPT_CACHE_MIN_PREFIX_TOKENS
    ) {
      const lastTool = tools[tools.length - 1] as Record<string, unknown>;
      if (lastTool && typeof lastTool === 'object') {
        tools[tools.length - 1] = {
          ...lastTool,
          cache_control: { type: 'ephemeral' },
        };
        breakpoints++;
      }
    }
  }

  const sys = body.system;
  if (
    sys !== undefined &&
    sys !== null &&
    breakpoints < CLAUDE_PROMPT_CACHE_MAX_BREAKPOINTS
  ) {
    if (typeof sys === 'string') {
      cum += Math.max(1, Math.ceil(sys.length / 4));
      if (cum >= CLAUDE_PROMPT_CACHE_MIN_PREFIX_TOKENS) {
        body.system = [
          {
            type: 'text',
            text: sys,
            cache_control: { type: 'ephemeral' },
          },
        ];
        breakpoints++;
      }
    } else if (Array.isArray(sys)) {
      cum += estimateJsonTokens(sys);
      if (cum >= CLAUDE_PROMPT_CACHE_MIN_PREFIX_TOKENS) {
        const arr = sys as Array<Record<string, unknown>>;
        let placed = false;
        for (let i = arr.length - 1; i >= 0; i--) {
          const block = arr[i];
          if (
            block &&
            typeof block === 'object' &&
            block.type === 'text' &&
            typeof block.text === 'string'
          ) {
            arr[i] = {
              ...block,
              cache_control: { type: 'ephemeral' },
            };
            placed = true;
            break;
          }
        }
        if (placed) breakpoints++;
      }
    }
  }

  const messages = body.messages;
  if (Array.isArray(messages) && messages.length >= 2) {
    const lastIdx = messages.length - 1;
    for (
      let i = 0;
      i < lastIdx && breakpoints < CLAUDE_PROMPT_CACHE_MAX_BREAKPOINTS;
      i++
    ) {
      const msg = messages[i] as Record<string, unknown>;
      if (!msg || typeof msg !== 'object') continue;
      cum += estimateJsonTokens(msg);
      if (cum >= CLAUDE_PROMPT_CACHE_MIN_PREFIX_TOKENS) {
        const blocks = normalizeMessageContentToBlocks(msg);
        if (blocks && applyBreakpointToLastTextBlock(blocks)) {
          breakpoints++;
        }
      }
    }
  }

  if (breakpoints === 0) {
    return { body: input, appliedBreakpoints: 0 };
  }

  return {
    body,
    appliedBreakpoints: breakpoints,
    outboundAnthropicBeta: ANTHROPIC_PROMPT_CACHING_BETA,
  };
}
