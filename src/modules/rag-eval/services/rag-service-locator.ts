import { CacheService } from '../../../common/cache/cache.service';
import { RagRetrievalService } from './rag-retrieval.service';

/**
 * Static service locator for RAG evaluation module
 * Provides access to shared services (CacheService, RagRetrievalService)
 * Registered during RagEvalModule initialization
 */
export class RagServiceLocator {
  private static cacheService: CacheService;
  private static retrievalService: RagRetrievalService;
  private static modularRagOrchestrator: any = null;

  /**
   * Register services - called during module initialization
   */
  static register(cache: CacheService, retrieval: RagRetrievalService): void {
    RagServiceLocator.cacheService = cache;
    RagServiceLocator.retrievalService = retrieval;
  }

  /**
   * Register ModularRAGOrchestrator - called by RagModule on init
   */
  static registerModularRAG(orchestrator: any): void {
    RagServiceLocator.modularRagOrchestrator = orchestrator;
  }

  /**
   * Get ModularRAGOrchestrator instance
   */
  static getModularRAGOrchestrator(): any {
    if (!RagServiceLocator.modularRagOrchestrator) {
      throw new Error(
        'RagServiceLocator: ModularRAGOrchestrator not registered. Ensure RagModule is initialized.',
      );
    }
    return RagServiceLocator.modularRagOrchestrator;
  }

  /**
   * Get cache service instance
   */
  static getCacheService(): CacheService {
    if (!RagServiceLocator.cacheService) {
      throw new Error(
        'RagServiceLocator: CacheService not registered. Make sure RagEvalModule is properly initialized.',
      );
    }
    return RagServiceLocator.cacheService;
  }

  /**
   * Get retrieval service instance
   */
  static getRetrievalService(): RagRetrievalService {
    if (!RagServiceLocator.retrievalService) {
      throw new Error(
        'RagServiceLocator: RagRetrievalService not registered. Make sure RagEvalModule is properly initialized.',
      );
    }
    return RagServiceLocator.retrievalService;
  }

  /**
   * Check if services are registered
   */
  static isInitialized(): boolean {
    return !!(
      RagServiceLocator.cacheService && RagServiceLocator.retrievalService
    );
  }
}
