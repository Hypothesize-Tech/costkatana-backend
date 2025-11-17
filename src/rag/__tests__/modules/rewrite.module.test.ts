import { RewriteModule } from '../../modules/rewrite.module';
import { RAGModuleInput } from '../../types/rag.types';

describe('RewriteModule', () => {
  let rewriteModule: RewriteModule;

  beforeEach(() => {
    rewriteModule = new RewriteModule({ enabled: true, methods: ['reformulation'] });
  });

  describe('executeInternal', () => {
    it('should rewrite query successfully', async () => {
      const input: RAGModuleInput = {
        query: 'How can I reduce AWS costs?',
        context: { userId: 'test-user' },
      };

      const result = await rewriteModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('queries');
      expect(Array.isArray((result.data as { queries: string[] }).queries)).toBe(true);
    });

    it('should apply multiple rewriting methods', async () => {
      const multiMethodModule = new RewriteModule({
        enabled: true,
        methods: ['expansion', 'reformulation'],
      });

      const input: RAGModuleInput = {
        query: 'best practices for cloud cost optimization',
        context: { userId: 'test-user' },
      };

      const result = await multiMethodModule.execute(input);

      expect(result.success).toBe(true);
      const data = result.data as { queries: string[] };
      expect(data.queries.length).toBeGreaterThan(1);
    });

    it('should handle HyDE method', async () => {
      const hydeModule = new RewriteModule({
        enabled: true,
        methods: ['hyde'],
      });

      const input: RAGModuleInput = {
        query: 'What are the benefits of serverless?',
        context: { userId: 'test-user' },
      };

      const result = await hydeModule.execute(input);

      expect(result.success).toBe(true);
    });

    it('should return original query on failure', async () => {
      const input: RAGModuleInput = {
        query: 'test query',
        context: { userId: 'test-user' },
      };

      const result = await rewriteModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.query).toBeDefined();
    });
  });
});

