import {
  inferDefaultTargetUrlFromPath,
  stripGatewayPrefixFromPath,
} from '../utils/gateway-target-url.util';

describe('gateway-target-url.util', () => {
  describe('stripGatewayPrefixFromPath', () => {
    it('strips /api/gateway prefix', () => {
      expect(stripGatewayPrefixFromPath('/api/gateway/v1/messages')).toBe(
        '/v1/messages',
      );
    });

    it('strips /gateway prefix', () => {
      expect(stripGatewayPrefixFromPath('/gateway/v1/chat/completions')).toBe(
        '/v1/chat/completions',
      );
    });

    it('drops query string', () => {
      expect(stripGatewayPrefixFromPath('/api/gateway/v1/models?x=1')).toBe(
        '/v1/models',
      );
    });
  });

  describe('inferDefaultTargetUrlFromPath', () => {
    it('infers Anthropic for /v1/messages', () => {
      expect(inferDefaultTargetUrlFromPath('/v1/messages')).toBe(
        'https://api.anthropic.com',
      );
    });

    it('infers OpenAI for chat completions', () => {
      expect(inferDefaultTargetUrlFromPath('/v1/chat/completions')).toBe(
        'https://api.openai.com',
      );
    });

    it('infers OpenAI for embeddings (not Cohere embed)', () => {
      expect(inferDefaultTargetUrlFromPath('/v1/embeddings')).toBe(
        'https://api.openai.com',
      );
    });

    it('infers Cohere for /v1/embed', () => {
      expect(inferDefaultTargetUrlFromPath('/v1/embed')).toBe(
        'https://api.cohere.ai',
      );
    });

    it('infers Google AI for generateContent', () => {
      expect(
        inferDefaultTargetUrlFromPath('/v1/models/gemini-pro:generateContent'),
      ).toBe('https://generativelanguage.googleapis.com');
    });

    it('returns undefined for unknown paths', () => {
      expect(inferDefaultTargetUrlFromPath('/custom/unknown')).toBeUndefined();
    });
  });
});
