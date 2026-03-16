import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MongodbMcpService } from './services/mongodb-mcp.service';
import { MongodbMcpConnectionService } from './services/mongodb-mcp-connection.service';
import { MongodbMcpCircuitBreakerService } from './services/mongodb-mcp-circuit-breaker.service';
import {
  MongodbMcpContextGuard,
  MONGODB_MCP_CONTEXT,
  type MongodbMcpContextPayload,
} from './guards/mongodb-mcp-context.guard';
import {
  MongodbMcpConnectionAccessGuard,
  MONGODB_CONNECTION_KEY,
} from './guards/mongodb-mcp-connection-access.guard';
import type { MongodbMcpConnectionDocument } from '../../schemas/integration/mongodb-mcp-connection.schema';
import { CreateMongodbConnectionDto } from './dto/create-mongodb-connection.dto';
import { UpdateMongodbConnectionDto } from './dto/update-mongodb-connection.dto';

@Controller('api/mcp/mongodb')
@UseGuards(JwtAuthGuard)
export class MongodbMcpController {
  constructor(
    private readonly mcpService: MongodbMcpService,
    private readonly connectionService: MongodbMcpConnectionService,
    private readonly circuitBreaker: MongodbMcpCircuitBreakerService,
  ) {}

  @Post()
  @UseGuards(MongodbMcpContextGuard)
  @HttpCode(HttpStatus.OK)
  async handleToolCall(
    @Req() req: Request & { [MONGODB_MCP_CONTEXT]?: MongodbMcpContextPayload },
    @CurrentUser() _user: { id?: string; _id?: string },
    @Body()
    body: {
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
      id?: unknown;
    },
  ) {
    const ctx = req[MONGODB_MCP_CONTEXT];
    if (!ctx) {
      return {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error: context not found' },
      };
    }

    if (body.method !== 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `Method not found: ${body.method}` },
      };
    }

    const toolName = body.params?.name;
    const toolArguments = body.params?.arguments ?? {};
    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32602,
          message: 'Invalid params: tool name is required',
        },
      };
    }

    try {
      const result = await this.mcpService.executeToolCall(
        ctx.userId,
        ctx.connectionId,
        toolName,
        toolArguments,
      );
      this.circuitBreaker.recordSuccess(ctx.connectionId);
      return { jsonrpc: '2.0', id: body.id, result };
    } catch (err) {
      this.circuitBreaker.recordFailure(ctx.connectionId);
      return {
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal server error',
        },
      };
    }
  }

  @Get('tools')
  @HttpCode(HttpStatus.OK)
  listTools(): {
    success: boolean;
    count: number;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
  } {
    const tools = this.mcpService.getToolDefinitions();
    return { success: true, count: tools.length, tools };
  }

  @Get('connections')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  @HttpCode(HttpStatus.OK)
  async getConnections(@CurrentUser() user: { id?: string; _id?: string }) {
    const userId = String(user._id ?? user.id);
    const connections = await this.connectionService.list(userId);
    return {
      success: true,
      count: connections.length,
      data: connections.map((c) => ({
        _id: c._id,
        alias: c.alias,
        database: c.database,
        metadata: c.metadata,
        isActive: c.isActive,
        lastValidated: c.lastValidated,
        lastUsed: c.lastUsed,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    };
  }

  @Get('connections/:connectionId')
  @HttpCode(HttpStatus.OK)
  async getConnection(
    @CurrentUser() user: { id?: string; _id?: string },
    @Param('connectionId') connectionId: string,
  ) {
    const userId = String(user._id ?? user.id);
    const connection = await this.connectionService.getOne(
      userId,
      connectionId,
    );
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    return {
      success: true,
      data: {
        _id: connection._id,
        alias: connection.alias,
        database: connection.database,
        metadata: connection.metadata,
        isActive: connection.isActive,
        lastValidated: connection.lastValidated,
        lastUsed: connection.lastUsed,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    };
  }

  @Post('connections')
  @HttpCode(HttpStatus.CREATED)
  async createConnection(
    @CurrentUser() user: { id?: string; _id?: string },
    @Body() dto: CreateMongodbConnectionDto,
  ) {
    const userId = String(user._id ?? user.id);
    const connection = await this.connectionService.create(userId, dto);
    return {
      success: true,
      message: 'MongoDB connection created successfully',
      data: {
        _id: connection._id,
        alias: connection.alias,
        database: connection.database,
        metadata: connection.metadata,
        isActive: connection.isActive,
        lastValidated: connection.lastValidated,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    };
  }

  @Put('connections/:connectionId')
  @HttpCode(HttpStatus.OK)
  async updateConnection(
    @CurrentUser() user: { id?: string; _id?: string },
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdateMongodbConnectionDto,
  ) {
    const userId = String(user._id ?? user.id);
    const connection = await this.connectionService.update(
      userId,
      connectionId,
      dto,
    );
    if (!connection) throw new NotFoundException('Connection not found');
    return {
      success: true,
      message: 'MongoDB connection updated successfully',
      data: {
        _id: connection._id,
        alias: connection.alias,
        database: connection.database,
        metadata: connection.metadata,
        isActive: connection.isActive,
        lastValidated: connection.lastValidated,
        updatedAt: connection.updatedAt,
        createdAt: connection.createdAt,
      },
    };
  }

  @Delete('connections/:connectionId')
  @HttpCode(HttpStatus.OK)
  async deleteConnection(
    @CurrentUser() user: { id?: string; _id?: string },
    @Param('connectionId') connectionId: string,
  ) {
    const userId = String(user._id ?? user.id);
    const deleted = await this.connectionService.delete(userId, connectionId);
    if (!deleted) throw new NotFoundException('Connection not found');
    return {
      success: true,
      message: 'MongoDB connection deleted successfully',
    };
  }

  @Post('connections/:connectionId/validate')
  @UseGuards(MongodbMcpConnectionAccessGuard)
  @HttpCode(HttpStatus.OK)
  async validateConnection(
    @Req()
    req: Request & { [MONGODB_CONNECTION_KEY]?: MongodbMcpConnectionDocument },
    @CurrentUser() _user: { id?: string; _id?: string },
    @Param('connectionId') _connectionId: string,
  ) {
    const connection = req[MONGODB_CONNECTION_KEY];
    if (!connection) throw new NotFoundException('Connection not found');
    const result = await this.connectionService.validate(connection);
    return {
      ...result,
      validation: result.validation,
    };
  }
}
