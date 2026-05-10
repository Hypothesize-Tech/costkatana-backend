import { recordGenAIUsage } from '../../../utils/genaiTelemetry';
import { bedrockClient } from '../../../config/aws';
import { BedrockService } from '../bedrock.service';

jest.mock('../../../utils/genaiTelemetry', () => ({
  recordGenAIUsage: jest.fn(),
}));

jest.mock('../../../utils/pricing', () => ({
  calculateCost: jest.fn(() => 0.000123),
  // The bedrock service imports MODEL_PRICING but the entry points under test
  // here don't read from it directly, so an empty stub is fine.
  MODEL_PRICING: {},
}));

jest.mock('../../../config/aws', () => ({
  bedrockClient: { send: jest.fn() },
  s3Client: {},
  AWS_CONFIG: { bedrock: { temperature: 0.7 } },
}));

const recordMock = recordGenAIUsage as unknown as jest.Mock;
const sendMock = (bedrockClient as unknown as { send: jest.Mock }).send;

describe('BedrockService records usage in previously-silent entry points', () => {
  beforeEach(() => {
    recordMock.mockReset();
    sendMock.mockReset();
  });

  describe('invokeConverseText', () => {
    it('records on success with a builder operationName when telemetry ctx is provided', async () => {
      sendMock.mockResolvedValue({
        output: { message: { content: [{ text: 'hi' }] } },
        usage: { inputTokens: 7, outputTokens: 3 },
      });

      const result = await BedrockService.invokeConverseText(
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
        'hello',
        {
          telemetry: {
            operationName: 'agent.builder.text_to_agent',
            eventCategory: 'builder',
            source: 'agent-builder',
            userId: 'u1',
            sessionId: 'sess_1',
          },
        },
      );

      expect(result.response).toBe('hi');
      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'agent.builder.text_to_agent',
          promptTokens: 7,
          completionTokens: 3,
          userId: 'u1',
          sessionId: 'sess_1',
          extra: expect.objectContaining({
            eventCategory: 'builder',
            source: 'agent-builder',
          }),
        }),
      );
    });

    it('records on error and rethrows', async () => {
      sendMock.mockRejectedValue(new Error('boom'));

      await expect(
        BedrockService.invokeConverseText('m', 'hi'),
      ).rejects.toThrow('boom');

      expect(recordMock).toHaveBeenCalledTimes(1);
      const arg = recordMock.mock.calls[0][0];
      expect(arg.operationName).toBe('bedrock.converse_text');
      expect(arg.error).toBeInstanceOf(Error);
      expect(arg.promptTokens).toBe(0);
      expect(arg.completionTokens).toBe(0);
    });
  });

  describe('invokeModelDirectly', () => {
    it('records on success with the default operationName when no ctx is provided', async () => {
      const responseBody = {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      };
      sendMock.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(responseBody)),
      });

      const result = await BedrockService.invokeModelDirectly('m', { x: 1 });
      expect(result.response).toBe('ok');
      expect(recordMock).toHaveBeenCalledTimes(1);
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'bedrock.invoke_model_direct',
          promptTokens: 5,
          completionTokens: 2,
          extra: expect.objectContaining({ eventCategory: 'bedrock-direct' }),
        }),
      );
    });

    it('records on error and rethrows', async () => {
      sendMock.mockRejectedValue(new Error('aws-down'));
      await expect(
        BedrockService.invokeModelDirectly('m', { x: 1 }),
      ).rejects.toThrow('aws-down');
      expect(recordMock).toHaveBeenCalledTimes(1);
      const arg = recordMock.mock.calls[0][0];
      expect(arg.operationName).toBe('bedrock.invoke_model_direct');
      expect(arg.error).toBeInstanceOf(Error);
    });
  });
});
