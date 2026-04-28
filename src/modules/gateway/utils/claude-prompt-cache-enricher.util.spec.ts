import {
  ANTHROPIC_PROMPT_CACHING_BETA,
  applyClaudePromptCachingToBody,
  bodyHasCacheControl,
  isClaudeModelForPromptCaching,
} from './claude-prompt-cache-enricher.util';

describe('claude-prompt-cache-enricher.util', () => {
  const claudeModel = 'claude-3-5-sonnet-20241022';

  describe('isClaudeModelForPromptCaching', () => {
    it('accepts claude and anthropic ids', () => {
      expect(isClaudeModelForPromptCaching('claude-sonnet-4-20250514')).toBe(
        true,
      );
      expect(
        isClaudeModelForPromptCaching(
          'anthropic.claude-3-5-sonnet-20241022-v2:0',
        ),
      ).toBe(true);
      expect(isClaudeModelForPromptCaching('gpt-4o')).toBe(false);
    });
  });

  describe('bodyHasCacheControl', () => {
    it('detects nested cache_control', () => {
      expect(
        bodyHasCacheControl({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'x', cache_control: { type: 'ephemeral' } },
              ],
            },
          ],
        }),
      ).toBe(true);
      expect(bodyHasCacheControl({ messages: [{ role: 'user', content: 'hi' }] })).toBe(
        false,
      );
    });
  });

  describe('applyClaudePromptCachingToBody', () => {
    it('skips when client already set cache_control', () => {
      const input = {
        model: claudeModel,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a'.repeat(5000), cache_control: { type: 'ephemeral' } },
            ],
          },
        ],
      };
      const r = applyClaudePromptCachingToBody(input);
      expect(r.appliedBreakpoints).toBe(0);
      expect(r.body).toBe(input);
    });

    it('adds system block breakpoint when system alone exceeds threshold', () => {
      const systemText = 's'.repeat(5000);
      const input = {
        model: claudeModel,
        max_tokens: 100,
        system: systemText,
        messages: [{ role: 'user', content: 'hi' }],
      };
      const r = applyClaudePromptCachingToBody(input);
      expect(r.appliedBreakpoints).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(r.body.system)).toBe(true);
      const blocks = r.body.system as Array<Record<string, unknown>>;
      expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(r.outboundAnthropicBeta).toBe(ANTHROPIC_PROMPT_CACHING_BETA);
    });

    it('adds breakpoint on prior user message and normalizes shorthand content', () => {
      const big = 'p'.repeat(5000);
      const input = {
        model: claudeModel,
        max_tokens: 100,
        messages: [
          { role: 'user', content: big },
          { role: 'user', content: 'short follow-up' },
        ],
      };
      const r = applyClaudePromptCachingToBody(input);
      expect(r.appliedBreakpoints).toBeGreaterThanOrEqual(1);
      const msgs = r.body.messages as Array<Record<string, unknown>>;
      const firstContent = msgs[0].content as Array<Record<string, unknown>>;
      expect(Array.isArray(firstContent)).toBe(true);
      const textBlocks = firstContent.filter((b) => b.type === 'text');
      const lastText = textBlocks[textBlocks.length - 1];
      expect(lastText.cache_control).toEqual({ type: 'ephemeral' });
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.content).toBe('short follow-up');
    });

    it('places cache_control on last tool when tools exceed threshold', () => {
      const tools = Array.from({ length: 80 }, (_, i) => ({
        name: `tool_${i}`,
        description: 'd'.repeat(80),
        input_schema: {
          type: 'object',
          properties: { x: { type: 'string' } },
        },
      }));
      const input = {
        model: claudeModel,
        max_tokens: 100,
        tools,
        messages: [{ role: 'user', content: 'hi' }],
      };
      const r = applyClaudePromptCachingToBody(input);
      expect(r.appliedBreakpoints).toBeGreaterThanOrEqual(1);
      const outTools = r.body.tools as Array<Record<string, unknown>>;
      expect(outTools[outTools.length - 1].cache_control).toEqual({
        type: 'ephemeral',
      });
    });
  });
});
