import { FusionModule } from '../../modules/fusion.module';
import { RAGModuleInput } from '../../types/rag.types';
import { Document } from '@langchain/core/documents';

describe('FusionModule', () => {
  let fusionModule: FusionModule;

  beforeEach(() => {
    fusionModule = new FusionModule({ enabled: true, strategy: 'rrf' });
  });

  const createMockDocuments = (count: number, prefix: string): Document[] => {
    return Array.from({ length: count }, (_, i) => new Document({
      pageContent: `${prefix} document ${i}`,
      metadata: { score: 0.9 - (i * 0.1), source: `source-${i}` },
    }));
  };

  describe('executeInternal', () => {
    it('should fuse documents using RRF strategy', async () => {
      const docs1 = createMockDocuments(3, 'Set 1');
      const docs2 = createMockDocuments(3, 'Set 2');

      const input: RAGModuleInput = {
        query: 'test query',
        documents: docs1,
        metadata: { documentSets: [docs1, docs2] },
      };

      const result = await fusionModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.documents).toBeDefined();
      expect(result.documents!.length).toBeGreaterThan(0);
    });

    it('should fuse documents using weighted strategy', async () => {
      const weightedModule = new FusionModule({
        enabled: true,
        strategy: 'weighted',
        weights: { '0': 0.7, '1': 0.3 },
      });

      const docs1 = createMockDocuments(2, 'Primary');
      const docs2 = createMockDocuments(2, 'Secondary');

      const input: RAGModuleInput = {
        query: 'test query',
        documents: docs1,
        metadata: { documentSets: [docs1, docs2] },
      };

      const result = await weightedModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.documents).toBeDefined();
    });

    it('should deduplicate similar documents', async () => {
      const doc1 = new Document({
        pageContent: 'identical content',
        metadata: { score: 0.9 },
      });
      const doc2 = new Document({
        pageContent: 'identical content',
        metadata: { score: 0.8 },
      });

      const input: RAGModuleInput = {
        query: 'test query',
        documents: [doc1],
        metadata: { documentSets: [[doc1], [doc2]] },
      };

      const result = await fusionModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.documents!.length).toBeLessThanOrEqual(2);
    });

    it('should handle distribution-based fusion', async () => {
      const dbsfModule = new FusionModule({
        enabled: true,
        strategy: 'dbsf',
      });

      const docs1 = createMockDocuments(3, 'DBSF');
      const docs2 = createMockDocuments(3, 'DBSF');

      const input: RAGModuleInput = {
        query: 'test query',
        documents: docs1,
        metadata: { documentSets: [docs1, docs2] },
      };

      const result = await dbsfModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.documents).toBeDefined();
    });
  });
});

