import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { AwsModule } from '../aws/aws.module';
import { AuthModule } from '../auth/auth.module';
import { McpController } from './mcp.controller';
import { McpPermissionService } from './services/mcp-permission.service';
import { OAuthScopeMapperService } from './services/oauth-scope-mapper.service';
import { ConfirmationService } from './services/confirmation.service';
import { McpAuditService } from './services/mcp-audit.service';
import { McpAuthService } from './services/mcp-auth.service';
import { SseTransportService } from './services/sse-transport.service';
import {
  StdioTransportService,
  STDIO_TRANSPORT_CONFIG,
  StdioTransportConfig,
} from './services/transports/stdio-transport.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { TokenManagerService } from './services/token-manager.service';
import { McpServerService } from './services/mcp-server.service';
import { McpInitializationService } from './services/mcp-initialization.service';
import { VercelMcpService } from './services/integrations/vercel-mcp.service';
import { GitHubMcpService } from './services/integrations/github-mcp.service';
import { MongoDbMcpService } from './services/integrations/mongodb-mcp.service';
import { SlackMcpService } from './services/integrations/slack-mcp.service';
import { DiscordMcpService } from './services/integrations/discord-mcp.service';
import { JiraMcpService } from './services/integrations/jira-mcp.service';
import { LinearMcpService } from './services/integrations/linear-mcp.service';
import { GoogleMcpService } from './services/integrations/google-mcp.service';
import { AwsMcpService } from './services/integrations/aws-mcp.service';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => CommonModule),
    SchemasModule,
    AwsModule,
    AuthModule,
  ],
  controllers: [McpController],
  providers: [
    {
      provide: STDIO_TRANSPORT_CONFIG,
      useFactory: (configService: ConfigService): StdioTransportConfig => ({
        command: configService.get<string>('MCP_STDIO_COMMAND') || 'node',
        args: configService.get<string>('MCP_STDIO_ARGS')
          ? configService.get<string>('MCP_STDIO_ARGS')!.split(/\s+/)
          : [],
        timeout: configService.get<number>('MCP_STDIO_TIMEOUT') ?? 30000,
      }),
      inject: [ConfigService],
    },
    McpPermissionService,
    OAuthScopeMapperService,
    ConfirmationService,
    McpAuditService,
    McpAuthService,
    SseTransportService,
    StdioTransportService,
    ToolRegistryService,
    RateLimiterService,
    TokenManagerService,
    McpServerService,
    McpInitializationService,
    VercelMcpService,
    GitHubMcpService,
    MongoDbMcpService,
    SlackMcpService,
    DiscordMcpService,
    JiraMcpService,
    LinearMcpService,
    GoogleMcpService,
    AwsMcpService,
  ],
  exports: [
    McpPermissionService,
    ConfirmationService,
    McpAuditService,
    McpAuthService,
    SseTransportService,
    ToolRegistryService,
    RateLimiterService,
    TokenManagerService,
    McpServerService,
    VercelMcpService,
    GitHubMcpService,
    JiraMcpService,
    GoogleMcpService,
    MongoDbMcpService,
    AwsMcpService,
  ],
})
export class McpModule {}
