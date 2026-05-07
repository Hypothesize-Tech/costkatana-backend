import { AttachmentResolver } from '../helpers/attachment-resolver.service';

describe('AttachmentResolver', () => {
  function makeResolver(overrides: {
    documentModel?: any;
    attachmentProcessor?: any;
  } = {}): AttachmentResolver {
    const documentModel =
      overrides.documentModel ??
      ({
        find: () => ({ lean: () => Promise.resolve([]) }),
      } as any);
    const attachmentProcessor =
      overrides.attachmentProcessor ??
      ({
        processAttachments: jest.fn().mockResolvedValue({
          processedAttachments: [],
          contextString: '',
        }),
      } as any);
    return new AttachmentResolver(documentModel, attachmentProcessor);
  }

  describe('fetchDocumentMetadata', () => {
    it('returns [] for empty input', async () => {
      const resolver = makeResolver();
      expect(await resolver.fetchDocumentMetadata([], 'u1')).toEqual([]);
    });

    it('filters non-ObjectId-shaped strings before querying', async () => {
      const find = jest.fn(() => ({ lean: () => Promise.resolve([]) }));
      const resolver = makeResolver({ documentModel: { find } as any });
      await resolver.fetchDocumentMetadata(
        ['not-an-id', '507f1f77bcf86cd799439011'],
        'u1',
      );
      expect(find).toHaveBeenCalledTimes(1);
      const filter = find.mock.calls[0][0] as any;
      expect(filter.userId).toBe('u1');
      expect(filter._id.$in).toHaveLength(1);
    });
  });

  describe('processAttachments', () => {
    it('passes mapped AttachmentInputs to AttachmentProcessor', async () => {
      const processSpy = jest.fn().mockResolvedValue({
        processedAttachments: [{ id: 'p1' }],
        contextString: 'context',
      });
      const resolver = makeResolver({
        attachmentProcessor: { processAttachments: processSpy } as any,
      });

      const result = await resolver.processAttachments(
        [
          {
            type: 'google',
            url: 'https://drive.example/x',
            name: 'doc.txt',
            size: 100,
            mimeType: 'text/plain',
            googleFileId: 'gf1',
          } as any,
          {
            type: 'uploaded',
            url: 's3://bucket/x',
            name: 'b.pdf',
            size: 2000,
            mimeType: 'application/pdf',
          } as any,
        ],
        'u1',
      );

      expect(processSpy).toHaveBeenCalled();
      const inputs = processSpy.mock.calls[0][0] as any[];
      expect(inputs[0].type).toBe('google');
      expect(inputs[0].googleFileId).toBe('gf1');
      expect(inputs[1].type).toBe('uploaded');
      expect(inputs[1].fileType).toBe('application');
      expect(result.processed).toEqual([{ id: 'p1' }]);
      expect(result.contextText).toBe('context');
    });

    it('returns empty result when no attachments', async () => {
      const resolver = makeResolver();
      const result = await resolver.processAttachments([], 'u1');
      expect(result.processed).toEqual([]);
      expect(result.contextText).toBe('');
    });
  });
});
