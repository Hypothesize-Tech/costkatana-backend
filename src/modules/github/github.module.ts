import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { CortexModule } from '../cortex/cortex.module';
import { OAuthModule } from '../oauth/oauth.module';
import { AuthModule } from '../auth/auth.module';

import { GitHubWebhooksController } from './github-webhooks.controller';
import { GithubOAuthController } from './controllers/github-oauth.controller';
import { GithubConnectionsController } from './controllers/github-connections.controller';
import { GithubPRIntegrationController } from './controllers/github-pr-integration.controller';

import { GitHubService } from './github.service';
import { GitHubIndexingService } from './github-indexing.service';
import { IncrementalIndexService } from './incremental-index.service';
import { SymbolJumpService } from '../../common/services/symbol-jump.service';
import { TreeSitterService } from './tree-sitter.service';
import { SecretScannerService } from './secret-scanner.service';

import { GithubOAuthApiService } from './services/github-oauth-api.service';
import { GithubAnalysisService } from './services/github-analysis.service';
import { GithubCodeGeneratorService } from './services/github-code-generator.service';
import { GithubPRIntegrationService } from './services/github-pr-integration.service';
import { GithubCacheInvalidationService } from './services/github-cache-invalidation.service';
import { GithubConnectionService } from './services/github-connection.service';

@Module({
  imports: [
    SchemasModule,
    forwardRef(() => CommonModule),
    forwardRef(() => CortexModule),
    OAuthModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
    HttpModule,
  ],
  controllers: [
    GitHubWebhooksController,
    GithubOAuthController,
    GithubConnectionsController,
    GithubPRIntegrationController,
  ],
  providers: [
    GitHubService,
    GitHubIndexingService,
    IncrementalIndexService,
    SymbolJumpService,
    TreeSitterService,
    SecretScannerService,
    GithubOAuthApiService,
    GithubAnalysisService,
    GithubCodeGeneratorService,
    GithubPRIntegrationService,
    GithubCacheInvalidationService,
    GithubConnectionService,
  ],
  exports: [
    GitHubService,
    IncrementalIndexService,
    GithubOAuthApiService,
    SymbolJumpService,
    TreeSitterService,
  ],
})
export class GitHubModule {}
