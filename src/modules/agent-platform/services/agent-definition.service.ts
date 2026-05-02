import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  AgentDefinition,
  AgentDefinitionDocument,
} from '../../../schemas/agent-platform/agent-definition.schema';
import {
  AgentVersion,
  AgentVersionDocument,
} from '../../../schemas/agent-platform/agent-version.schema';
import { Organization } from '../../../schemas/team-project/organization.schema';
import type {
  AgentDag,
  DagValidationResult,
} from '../interfaces/dag.interface';
import { AgentCompilerService } from './agent-compiler.service';

interface TenantContext {
  organizationId: Types.ObjectId;
  teamId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  userId: Types.ObjectId;
}

const EMPTY_DAG: AgentDag = { nodes: [], edges: [] };

@Injectable()
export class AgentDefinitionService {
  constructor(
    @InjectModel(AgentDefinition.name)
    private readonly agentModel: Model<AgentDefinitionDocument>,
    @InjectModel(AgentVersion.name)
    private readonly versionModel: Model<AgentVersionDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<any>,
    private readonly compiler: AgentCompilerService,
  ) {}

  /**
   * Resolve the user's tenant context. v1 picks the first org owned by the
   * user; v1.1 will swap this for a richer membership lookup.
   */
  async resolveTenant(
    userId: string,
    projectId?: string,
    teamId?: string,
  ): Promise<TenantContext> {
    const org = await this.orgModel
      .findOne({ ownerId: new Types.ObjectId(userId), isActive: true })
      .select('_id')
      .lean();
    if (!org) {
      throw new ForbiddenException(
        'No organization found for user — create one first.',
      );
    }
    return {
      organizationId: new Types.ObjectId(String(org._id)),
      teamId: teamId ? new Types.ObjectId(teamId) : undefined,
      projectId: projectId ? new Types.ObjectId(projectId) : undefined,
      userId: new Types.ObjectId(userId),
    };
  }

  async create(
    userId: string,
    name: string,
    description: string | undefined,
    initialDag: AgentDag,
    templateSlug: string | undefined,
    projectId?: string,
    teamId?: string,
  ): Promise<{ agent: AgentDefinitionDocument; version: AgentVersionDocument }> {
    const tenant = await this.resolveTenant(userId, projectId, teamId);
    const slug = await this.generateUniqueSlug(tenant.organizationId, name);

    const agent = await this.agentModel.create({
      organizationId: tenant.organizationId,
      teamId: tenant.teamId,
      projectId: tenant.projectId,
      createdBy: tenant.userId,
      name,
      slug,
      description: description ?? '',
      status: 'draft',
      templateSourceSlug: templateSlug,
    });

    const version = await this.versionModel.create({
      agentDefinitionId: agent._id,
      versionNumber: 1,
      dag: initialDag,
      createdBy: tenant.userId,
      changelog: 'Initial version',
    });

    agent.currentVersionId = version._id as Types.ObjectId;
    await agent.save();

    return { agent, version };
  }

  async listForUser(
    userId: string,
    filter: { projectId?: string; status?: string } = {},
  ): Promise<AgentDefinitionDocument[]> {
    const tenant = await this.resolveTenant(userId);
    const query: Record<string, unknown> = {
      organizationId: tenant.organizationId,
    };
    if (filter.projectId) query.projectId = new Types.ObjectId(filter.projectId);
    if (filter.status) query.status = filter.status;
    return this.agentModel
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean<AgentDefinitionDocument[]>();
  }

  async findById(
    userId: string,
    agentId: string,
  ): Promise<{
    agent: AgentDefinitionDocument;
    currentVersion: AgentVersionDocument | null;
  }> {
    const tenant = await this.resolveTenant(userId);
    const agent = await this.agentModel.findOne({
      _id: new Types.ObjectId(agentId),
      organizationId: tenant.organizationId,
    });
    if (!agent) throw new NotFoundException('Agent not found');
    const currentVersion = agent.currentVersionId
      ? await this.versionModel.findById(agent.currentVersionId)
      : null;
    return { agent, currentVersion };
  }

