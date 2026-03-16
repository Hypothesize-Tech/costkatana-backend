import { Injectable, OnModuleInit } from '@nestjs/common';
import { RagServiceLocator } from './rag-service-locator';
import { ModularRAGOrchestrator } from './orchestrator/modular-rag.orchestrator';

/**
 * Registers ModularRAGOrchestrator with RagServiceLocator on RagModule init
 * so that getModularRAGOrchestrator() is available to RagBenchmarkService and others.
 */
@Injectable()
export class RagLocatorRegistrationService implements OnModuleInit {
  constructor(
    private readonly modularRagOrchestrator: ModularRAGOrchestrator,
  ) {}

  onModuleInit(): void {
    RagServiceLocator.registerModularRAG(this.modularRagOrchestrator);
  }
}
