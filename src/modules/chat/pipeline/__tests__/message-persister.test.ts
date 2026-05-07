import { MessagePersister } from '../helpers/message-persister.service';

function makePersister(overrides: {
  createReturn?: any;
  emitter?: any;
  deleteOne?: jest.Mock;
} = {}): {
  persister: MessagePersister;
  emit: jest.Mock;
  deleteOne: jest.Mock;
  withTransactionMock: jest.Mock;
} {
  const createReturn =
    overrides.createReturn ?? [
      {
        _id: { toString: () => 'm1' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        metadata: { temperature: 0.5 },
      },
    ];
  const withTransactionMock = jest
    .fn()
    .mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  const session = {
    withTransaction: withTransactionMock,
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const deleteOne = overrides.deleteOne ?? jest.fn().mockResolvedValue({});
  const chatMessageModel: any = {
    startSession: jest.fn().mockResolvedValue(session),
    create: jest.fn().mockResolvedValue(createReturn),
    deleteOne,
  };
  const emit = overrides.emitter ?? jest.fn();
  const persister = new MessagePersister(chatMessageModel, { emitMessage: emit });
  return { persister, emit, deleteOne, withTransactionMock };
}

describe('MessagePersister', () => {
  it('creates the message inside withTransaction and emits the chat event', async () => {
    const { persister, emit, withTransactionMock } = makePersister();
    const result = await persister.persistUserMessage({
      conversationId: 'c1',
      userId: 'u1',
      content: 'hi',
    });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('m1');
    expect(emit).toHaveBeenCalledWith(
      'c1',
      'u1',
      expect.objectContaining({ id: 'm1', role: 'user', content: 'hi' }),
    );
  });

  it('returns a rollback that calls deleteOne with the message id', async () => {
    const { persister, deleteOne } = makePersister();
    const result = await persister.persistUserMessage({
      conversationId: 'c1',
      userId: 'u1',
      content: 'hi',
    });
    await result.rollback();
    expect(deleteOne).toHaveBeenCalledWith({ _id: result.doc._id });
  });

  it('rollback swallows deleteOne errors so it never blocks compensation', async () => {
    const { persister } = makePersister({
      deleteOne: jest.fn().mockRejectedValue(new Error('mongo down')),
    });
    const result = await persister.persistUserMessage({
      conversationId: 'c1',
      userId: 'u1',
      content: 'hi',
    });
    await expect(result.rollback()).resolves.toBeUndefined();
  });

  it('throws when withTransaction completes without creating a doc', async () => {
    const { persister } = makePersister({ createReturn: [] });
    await expect(
      persister.persistUserMessage({
        conversationId: 'c1',
        userId: 'u1',
        content: 'hi',
      }),
    ).rejects.toThrow('User message creation failed silently');
  });

  it('passes attachments + attachedDocuments + metadata through to create', async () => {
    const { persister } = makePersister();
    await persister.persistUserMessage({
      conversationId: 'c1',
      userId: 'u1',
      content: 'hi',
      attachments: [{ id: 'a1' }],
      attachedDocuments: [{ id: 'd1' }],
      metadata: { temperature: 0.7, maxTokens: 1234 },
    });
    const call = (persister as any).chatMessageModel.create.mock.calls[0];
    const [docs] = call;
    expect(docs[0].attachments).toEqual([{ id: 'a1' }]);
    expect(docs[0].attachedDocuments).toEqual([{ id: 'd1' }]);
    expect(docs[0].metadata.temperature).toBe(0.7);
    expect(docs[0].metadata.maxTokens).toBe(1234);
  });
});
