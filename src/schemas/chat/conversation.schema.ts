import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IGitHubContext {
  connectionId?: MongooseSchema.Types.ObjectId;
  repositoryId?: number;
  repositoryName?: string;
  repositoryFullName?: string;
  integrationId?: MongooseSchema.Types.ObjectId;
  branchName?: string;
}

export interface IVercelContext {
  connectionId?: MongooseSchema.Types.ObjectId;
  projectId?: string;
  projectName?: string;
}

export interface IRecentQuery {
  query: any;
  collection: string;
  timestamp: Date;
}

export interface IMongoDBContext {
  connectionId?: MongooseSchema.Types.ObjectId;
  activeDatabase?: string;
  activeCollection?: string;
  recentQueries?: IRecentQuery[];
}

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, maxlength: 200 })
  title: string;

  @Prop({ required: true })
  modelId: string;

  @Prop({ default: 0, min: 0 })
  messageCount: number;

  @Prop({ default: 0, min: 0 })
  totalCost: number;

  @Prop({ maxlength: 50000 })
  lastMessage?: string;

  @Prop()
  lastMessageAt?: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isPinned: boolean;

  @Prop({ type: Boolean, default: false })
  isArchived: boolean;

  @Prop()
  deletedAt?: Date;

  @Prop({
    type: {
      connectionId: MongooseSchema.Types.ObjectId,
      repositoryId: Number,
      repositoryName: String,
      repositoryFullName: String,
      integrationId: MongooseSchema.Types.ObjectId,
      branchName: String,
    },
  })
  githubContext?: IGitHubContext;

  @Prop({
    type: {
      connectionId: MongooseSchema.Types.ObjectId,
      projectId: String,
      projectName: String,
    },
  })
  vercelContext?: IVercelContext;

  @Prop({
    type: {
      connectionId: MongooseSchema.Types.ObjectId,
      activeDatabase: String,
      activeCollection: String,
      recentQueries: [
        {
          query: mongoose.Schema.Types.Mixed,
          collection: String,
          timestamp: Date,
        },
      ],
    },
  })
  mongodbContext?: IMongoDBContext;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Aliases for chat module compatibility (refs use 'ChatConversation')
export const ChatConversation = Conversation;
export const ChatConversationSchema = ConversationSchema;
export type ChatConversationDocument = ConversationDocument;

// Indexes for performance
ConversationSchema.index({ userId: 1, updatedAt: -1 });
ConversationSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });
ConversationSchema.index({ userId: 1, isPinned: 1, updatedAt: -1 });
ConversationSchema.index({ userId: 1, isArchived: 1, updatedAt: -1 });
ConversationSchema.index({
  userId: 1,
  isActive: 1,
  isArchived: 1,
  isPinned: 1,
  updatedAt: -1,
});
