import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentTemplate,
  AgentTemplateDocument,
} from '../../../schemas/agent-platform/agent-template.schema';
import { BUILTIN_TEMPLATES } from '../templates';
import type { AgentDag } from '../interfaces/dag.interface';
import {
  AgentDefinitionService,
} from './agent-definition.service';

@Injectable()
export class AgentTemplateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentTemplateService.name);

  constructor(
    @InjectModel(AgentTemplate.name)
    private readonly templateModel: Model<AgentTemplateDocument>,
    private readonly agentDefinitionService: AgentDefinitionService,
  ) {}

  /**
   * On boot, upsert all built-in templates by slug. Idempotent — if a
   * template's DAG was changed in code, the next boot picks it up.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const template of BUILTIN_TEMPLATES) {
      try {
        await this.templateModel.updateOne(
          { slug: template.slug },
          {
            $set: {
              slug: template.slug,
              name: template.name,
              description: template.description,
              category: template.category,
              requiredCapabilities: [...template.requiredCapabilities],
              isOfficial: template.isOfficial,
              dag: template.dag,
            },
            $setOnInsert: { clonedCount: 0 },
          },
          { upsert: true },
        );
        this.logger.log(`Upserted template: ${template.slug}`);
      } catch (err) {
        this.logger.warn(
          `Template upsert failed for ${template.slug}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async list(): Promise<AgentTemplateDocument[]> {
    return this.templateModel
      .find({ isOfficial: true })
      .sort({ category: 1, name: 1 })
      .lean<AgentTemplateDocument[]>();
  }

  async findBySlug(slug: string): Promise<AgentTemplateDocument | null> {
    return this.templateModel.findOne({ slug });
  }

  /**
   * Clone a template into a new AgentDefinition for the user. The DAG is
   * deep-copied so subsequent edits don't mutate the source fixture.
   */
  async cloneToAgent(
    userId: string,
    slug: string,
    name?: string,
    projectId?: string,
    teamId?: string,
  ) {
    const template = await this.findBySlug(slug);
    if (!template) throw new NotFoundException(`Template not found: ${slug}`);

    const dag = JSON.parse(JSON.stringify(template.dag)) as AgentDag;
    const result = await this.agentDefinitionService.create(
      userId,
      name ?? template.name,
      template.description,
      dag,
      slug,
      projectId,
      teamId,
    );

    await this.templateModel.updateOne(
      { _id: template._id },
      { $inc: { clonedCount: 1 } },
    );

    return result;
  }
}
