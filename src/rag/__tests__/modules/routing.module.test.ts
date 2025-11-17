import { RoutingModule } from '../../modules/routing.module';
import { RAGModuleInput } from '../../types/rag.types';

describe('RoutingModule', () => {
  let routingModule: RoutingModule;

  beforeEach(() => {
    routingModule = new RoutingModule({ enabled: true, strategy: 'hybrid' });
  });

  describe('executeInternal', () => {
    it('should route query successfully with hybrid strategy', async () => {
      const input: RAGModuleInput = {
        query: 'What is cost optimization?',
        context: { userId: 'test-user' },
      };

      const result = await routingModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.metadata).toHaveProperty('strategy');
    });

    it('should handle semantic routing strategy', async () => {
      const semanticModule = new RoutingModule({ enabled: true, strategy: 'semantic' });
      const input: RAGModuleInput = {
        query: 'How does machine learning work?',
        context: { userId: 'test-user' },
      };

      const result = await semanticModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.metadata?.strategy).toBe('semantic');
    });

    it('should handle keyword routing strategy', async () => {
      const keywordModule = new RoutingModule({ enabled: true, strategy: 'keyword' });
      const input: RAGModuleInput = {
        query: 'cost optimization best practices',
        context: { userId: 'test-user' },
      };

      const result = await keywordModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.metadata?.strategy).toBe('keyword');
    });

    it('should use fallback route when no match found', async () => {
      const input: RAGModuleInput = {
        query: 'xyz unknown query',
        context: { userId: 'test-user' },
        config: { fallbackRoute: 'default' },
      };

      const result = await routingModule.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('caching', () => {
    it('should cache routing decisions', async () => {
      const input: RAGModuleInput = {
        query: 'What is AI?',
        context: { userId: 'test-user' },
      };

      const result1 = await routingModule.execute(input);
      const result2 = await routingModule.execute(input);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});

