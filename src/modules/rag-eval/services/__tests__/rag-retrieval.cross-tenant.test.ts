/**
 * Verifies cross-tenant access defenses on `retrieveByDocumentIds`:
 *   - Refuses to query at all when no userId scope is present.
 *   - Always passes the userId filter into the Mongo query when scoped.
 */
import { RagRetrievalService } from '../rag-retrieval.service';

function makeMockModel(rows: unknown[] = []): {
  model: any;
  findCalls: Array<Record<string, unknown>>;
} {
  const findCalls: Array<Record<string, unknown>> = [];
  const model: any = {
    find: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
      findCalls.push(filter);
      return {
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      };
    }),
  };
  return { model, findCalls };
}

describe('RagRetrievalService.retrieveByDocumentIds (cross-tenant defense)', () => {
  it('refuses to query when no userId is provided (returns empty result)', async () => {
    const { model, findCalls } = makeMockModel([
      { content: 'leaked', metadata: { documentId: 'd1', userId: 'other' } },
    ]);
    const svc = new RagRetrievalService(model);

    const out = await svc.retrieveByDocumentIds(['d1', 'd2'], {});

    expect(out.documents).toHaveLength(0);
    expect(out.totalResults).toBe(0);
    // Critical: the underlying find() must NOT have been called at all
    // when userId is missing — otherwise the query could leak.
    expect(findCalls).toHaveLength(0);
  });

  it('always includes metadata.userId in the filter when scoped', async () => {
    const { model, findCalls } = makeMockModel([]);
    const svc = new RagRetrievalService(model);

    await svc.retrieveByDocumentIds(['d1'], { userId: 'user-A' });

    expect(findCalls.length).toBeGreaterThan(0);
    expect(findCalls[0]['metadata.userId']).toBe('user-A');
  });

  it('coerces ObjectId-shaped userId to string for the filter', async () => {
    const { model, findCalls } = makeMockModel([]);
    const svc = new RagRetrievalService(model);

    // Mongoose ObjectId-like object — has a toString() method.
    const objectId = { toString: () => '507f1f77bcf86cd799439011' };
    await svc.retrieveByDocumentIds(['d1'], { userId: objectId as unknown as string });

    expect(findCalls[0]['metadata.userId']).toBe('507f1f77bcf86cd799439011');
  });
});
