/**
 * PlanClassificationStage
 *
 * Decides whether a request is a "simple query" (run inline through the
 * routing/execution stages) or a "complex multi-step task" (hand off to
 * `GovernedAgentService` to build a structured plan the user must approve
 * before BUILD).
 *
 * Today the legacy chat path returns autonomous plans inline whenever the
 * AI router picks `multi_agent`. That works but skips the explicit
 * approval checkpoint. Once a controller surfaces "approve plan?" UI,
 * this stage will short-circuit complex queries with a
 * `plan_pending_approval` response.
 *
 * Behaviour today (Phase 2 land-safe):
 *   - Always classifies, records the result on `ctx`, but does NOT short-
 *     circuit. The execution stage still runs the multi-agent handler
 *     when route === 'multi_agent'.
 *   - Once `ApprovalManagerService` is wired into the controllers, flip
 *     this to short-circuit with `plan_pending_approval`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { TaskClassifierService } from '../../../governed-agent/services/task-classifier.service';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

@Injectable()
export class PlanClassificationStage implements PipelineStage {
  readonly name = 'plan-classification';
  private readonly logger = new Logger(PlanClassificationStage.name);

  constructor(private readonly taskClassifier: TaskClassifierService) {}

  async run(ctx: StageContext): Promise<StageResult> {
    const message = ctx.effectiveMessage?.trim() ?? '';
    if (!message) return ok();

    // Skip classification for routes that are already handled inline.
    if (ctx.route === 'mcp' || ctx.route === 'web_scraper') {
      return ok();
    }

    try {
      const classification = await this.taskClassifier.classifyTask(
        message,
        ctx.userId,
      );
      this.logger.debug('Task classified', {
        requestId: ctx.requestId,
        type: (classification as any)?.type,
        complexity: (classification as any)?.complexity,
        requiresPlanning: (classification as any)?.requiresPlanning,
      });
      // For now we attach the classification to context for the execution
      // stage to consume; the actual plan-pending-approval short-circuit
      // wires up once the frontend approval flow ships (Phase 2.5b).
      return ok({
        // Stash on a side-key so future stages / tests can read it without
        // bloating StageContext until the contract stabilises.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ...({ taskClassification: classification } as any),
      });
    } catch (err) {
      // Classification is advisory; don't fail the pipeline if Nova-Lite
      // is briefly unhappy — the route decider is independent.
      this.logger.warn('Task classification failed; continuing without it', {
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      return ok();
    }
  }
}
