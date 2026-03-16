import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IChatTaskLinkMetadata {
  totalPlans: number;
  activePlan?: MongooseSchema.Types.ObjectId;
  lastUpdated: Date;
}

export interface IChatTaskLinkMethods {
  addTask(taskId: MongooseSchema.Types.ObjectId): Promise<any>;
  setActivePlan(taskId: MongooseSchema.Types.ObjectId): Promise<any>;
}

export type ChatTaskLinkDocument = HydratedDocument<ChatTaskLink> &
  IChatTaskLinkMethods;

@Schema({ timestamps: true, collection: 'chatTaskLinks' })
export class ChatTaskLink implements IChatTaskLinkMethods {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatConversation',
    required: true,
    unique: true,
    index: true,
  })
  chatId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: [
      {
        type: MongooseSchema.Types.ObjectId,
        ref: 'GovernedTask',
        required: true,
      },
    ],
    _id: false,
  })
  taskIds: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: {
      totalPlans: { type: Number, default: 0 },
      activePlan: { type: MongooseSchema.Types.ObjectId, ref: 'GovernedTask' },
      lastUpdated: { type: Date, default: Date.now },
    },
    _id: false,
  })
  metadata: IChatTaskLinkMetadata;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  async addTask(taskId: MongooseSchema.Types.ObjectId) {
    if (!this.taskIds.some((id: any) => id.equals(taskId))) {
      this.taskIds.push(taskId);
      this.metadata.totalPlans = this.taskIds.length;
      this.metadata.activePlan = taskId;
      this.metadata.lastUpdated = new Date();
      return await (this as any).save();
    }
    return this;
  }

  async setActivePlan(taskId: MongooseSchema.Types.ObjectId) {
    if (this.taskIds.some((id: any) => id.equals(taskId))) {
      this.metadata.activePlan = taskId;
      this.metadata.lastUpdated = new Date();
      return await (this as any).save();
    }
    throw new Error('Task not found in this chat');
  }
}

export const ChatTaskLinkSchema = SchemaFactory.createForClass(ChatTaskLink);

// Indexes for performance
ChatTaskLinkSchema.index({ chatId: 1, 'metadata.activePlan': 1 });
ChatTaskLinkSchema.index({ taskIds: 1 });

// Instance methods
ChatTaskLinkSchema.methods.addTask = async function (
  taskId: MongooseSchema.Types.ObjectId,
) {
  if (!this.taskIds.some((id: any) => id.equals(taskId))) {
    this.taskIds.push(taskId);
    this.metadata.totalPlans = this.taskIds.length;
    this.metadata.activePlan = taskId;
    this.metadata.lastUpdated = new Date();
    return await this.save();
  }
  return this;
};

ChatTaskLinkSchema.methods.setActivePlan = async function (
  taskId: MongooseSchema.Types.ObjectId,
) {
  if (this.taskIds.some((id: any) => id.equals(taskId))) {
    this.metadata.activePlan = taskId;
    this.metadata.lastUpdated = new Date();
    return await this.save();
  }
  throw new Error('Task not found in this chat');
};

// Static methods
ChatTaskLinkSchema.statics.findOrCreateByChatId = async function (
  chatId: MongooseSchema.Types.ObjectId,
) {
  let link = await this.findOne({ chatId });
  if (!link) {
    link = await this.create({
      chatId,
      taskIds: [],
      metadata: {
        totalPlans: 0,
        lastUpdated: new Date(),
      },
    });
  }
  return link;
};
