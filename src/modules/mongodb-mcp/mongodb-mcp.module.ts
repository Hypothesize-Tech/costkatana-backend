import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MongodbMcpConnection,
  MongodbMcpConnectionSchema,
} from '../../schemas/integration/mongodb-mcp-connection.schema';
import {
  MongoDBConnection,
  MongoDBConnectionSchema,
} from '../../schemas/integration/mongodb-connection.schema';
import { MongodbMcpController } from './mongodb-mcp.controller';
import { MongodbMcpService } from './services/mongodb-mcp.service';
import { MongodbMcpConnectionService } from './services/mongodb-mcp-connection.service';
import { MongodbMcpConnectionHelperService } from './services/mongodb-mcp-connection-helper.service';
import { MongodbMcpPolicyService } from './services/mongodb-mcp-policy.service';
import { MongodbMcpCircuitBreakerService } from './services/mongodb-mcp-circuit-breaker.service';
import { MongodbResultFormatterService } from './services/mongodb-result-formatter.service';
import { MongodbSuggestionsService } from './services/mongodb-suggestions.service';
import { MongodbMcpStdioService } from './services/mongodb-mcp-stdio.service';
import { MongodbChatAgentService } from './services/mongodb-chat-agent.service';
import { MongodbMcpContextGuard } from './guards/mongodb-mcp-context.guard';
import { MongodbMcpConnectionAccessGuard } from './guards/mongodb-mcp-connection-access.guard';
import { McpModule } from '../mcp/mcp.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MongodbMcpConnection.name, schema: MongodbMcpConnectionSchema },
      { name: MongoDBConnection.name, schema: MongoDBConnectionSchema },
    ]),
    McpModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [MongodbMcpController],
  providers: [
    MongodbMcpService,
    MongodbMcpConnectionService,
    MongodbMcpConnectionHelperService,
    MongodbMcpPolicyService,
    MongodbMcpCircuitBreakerService,
    MongodbResultFormatterService,
    MongodbSuggestionsService,
    MongodbMcpStdioService,
    MongodbChatAgentService,
    MongodbMcpContextGuard,
    MongodbMcpConnectionAccessGuard,
  ],
  exports: [
    MongodbMcpService,
    MongodbMcpConnectionService,
    MongodbMcpConnectionHelperService,
    MongodbMcpPolicyService,
    MongodbMcpCircuitBreakerService,
    MongodbResultFormatterService,
    MongodbSuggestionsService,
    MongodbMcpStdioService,
    MongodbChatAgentService,
  ],
})
export class MongodbMcpModule {}
