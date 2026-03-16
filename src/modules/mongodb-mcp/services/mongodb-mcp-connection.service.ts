import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MongodbMcpConnection,
  MongodbMcpConnectionDocument,
} from '../../../schemas/integration/mongodb-mcp-connection.schema';
import { MongodbMcpConnectionHelperService } from './mongodb-mcp-connection-helper.service';
import { MongodbMcpService } from './mongodb-mcp.service';
import type { CreateMongodbConnectionDto } from '../dto/create-mongodb-connection.dto';
import type { UpdateMongodbConnectionDto } from '../dto/update-mongodb-connection.dto';
import { McpPermissionService } from '../../mcp/services/mcp-permission.service';

function parseConnectionStringMetadata(
  connectionString: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  try {
    const url = new URL(connectionString);
    if (url.username) metadata.username = decodeURIComponent(url.username);
    if (url.hostname) metadata.host = url.hostname;
    if (url.port && !connectionString.includes('mongodb+srv://')) {
      metadata.port = parseInt(url.port, 10);
    }
    if (url.pathname && url.pathname.length > 1) {
      const dbName = url.pathname.substring(1);
      if (dbName) metadata.database = dbName;
    }
    if (connectionString.includes('mongodb+srv://'))
      metadata.provider = 'atlas';
    else if (
      connectionString.includes('docdb.amazonaws.com') ||
      connectionString.includes('documentdb')
    )
      metadata.provider = 'aws-documentdb';
    else if (
      connectionString.includes('cosmos.azure.com') ||
      connectionString.includes('cosmosdb')
    )
      metadata.provider = 'azure-cosmos';
    else metadata.provider = 'self-hosted';
    if (url.searchParams.has('region')) {
      metadata.region = url.searchParams.get('region') ?? undefined;
    }
  } catch {
    // ignore
  }
  return metadata;
}

@Injectable()
export class MongodbMcpConnectionService {
  constructor(
    @InjectModel(MongodbMcpConnection.name)
    private readonly connectionModel: Model<MongodbMcpConnectionDocument>,
    private readonly helper: MongodbMcpConnectionHelperService,
    private readonly mcpService: MongodbMcpService,
    private readonly mcpPermissionService: McpPermissionService,
  ) {}

  async create(
    userId: string,
    dto: CreateMongodbConnectionDto,
  ): Promise<MongodbMcpConnectionDocument> {
    const sanitizedDb = this.helper.sanitizeDatabaseName(dto.database.trim());
    if (!sanitizedDb || sanitizedDb.length === 0) {
      throw new BadRequestException(
        'Database name cannot be empty after sanitization. Use alphanumeric characters, underscores, or hyphens.',
      );
    }
    if (sanitizedDb.length > 64) {
      throw new BadRequestException(
        'Database name cannot exceed 64 characters.',
      );
    }
    if (sanitizedDb.startsWith('-') || sanitizedDb.endsWith('-')) {
      throw new BadRequestException(
        'Database name cannot start or end with a hyphen.',
      );
    }

    const existing = await this.connectionModel.findOne({
      userId: new Types.ObjectId(userId),
      alias: dto.alias,
    });
    if (existing) {
      throw new ConflictException('Connection with this alias already exists');
    }

    const parsed = parseConnectionStringMetadata(dto.connectionString);
    const { database: _db, ...rest } = parsed;
    const finalMetadata = { ...rest, ...dto.metadata };

    const doc = new this.connectionModel({
      userId: new Types.ObjectId(userId),
      alias: dto.alias,
      database: sanitizedDb,
      metadata: finalMetadata,
      isActive: true,
    });
    this.helper.setConnectionString(doc, dto.connectionString);

    const validation = await this.helper.validateConnection(doc);
    if (!validation.valid) {
      throw new BadRequestException(
        `Connection validation failed: ${validation.error}`,
      );
    }

    await doc.save();

    await this.mcpPermissionService
      .grantPermissionsForNewConnection(userId, 'mongodb', String(doc._id))
      .catch(() => {});

    return doc;
  }

  async list(userId: string): Promise<MongodbMcpConnectionDocument[]> {
    return this.connectionModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('-connectionString')
      .sort({ lastUsed: -1, createdAt: -1 })
      .exec();
  }

  async getOne(
    userId: string,
    connectionId: string,
  ): Promise<MongodbMcpConnectionDocument | null> {
    return this.connectionModel
      .findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      })
      .select('-connectionString')
      .exec();
  }

  async update(
    userId: string,
    connectionId: string,
    dto: UpdateMongodbConnectionDto,
  ): Promise<MongodbMcpConnectionDocument> {
    const doc = await this.connectionModel
      .findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
      })
      .select('+connectionString')
      .exec();

    if (!doc) return null as unknown as MongodbMcpConnectionDocument;

    if (dto.alias != null) doc.alias = dto.alias;
    if (dto.database !== undefined) {
      if (dto.database && typeof dto.database === 'string') {
        const sanitized = this.helper.sanitizeDatabaseName(dto.database.trim());
        if (!sanitized || sanitized.length === 0) {
          throw new BadRequestException(
            'Database name cannot be empty after sanitization.',
          );
        }
        if (sanitized.length > 64) {
          throw new BadRequestException(
            'Database name cannot exceed 64 characters.',
          );
        }
        if (sanitized.startsWith('-') || sanitized.endsWith('-')) {
          throw new BadRequestException(
            'Database name cannot start or end with a hyphen.',
          );
        }
        doc.database = sanitized;
      }
    }
    if (dto.metadata) {
      doc.metadata = { ...doc.metadata, ...dto.metadata };
    }
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.connectionString) {
      this.helper.setConnectionString(doc, dto.connectionString);
      const validation = await this.helper.validateConnection(doc);
      if (!validation.valid) {
        throw new BadRequestException(
          `Connection validation failed: ${validation.error}`,
        );
      }
    }

    await doc.save();
    this.mcpService.clearCacheForConnection(userId, connectionId);
    return doc;
  }

  async delete(userId: string, connectionId: string): Promise<boolean> {
    const doc = await this.connectionModel.findOneAndDelete({
      _id: new Types.ObjectId(connectionId),
      userId: new Types.ObjectId(userId),
    });
    if (doc) {
      this.mcpService.clearCacheForConnection(userId, connectionId);
      return true;
    }
    return false;
  }

  async validate(connection: MongodbMcpConnectionDocument): Promise<{
    valid: boolean;
    message: string;
    validation?: { valid: boolean; error?: string; stats?: unknown };
  }> {
    const connWithString = await this.connectionModel
      .findById(connection._id)
      .select('+connectionString')
      .exec();
    if (!connWithString) {
      return { valid: false, message: 'Connection not found' };
    }
    const validation = await this.helper.validateConnection(connWithString);
    return {
      valid: validation.valid,
      message: validation.valid
        ? 'Connection validated successfully'
        : `Validation failed: ${validation.error}`,
      validation,
    };
  }
}
