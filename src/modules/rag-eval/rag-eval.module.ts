import { Module, OnModuleInit } from '@nestjs/common';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { RagEvalController } from './rag-eval.controller';
import { RagRetrievalService } from './services/rag-retrieval.service';
import { RagServiceLocator } from './services/rag-service-locator';
import { CacheService } from '../../common/cache/cache.service';

@Module({
  imports: [
    SchemasModule, // For Document model
    CommonModule, // For CacheService
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [RagEvalController],
  providers: [
    RagRetrievalService,
    // Note: CacheService is provided by CommonModule
  ],
  exports: [RagRetrievalService],
})
export class RagEvalModule implements OnModuleInit {
  constructor(
    private cacheService: CacheService,
    private ragRetrievalService: RagRetrievalService,
  ) {}

  async onModuleInit() {
    // Register services with the service locator
    RagServiceLocator.register(this.cacheService, this.ragRetrievalService);
  }
}
