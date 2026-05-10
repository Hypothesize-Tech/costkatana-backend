import { HttpException } from '@nestjs/common';
import { SecurityStage } from '../stages/security.stage';
import type { StageContext } from '../types/stage-context';

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    requestId: 'r',
    startTime: Date.now(),
    userId: 'u1',
    dto: { modelId: 'm', message: 'hi' } as any,
    errors: [],
    rollbacks: [],
    ...overrides,
  };
}

describe('SecurityStage', () => {
  it('returns ok with effectiveMessage when threat check passes', async () => {
    const handler: any = {
      checkMessageSecurity: jest
        .fn()
        .mockResolvedValue({ isBlocked: false }),
    };
    const stage = new SecurityStage(handler);
    const result = await stage.run(ctx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mutates?.effectiveMessage).toBe('hi');
    }
  });

  it('throws HttpException when threat check blocks the message', async () => {
    const handler: any = {
      checkMessageSecurity: jest.fn().mockResolvedValue({
        isBlocked: true,
        reason: 'detected jailbreak',
        threatCategory: 'prompt_injection',
        confidence: 0.95,
      }),
    };
    const stage = new SecurityStage(handler);
    await expect(stage.run(ctx())).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects empty input with no template + no attachments', async () => {
    const handler: any = { checkMessageSecurity: jest.fn() };
    const stage = new SecurityStage(handler);
    const result = await stage.run(
      ctx({ dto: { modelId: 'm', message: '' } as any }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('empty_input');
    }
    expect(handler.checkMessageSecurity).not.toHaveBeenCalled();
  });

  it('allows empty message when templateId is provided', async () => {
    const handler: any = { checkMessageSecurity: jest.fn() };
    const stage = new SecurityStage(handler);
    const result = await stage.run(
      ctx({
        dto: { modelId: 'm', message: '', templateId: 't1' } as any,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('fails-CLOSED when security handler throws unexpectedly', async () => {
    const handler: any = {
      checkMessageSecurity: jest
        .fn()
        .mockRejectedValue(new Error('redis down')),
    };
    const stage = new SecurityStage(handler);
    const result = await stage.run(ctx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('security_check_error');
    }
  });
});
