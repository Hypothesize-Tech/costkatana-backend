/**
 * Governed Plan Message Creator
 * Creates governed plan messages in chat conversations
 */

import { Types } from 'mongoose';
import { ChatMessage } from '@models/index';
import { loggingService } from '@services/logging.service';

export class GovernedPlanMessageCreator {
    /**
     * Create a governed plan message in the chat
     */
    static async createPlanMessage(
        conversationId: string,
        taskId: string,
        userId: string
    ): Promise<any> {
        try {
            // Import GovernedTask model
            const { GovernedTaskModel } = await import('../../governedAgent.service');
            
            // Get task details
            const task = await GovernedTaskModel.findById(taskId);
            if (!task) {
                throw new Error('Governed task not found');
            }
            
            // Create the plan message
            const planMessage = await ChatMessage.create({
                conversationId: new Types.ObjectId(conversationId),
                userId,
                role: 'assistant',
                content: `🤖 **Autonomous Agent Initiated**\n\nI'm creating a plan to: ${task.userRequest}\n\nYou can track the progress and interact with the plan here.`,
                messageType: 'governed_plan',
                governedTaskId: new Types.ObjectId(taskId),
                planState: task.mode,
                metadata: {
                    tokenCount: 0,
                    cost: 0,
                    latency: 0
                }
            });
            
            // Update the task with chat context
            task.chatId = new Types.ObjectId(conversationId);
            task.parentMessageId = planMessage._id;
            await task.save();
            
            // Update or create ChatTaskLink
            const { ChatTaskLink } = await import('../../../models/ChatTaskLink');
            const link = await (ChatTaskLink as any).findOrCreateByChatId(
                new Types.ObjectId(conversationId)
            );
            await link.addTask(new Types.ObjectId(taskId));
            
            loggingService.info('Created governed plan message', {
                conversationId,
                taskId,
                messageId: planMessage._id.toString()
            });
            
            return planMessage;
            
        } catch (error) {
            loggingService.error('Failed to create governed plan message', {
                error: error instanceof Error ? error.message : String(error),
                conversationId,
                taskId,
                userId
            });
            throw error;
        }
    }
}
