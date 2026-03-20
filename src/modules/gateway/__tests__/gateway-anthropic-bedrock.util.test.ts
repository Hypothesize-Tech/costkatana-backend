import {
  buildBedrockAnthropicMessagesPayload,
  isOfficialAnthropicGatewayTarget,
  mapAnthropicApiModelToBedrockId,
} from '../utils/gateway-anthropic-bedrock.util';

describe('gateway-anthropic-bedrock.util', () => {
  describe('mapAnthropicApiModelToBedrockId', () => {
    it('maps dated Sonnet 3.5', () => {
      expect(mapAnthropicApiModelToBedrockId('claude-3-5-sonnet-20241022')).toBe(
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
      );
    });

    it('maps Sonnet 4.5 alias', () => {
      expect(mapAnthropicApiModelToBedrockId('claude-sonnet-4-5-20250929')).toBe(
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
      );
    });

    it('passes through anthropic.* ids', () => {
      expect(
        mapAnthropicApiModelToBedrockId(
          'anthropic.claude-3-haiku-20240307-v1:0',
        ),
      ).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    });

    it('defaults when empty', () => {
      expect(mapAnthropicApiModelToBedrockId('')).toBe(
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
      );
    });
  });

  describe('buildBedrockAnthropicMessagesPayload', () => {
    it('strips model/stream and sets anthropic_version', () => {
      const out = buildBedrockAnthropicMessagesPayload({
        model: 'claude-3-haiku-20240307',
        stream: false,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(out.model).toBeUndefined();
      expect(out.stream).toBeUndefined();
      expect(out.anthropic_version).toBe('bedrock-2023-05-31');
      expect(out.max_tokens).toBe(100);
    });
  });

  describe('isOfficialAnthropicGatewayTarget', () => {
    it('accepts api.anthropic.com', () => {
      expect(isOfficialAnthropicGatewayTarget('api.anthropic.com')).toBe(true);
    });

    it('rejects other hosts', () => {
      expect(isOfficialAnthropicGatewayTarget('api.openai.com')).toBe(false);
    });
  });
});
