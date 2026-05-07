import { UserMessagePersistenceStage } from '../stages/user-message-persistence.stage';
import type { StageContext } from '../types/stage-context';

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    requestId: 'r',
    startTime: Date.now(),
    userId: 'u1',
    dto: { modelId: 'm', message: 'hi', temperature: 0.5 } as any,
    conversation: { _id: 'c1' } as any,
    attachments: [],
    attachedDocuments: [],
    errors: [],
    rollbacks: [],
    ...overrides,
  };
}

describe('UserMessagePersistenceStage', () => {
  it('persists the message and surfaces the rollback', async () => {
    const persisted = {
      doc: { _id: 'm1' },
      id: 'm1',
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const persister: any = {
      persistUserMessage: jest.fn().mockResolvedValue(persisted),
    };
    const stage = new UserMessagePersistenceStage(persister);
    const result = await stage.run(ctx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mutates).toMatchObject({
        userMessageDoc: persisted.doc,
        userMessageId: 'm1',
      });
      expect(result.rollback).toBe(persisted.rollback);
    }
    expect(persister.persistUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        userId: 'u1',
        content: 'hi',
        metadata: { temperature: 0.5, maxTokens: undefined },
      }),
    );
  });

  it('uses originalMessage when present (post-template-resolution)', async () => {
    const persister: any = {
      persistUserMessage: jest.fn().mockResolvedValue({
        doc: { _id: 'm1' },
        id: 'm1',
        rollback: jest.fn(),
      }),
    };
    const stage = new UserMessagePersistenceStage(persister);
    await stage.run(ctx({ originalMessage: 'original' }));
    expect(persister.persistUserMessage.mock.calls[0][0].content).toBe(
      'original',
    );
  });

  it('fails the stage when ctx.conversation is missing', async () => {
    const persister: any = { persistUserMessage: jest.fn() };
    const stage = new UserMessagePersistenceStage(persister);
    const result = await stage.run(ctx({ conversation: undefined }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('missing_conversation');
    }
    expect(persister.persistUserMessage).not.toHaveBeenCalled();
  });

  it('returns structured failure when persister throws', async () => {
    const persister: any = {
      persistUserMessage: jest.fn().mockRejectedValue(new Error('mongo down')),
    };
    const stage = new UserMessagePersistenceStage(persister);
    const result = await stage.run(ctx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('persist_failed');
    }
  });
});
