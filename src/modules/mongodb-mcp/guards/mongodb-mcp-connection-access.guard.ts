import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MongodbMcpConnection,
  MongodbMcpConnectionDocument,
} from '../../../schemas/integration/mongodb-mcp-connection.schema';

export const MONGODB_CONNECTION_KEY = 'mongodbConnection';

@Injectable()
export class MongodbMcpConnectionAccessGuard implements CanActivate {
  constructor(
    @InjectModel(MongodbMcpConnection.name)
    private readonly connectionModel: Model<MongodbMcpConnectionDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const userId = user?.id ?? user?._id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const connectionId = request.params?.connectionId;
    if (!connectionId) {
      throw new NotFoundException('Connection ID is required');
    }

    const connection = await this.connectionModel
      .findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(String(userId)),
      })
      .exec();

    if (!connection) {
      throw new NotFoundException(
        'MongoDB connection not found or unauthorized',
      );
    }

    request[MONGODB_CONNECTION_KEY] = connection;
    return true;
  }
}
