import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../schemas/chat/chat-message.schema';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../../schemas/governed-agent/governed-task.schema';
import {
  ChatTaskLink,
  ChatTaskLinkDocument,
} from '../../../schemas/chat/chat-task-link.schema';
import { LoggerService } from '../../../common/logger/logger.service';

/** Model type including schema static findOrCreateByChatId */
type ChatTaskLinkModel = Model<ChatTaskLinkDocument> & {
  findOrCreateByChatId(
    chatId: MongooseSchema.Types.ObjectId,
  ): Promise<ChatTaskLinkDocument>;
};

@Injectable()
export class GovernedPlanMessageCreator {
  constructor(
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(GovernedTask.name)
    private governedTaskModel: Model<GovernedTaskDocument>,
    @InjectModel(ChatTaskLink.name)
    private chatTaskLinkModel: ChatTaskLinkModel,
    private readonly loggingService: LoggerService,
  ) {}

  /**
   * Create a governed plan message in the chat
   */
  async createPlanMessage(
    conversationId: string,
    taskId: string,
    userId: string,
  ): Promise<ChatMessageDocument> {
    try {
      // Resolve task by custom id field (e.g. task_1773655508219_ppftbjsx8).
      // Do NOT use findById - it throws CastError when taskId is not a valid ObjectId.
      const task = await this.governedTaskModel.findOne({ id: taskId });
      if (!task) {
        throw new Error('Governed task not found');
      }

      // Create the plan message - governedTaskId must be MongoDB ObjectId (_id), not custom task.id string
      const planMessage = await this.chatMessageModel.create({
        conversationId,
        userId,
        role: 'assistant',
        content: `🤖 **Autonomous Agent Initiated**\n\nI'm creating a plan to: ${task.userRequest}\n\nYou can track the progress and interact with the plan here.`,
        messageType: 'governed_plan',
        governedTaskId: task._id,
        planState: task.mode,
        metadata: {
          tokenCount: 0,
          cost: 0,
          latency: 0,
        },
      });

      // Update the task with chat context (use Schema.Types.ObjectId for schema compatibility)
      const chatIdObj = (typeof conversationId === 'string'
        ? new Types.ObjectId(conversationId)
        : conversationId) as unknown as MongooseSchema.Types.ObjectId;
      task.chatId = chatIdObj;
      task.parentMessageId =
        planMessage._id as unknown as MongooseSchema.Types.ObjectId;
      await task.save();

      // Update or create ChatTaskLink (taskIds store GovernedTask _id)
      const link = await this.chatTaskLinkModel.findOrCreateByChatId(chatIdObj);
      await link.addTask(task._id as unknown as MongooseSchema.Types.ObjectId);

      this.loggingService.info('Created governed plan message', {
        conversationId,
        taskId,
        messageId: planMessage._id.toString(),
      });

      return planMessage;
    } catch (error) {
      this.loggingService.error('Failed to create governed plan message', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        taskId,
        userId,
      });
      throw error;
    }
  }
}
