import { Schema, model, Document, Types } from 'mongoose';

export interface IChatTaskLink extends Document {
  chatId: Types.ObjectId;
  taskIds: Types.ObjectId[];
  metadata: {
    totalPlans: number;
    activePlan?: Types.ObjectId;
    lastUpdated: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const chatTaskLinkSchema = new Schema<IChatTaskLink>({
  chatId: {
    type: Schema.Types.ObjectId,
    ref: 'ChatConversation',
    required: true,
    unique: true,
    index: true
  },
  taskIds: [{
    type: Schema.Types.ObjectId,
    ref: 'GovernedTask',
    required: true
  }],
  metadata: {
    totalPlans: {
      type: Number,
      default: 0
    },
    activePlan: {
      type: Schema.Types.ObjectId,
      ref: 'GovernedTask',
      required: false
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true,
  collection: 'chatTaskLinks'
});

// Indexes for performance
chatTaskLinkSchema.index({ chatId: 1, 'metadata.activePlan': 1 });
chatTaskLinkSchema.index({ taskIds: 1 });

// Instance methods
chatTaskLinkSchema.methods.addTask = async function(taskId: Types.ObjectId) {
  if (!this.taskIds.some((id: Types.ObjectId) => id.equals(taskId))) {
    this.taskIds.push(taskId);
    this.metadata.totalPlans = this.taskIds.length;
    this.metadata.activePlan = taskId;
    this.metadata.lastUpdated = new Date();
    return await this.save();
  }
  return this;
};

chatTaskLinkSchema.methods.setActivePlan = async function(taskId: Types.ObjectId) {
  if (this.taskIds.some((id: Types.ObjectId) => id.equals(taskId))) {
    this.metadata.activePlan = taskId;
    this.metadata.lastUpdated = new Date();
    return await this.save();
  }
  throw new Error('Task not found in this chat');
};

// Static methods
chatTaskLinkSchema.statics.findOrCreateByChatId = async function(chatId: Types.ObjectId) {
  let link = await this.findOne({ chatId });
  if (!link) {
    link = await this.create({
      chatId,
      taskIds: [],
      metadata: {
        totalPlans: 0,
        lastUpdated: new Date()
      }
    });
  }
  return link;
};

export const ChatTaskLink = model<IChatTaskLink>('ChatTaskLink', chatTaskLinkSchema);