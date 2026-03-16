import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MongoDBConnection,
  MongoDBConnectionDocument,
} from '../../../schemas/integration/mongodb-connection.schema';

export const MONGODB_MCP_CONTEXT = 'mongodbMcpContext';

export type MongodbMcpContextPayload = {
  connectionId: string;
  userId: string;
  startTime: number;
};

@Injectable()
export class MongodbMcpContextGuard implements CanActivate {
  private readonly logger = new Logger(MongodbMcpContextGuard.name);

  constructor(
    @InjectModel(MongoDBConnection.name)
    private mongoConnectionModel: Model<MongoDBConnectionDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    try {
      this.logger.log('MongoDB MCP context guard started', {
        component: 'MongodbMcpContextGuard',
        operation: 'canActivate',
        path: request.path,
        method: request.method,
      });

      // Extract user ID from authenticated request
      const userId = request.user?.userId || request.user?._id;
      if (!userId) {
        this.logger.warn('Authentication required for MongoDB MCP', {
          component: 'MongodbMcpContextGuard',
          operation: 'canActivate',
        });
        return false;
      }

      // Extract connection ID from request body (JSON-RPC params)
      const connectionId =
        request.body?.params?.connectionId || request.query?.connectionId;
      if (!connectionId) {
        this.logger.warn('Connection ID required for MongoDB MCP', {
          component: 'MongodbMcpContextGuard',
          operation: 'canActivate',
        });
        return false;
      }

      // Verify connection exists and user has access
      const connection = await this.mongoConnectionModel.findOne({
        _id: connectionId,
        userId,
        isActive: true,
      });

      if (!connection) {
        this.logger.warn('MongoDB connection not found or unauthorized', {
          component: 'MongodbMcpContextGuard',
          operation: 'canActivate',
          userId,
          connectionId,
        });
        return false;
      }

      // Check credential expiry
      if (connection.isCredentialExpired && connection.isCredentialExpired()) {
        this.logger.warn('MongoDB credentials expired', {
          component: 'MongodbMcpContextGuard',
          operation: 'canActivate',
          userId,
          connectionId,
        });
        return false;
      }

      // Set context for controller
      request.mongodbMcpContext = {
        connectionId,
        userId,
        startTime,
      };

      this.logger.log('MongoDB MCP context guard completed', {
        component: 'MongodbMcpContextGuard',
        operation: 'canActivate',
        userId,
        connectionId,
        duration: Date.now() - startTime,
      });

      return true;
    } catch (error) {
      this.logger.error('MongoDB MCP context guard error', {
        component: 'MongodbMcpContextGuard',
        operation: 'canActivate',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      return false;
    }
  }
}
