import { NotFoundException } from '@nestjs/common';
import { ConversationStage } from '../stages/conversation.stage';
import type { StageContext } from '../types/stage-context';

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    requestId: 'r',
    startTime: Date.now(),
    userId: 'u1',
    dto: { modelId: 'm', message: 'hi', conversationId: 'c1' } as any,
    errors: [],
    rollbacks: [],
    ...overrides,
  };
}

describe('ConversationStage', () => {
  it('sets ctx.conversation and ctx.recentMessages on success', async () => {
    const conv = { _id: { toString: () => 'c1' }, userId: 'u1' };
    const loader: any = {
      loadOrCreate: jest.fn().mockResolvedValue(conv),
    };
    const optimizer: any = {
      fetchOptimalContext: jest
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'prev' }]),
    };
    const stage = new ConversationStage(loader, optimizer);
    const res = await stage.run(ctx());
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.mutates?.conversation).toBe(conv);
      expect((res.mutates?.recentMessages as any[]).length).toBe(1);
    }
    expect(loader.loadOrCreate).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(optimizer.fetchOptimalContext).toHaveBeenCalledWith('c1', 2);
  });

  it('rethrows NotFoundException so the controller maps to 404', async () => {
    const loader: any = {
      loadOrCreate: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Conversation not found')),
    };
    const optimizer: any = { fetchOptimalContext: jest.fn() };
    const stage = new ConversationStage(loader, optimizer);
    await expect(stage.run(ctx())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns structured failure on unexpected loader error', async () => {
    const loader: any = {
      loadOrCreate: jest.fn().mockRejectedValue(new Error('mongo down')),
    };
    const optimizer: any = { fetchOptimalContext: jest.fn() };
    const stage = new ConversationStage(loader, optimizer);
    const res = await stage.run(ctx());
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('conversation_load_error');
    }
  });
});
