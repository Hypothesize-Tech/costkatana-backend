import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';

import {
  AgentDeployment,
  AgentDeploymentChannel,
  AgentDeploymentDocument,
} from '../../../schemas/agent-platform/agent-deployment.schema';
import {
  AgentDefinition,
  AgentDefinitionDocument,
} from '../../../schemas/agent-platform/agent-definition.schema';

interface CreateDeploymentInput {
  agentDefinitionId: string;
  agentVersionId: string;
  channel: AgentDeploymentChannel;
  originAllowlist?: string[];
  rateLimit?: { perMinPerIp?: number; perMinPerSession?: number };
  theme?: { primary?: string; surface?: string; position?: string; logoUrl?: string };
  welcomeMessage?: string;
}

@Injectable()
export class AgentDeploymentService {
  constructor(
    @InjectModel(AgentDeployment.name)
    private readonly deploymentModel: Model<AgentDeploymentDocument>,
    @InjectModel(AgentDefinition.name)
    private readonly defModel: Model<AgentDefinitionDocument>,
  ) {}

  async create(
    userId: string,
    organizationId: string,
    input: CreateDeploymentInput,
  ): Promise<AgentDeploymentDocument> {
    const def = await this.defModel.findOne({
      _id: new Types.ObjectId(input.agentDefinitionId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!def) throw new NotFoundException('Agent not found');

    const publicId = generatePublicId();

    return this.deploymentModel.create({
      agentDefinitionId: def._id,
      agentVersionId: new Types.ObjectId(input.agentVersionId),
      organizationId: new Types.ObjectId(organizationId),
      channel: input.channel,
      status: 'active',
      publicId,
      originAllowlist: input.originAllowlist ?? [],
      rateLimit: input.rateLimit ?? {},
      theme: input.theme ?? {},
      welcomeMessage: input.welcomeMessage ?? 'Hi — how can I help?',
      createdBy: new Types.ObjectId(userId),
      lastDeployedAt: new Date(),
    });
  }

  async listForOrg(
    organizationId: string,
    agentDefinitionId?: string,
  ): Promise<AgentDeploymentDocument[]> {
    const query: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (agentDefinitionId) {
      query.agentDefinitionId = new Types.ObjectId(agentDefinitionId);
    }
    return this.deploymentModel
      .find(query)
      .sort({ lastDeployedAt: -1 })
      .lean<AgentDeploymentDocument[]>();
  }

  async findByPublicId(publicId: string): Promise<AgentDeploymentDocument | null> {
    return this.deploymentModel.findOne({ publicId });
  }

  async findById(id: string): Promise<AgentDeploymentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.deploymentModel.findById(id);
  }

  async update(
    organizationId: string,
    deploymentId: string,
    patch: Partial<CreateDeploymentInput & { status: 'active' | 'paused' }>,
  ): Promise<AgentDeploymentDocument> {
    const dep = await this.deploymentModel.findOne({
      _id: new Types.ObjectId(deploymentId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!dep) throw new NotFoundException('Deployment not found');
    if (patch.originAllowlist !== undefined)
      dep.originAllowlist = patch.originAllowlist;
    if (patch.rateLimit)
      dep.rateLimit = { ...dep.rateLimit, ...patch.rateLimit };
    if (patch.theme) dep.theme = { ...dep.theme, ...patch.theme };
    if (patch.welcomeMessage !== undefined)
      dep.welcomeMessage = patch.welcomeMessage;
    if (patch.status) dep.status = patch.status;
    await dep.save();
    return dep;
  }

  /**
   * Origin allowlist enforcement. Exact match first; falls back to suffix
   * match (so `*.example.com` admits `app.example.com`). An empty allowlist
   * blocks everything (deployments must explicitly authorize their origins).
   */
  assertOriginAllowed(
    deployment: AgentDeploymentDocument,
    origin: string | undefined,
  ): void {
    if (!origin) {
      throw new ForbiddenException('Missing Origin header');
    }
    const allowlist = deployment.originAllowlist ?? [];
    if (allowlist.length === 0) {
      throw new ForbiddenException('No origins are allowlisted for this deployment');
    }
    const normalized = origin.replace(/\/$/, '');
    const ok = allowlist.some((entry) => {
      const trimmed = entry.replace(/\/$/, '');
      if (trimmed === normalized) return true;
      if (trimmed.startsWith('*.')) {
        const suffix = trimmed.substring(1); // ".example.com"
        return normalized.endsWith(suffix);
      }
      return false;
    });
    if (!ok) {
      throw new ForbiddenException(`Origin not allowlisted: ${origin}`);
    }
  }
}

function generatePublicId(): string {
  return `dep_${randomBytes(8).toString('hex')}`;
}