  async update(
    userId: string,
    agentId: string,
    patch: Partial<{
      name: string;
      description: string;
      tags: string[];
      status: 'draft' | 'published' | 'archived';
    }>,
  ): Promise<AgentDefinitionDocument> {
    const { agent } = await this.findById(userId, agentId);
    if (patch.name !== undefined) agent.name = patch.name;
    if (patch.description !== undefined) agent.description = patch.description;
    if (patch.tags !== undefined) agent.tags = patch.tags;
    if (patch.status !== undefined) agent.status = patch.status;
    await agent.save();
    return agent;
  }

  async remove(userId: string, agentId: string): Promise<void> {
    const tenant = await this.resolveTenant(userId);
    const result = await this.agentModel.deleteOne({
      _id: new Types.ObjectId(agentId),
      organizationId: tenant.organizationId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Agent not found');
    }
    await this.versionModel.deleteMany({
      agentDefinitionId: new Types.ObjectId(agentId),
    });
  }

  async putDag(
    userId: string,
    agentId: string,
    dag: AgentDag,
    changelog?: string,
  ): Promise<{
    version: AgentVersionDocument;
    validation: DagValidationResult;
  }> {
    if (!dag || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges)) {
      throw new BadRequestException('dag.nodes and dag.edges must be arrays');
    }
    const { agent } = await this.findById(userId, agentId);
    const last = await this.versionModel
      .findOne({ agentDefinitionId: agent._id })
      .sort({ versionNumber: -1 });
    const nextNumber = (last?.versionNumber ?? 0) + 1;
    const tenant = await this.resolveTenant(userId);

    const validation = this.compiler.compile(dag);
    // We persist the version even when validation fails — drafts can be
    // saved while in-flight. The runner refuses to execute a non-compiled
    // version. Compiled plan is only set when validation passes.
    const version = await this.versionModel.create({
      agentDefinitionId: agent._id,
      versionNumber: nextNumber,
      dag,
      compiledPlan: validation.compiled
        ? (validation.compiled as unknown as Record<string, unknown>)
        : undefined,
      entryNodeId: validation.compiled?.entryNodeIds[0],
      terminalNodeIds: validation.compiled?.terminalNodeIds ?? [],
      createdBy: tenant.userId,
      changelog: changelog ?? '',
    });
    agent.currentVersionId = version._id as Types.ObjectId;
    await agent.save();
    return { version, validation };
  }

  async publish(
    userId: string,
    agentId: string,
    versionId: string,
    changelog?: string,
  ): Promise<{
    agent: AgentDefinitionDocument;
    version: AgentVersionDocument;
  }> {
    const { agent } = await this.findById(userId, agentId);
    const version = await this.versionModel.findOne({
      _id: new Types.ObjectId(versionId),
      agentDefinitionId: agent._id,
    });
    if (!version) throw new NotFoundException('Version not found');
    version.publishedAt = new Date();
    if (changelog) version.changelog = changelog;
    await version.save();
    agent.currentVersionId = version._id as Types.ObjectId;
    agent.status = 'published';
    await agent.save();
    return { agent, version };
  }

  /**
   * Slug derivation: lowercase + hyphenate + suffix incrementing integer when
   * a collision is detected (within the same organization).
   */
  private async generateUniqueSlug(
    organizationId: Types.ObjectId,
    name: string,
  ): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'agent';
    let candidate = base;
    let suffix = 1;
    while (
      await this.agentModel.exists({ organizationId, slug: candidate })
    ) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
      if (suffix > 999) {
        candidate = `${base}-${Date.now()}`;
        break;
      }
    }
    return candidate;
  }
}

export { TenantContext };
export const __EMPTY_DAG = EMPTY_DAG;
