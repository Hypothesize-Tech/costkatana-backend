import { AssistantMessagePersister } from '../helpers/assistant-message-persister.service';

function makePersister(overrides: {
  createdDoc?: any;
  emitter?: any;
} = {}): {
  persister: AssistantMessagePersister;
  emit: jest.Mock;
  conversationSave: jest.Mock;
  createdDoc: any;
} {
  const createdDoc = overrides.createdDoc ?? {
    _id: { toString: () => 'msg-1' },
    content: 'hello reply',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    metadata: { cost: 0.0023 },
  };
  const chatMessageModel: any = {
    create: jest.fn().mockResolvedValue(createdDoc),
  };
  const conversationSave = jest.fn().mockResolvedValue(undefined);
  const emit = overrides.emitter ?? jest.fn();
  const persister = new AssistantMessagePersister(chatMessageModel, {
    emitMessage: emit,
  });
  return {
    persister,
    emit,
    conversationSave,
    createdDoc,
  };
}

function makeConversation(initial = {}): any {
  return {
    _id: { toString: () => 'conv-1' },
    messageCount: 4,
    totalCost: 0.001,
    save: jest.fn().mockResolvedValue(undefined),
    ...initial,
  };
}

describe('AssistantMessagePersister', () => {
  it('persists the message, bumps the conversation, and emits the event', async () => {
    const { persister, emit } = makePersister();
    const conversation = makeConversation();

    const result = await persister.persistAssistantMessage({
      conversation,
      userId: 'u1',
      content: 'hello reply',
      modelId: 'm',
      agentPath: ['knowledge_base'],
      optimizationsApplied: ['rag'],
      metadata: { cost: 0.0023 },
    });

    // Conversation roll-up
    expect(conversation.messageCount).toBe(6); // +2 (user + assistant)
    expect(conversation.lastMessage).toBe('hello reply');
    expect(conversation.totalCost).toBeCloseTo(0.001 + 0.0023, 6);
    expect(conversation.save).toHaveBeenCalledTimes(1);

    // Returned payload
    expect(result.id).toBe('msg-1');
    expect(result.responsePayload.role).toBe('assistant');
    expect(result.responsePayload.modelId).toBe('m');
    expect(result.responsePayload.agentPath).toEqual(['knowledge_base']);

    // Event emitted with the same payload
    expect(emit).toHaveBeenCalledWith(
      'conv-1',
      'u1',
      expect.objectContaining({
        id: 'msg-1',
        role: 'assistant',
        agentPath: ['knowledge_base'],
      }),
    );
  });

  it('truncates lastMessage to the schema cap (49,999 chars)', async () => {
    const huge = 'x'.repeat(60_000);
    const { persister } = makePersister({
      createdDoc: {
        _id: { toString: () => 'msg-2' },
        content: huge,
        createdAt: new Date(),
        metadata: {},
      },
    });
    const conversation = makeConversation();
    await persister.persistAssistantMessage({
      conversation,
      userId: 'u1',
      content: huge,
    });
    expect(conversation.lastMessage).toHaveLength(49_999);
  });

  it('passes extraEventFields through to the emitted payload', async () => {
    const { persister, emit } = makePersister();
    const conversation = makeConversation();
    await persister.persistAssistantMessage({
      conversation,
      userId: 'u1',
      content: 'reply',
      extraEventFields: {
        mongodbIntegrationData: { foo: 'bar' },
        formattedResult: 'pretty',
      },
    });
    const emitted = (emit as jest.Mock).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(emitted.mongodbIntegrationData).toEqual({ foo: 'bar' });
    expect(emitted.formattedResult).toBe('pretty');
  });

  it('does not throw if emit throws — persistence still committed', async () => {
    const { persister } = makePersister({
      emitter: jest.fn(() => {
        throw new Error('SSE down');
      }),
    });
    const conversation = makeConversation();
    await expect(
      persister.persistAssistantMessage({
        conversation,
        userId: 'u1',
        content: 'reply',
      }),
    ).resolves.toBeDefined();
    expect(conversation.save).toHaveBeenCalledTimes(1);
  });

  it('handles undefined cost in metadata without NaN-ing totalCost', async () => {
    const { persister } = makePersister({
      createdDoc: {
        _id: { toString: () => 'msg-3' },
        content: 'reply',
        createdAt: new Date(),
        metadata: {},
      },
    });
    const conversation = makeConversation({ totalCost: 0.5 });
    await persister.persistAssistantMessage({
      conversation,
      userId: 'u1',
      content: 'reply',
    });
    expect(conversation.totalCost).toBe(0.5);
  });
});
