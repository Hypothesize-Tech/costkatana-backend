/**
 * ContextBuildStage
 *
 * Reads the conversation's tied integration resources — GitHub repo /
 * Vercel project / MongoDB connection bound to the chat — and surfaces them
 * on `ctx` for the routing + execution stages. Pure read; no DB; no LLM.
 *
 * Mirrors the legacy block in `processChatRequest` (~lines 525-549). Once
 * `ExecutionStage` is filled in, the legacy block can be removed.
 */
import { Injectable } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

@Injectable()
export class ContextBuildStage implements PipelineStage {
  readonly name = 'context-build';

  async run(ctx: StageContext): Promise<StageResult> {
    const conversation = ctx.conversation as
      | {
          githubContext?: {
            connectionId?: { toString(): string };
            repositoryId?: string;
            repositoryName?: string;
            repositoryFullName?: string;
            integrationId?: { toString(): string };
            branchName?: string;
          };
          vercelContext?: {
            connectionId?: { toString(): string };
            projectId?: string;
            projectName?: string;
          };
          mongodbContext?: {
            connectionId?: { toString(): string };
            activeDatabase?: string;
            activeCollection?: string;
          };
        }
      | undefined;

    if (!conversation) {
      // ConversationStage didn't run or failed silently — nothing to derive.
      return ok();
    }

    const githubContext = conversation.githubContext
      ? {
          connectionId: conversation.githubContext.connectionId?.toString(),
          repositoryId: conversation.githubContext.repositoryId,
          repositoryName: conversation.githubContext.repositoryName,
          repositoryFullName: conversation.githubContext.repositoryFullName,
          integrationId: conversation.githubContext.integrationId?.toString(),
          branchName: conversation.githubContext.branchName,
        }
      : undefined;

    const vercelContext = conversation.vercelContext
      ? {
          connectionId: conversation.vercelContext.connectionId?.toString(),
          projectId: conversation.vercelContext.projectId,
          projectName: conversation.vercelContext.projectName,
        }
      : undefined;

    const mongodbContext = conversation.mongodbContext
      ? {
          connectionId: conversation.mongodbContext.connectionId?.toString(),
          activeDatabase: conversation.mongodbContext.activeDatabase,
          activeCollection: conversation.mongodbContext.activeCollection,
        }
      : undefined;

    return ok({ githubContext, vercelContext, mongodbContext });
  }
}
