import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PromptVersion,
  PromptVersionDocument,
} from '../../../schemas/prompt/prompt-version.schema';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../../schemas/prompt/prompt-template.schema';

interface CreateVersionInput {
  templateId: string;
  content: string;
  changeNote?: string;
  agentId?: string;
  nodeId?: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

@Injectable()
export class PromptVersionService {
  private readonly logger = new Logger(PromptVersionService.name);

  constructor(
    @InjectModel(PromptVersion.name)
    private readonly versionModel: Model<PromptVersionDocument>,
    @InjectModel(PromptTemplate.name)
    private readonly templateModel: Model<PromptTemplateDocument>,
  ) {}

  async createVersion(
    userId: string,
    input: CreateVersionInput,
  ): Promise<PromptVersionDocument> {
    const template = await this.templateModel.findById(input.templateId);
    if (!template) throw new NotFoundException('Prompt template not found');
    if (template.createdBy.toString() !== userId) {
      throw new ForbiddenException('Cannot version a template you do not own');
    }

    const last = await this.versionModel
      .findOne({ templateId: template._id })
      .sort({ version: -1 })
      .lean();
    const nextVersion = (last?.version ?? 0) + 1;

    const created = await this.versionModel.create({
      templateId: template._id,
      version: nextVersion,
      content: input.content,
      changeNote: input.changeNote,
      createdBy: new Types.ObjectId(userId),
      parentVersionId: last?._id,
      agentId: input.agentId,
      nodeId: input.nodeId,
    });

    template.currentVersionId = created._id as Types.ObjectId as any;
    template.content = input.content;
    template.version = nextVersion;
    await template.save();

    this.logger.log(
      `Created version ${nextVersion} for template ${template._id}`,
    );
    return created;
  }

  async listVersions(
    templateId: string,
    userId: string,
  ): Promise<PromptVersion[]> {
    await this.assertReadable(templateId, userId);
    return this.versionModel
      .find({ templateId: new Types.ObjectId(templateId) })
      .sort({ version: -1 })
      .lean<PromptVersion[]>();
  }

  async getVersion(
    templateId: string,
    versionNumber: number,
    userId: string,
  ): Promise<PromptVersion> {
    await this.assertReadable(templateId, userId);
    const v = await this.versionModel
      .findOne({
        templateId: new Types.ObjectId(templateId),
        version: versionNumber,
      })
      .lean<PromptVersion>();
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  async pinVersion(
    templateId: string,
    versionNumber: number,
    userId: string,
  ): Promise<PromptTemplateDocument> {
    const template = await this.templateModel.findById(templateId);
    if (!template) throw new NotFoundException('Prompt template not found');
    if (template.createdBy.toString() !== userId) {
      throw new ForbiddenException('Cannot pin on a template you do not own');
    }
    const v = await this.versionModel.findOne({
      templateId: template._id,
      version: versionNumber,
    });
    if (!v) throw new NotFoundException('Version not found');
    template.currentVersionId = v._id as Types.ObjectId as any;
    template.content = v.content;
    template.version = v.version;
    await template.save();
    this.logger.log(
      `Pinned version ${versionNumber} for template ${template._id}`,
    );
    return template;
  }

  async restoreVersion(
    templateId: string,
    versionNumber: number,
    userId: string,
  ): Promise<PromptVersionDocument> {
    const target = await this.getVersion(templateId, versionNumber, userId);
    return this.createVersion(userId, {
      templateId,
      content: target.content,
      changeNote: `Restored from version ${versionNumber}`,
    });
  }

  async diff(
    templateId: string,
    fromVersion: number,
    toVersion: number,
    userId: string,
  ): Promise<{ from: number; to: number; lines: DiffLine[] }> {
    const [a, b] = await Promise.all([
      this.getVersion(templateId, fromVersion, userId),
      this.getVersion(templateId, toVersion, userId),
    ]);
    return {
      from: fromVersion,
      to: toVersion,
      lines: computeLineDiff(a.content, b.content),
    };
  }

  async resolveContent(templateId: string): Promise<string | null> {
    const template = await this.templateModel.findById(templateId).lean();
    if (!template) return null;
    if (template.currentVersionId) {
      const v = await this.versionModel
        .findById(template.currentVersionId)
        .lean();
      if (v) return v.content;
    }
    return template.content ?? null;
  }

  async getGlobalAgentPromptContent(): Promise<string | null> {
    const template = await this.templateModel
      .findOne({ isGlobalAgentPrompt: true, isActive: true, isDeleted: false })
      .lean();
    if (!template) return null;
    if (template.currentVersionId) {
      const v = await this.versionModel
        .findById(template.currentVersionId)
        .lean();
      if (v) return v.content;
    }
    return template.content ?? null;
  }

  private async assertReadable(
    templateId: string,
    userId: string,
  ): Promise<void> {
    const template = await this.templateModel.findById(templateId);
    if (!template) throw new NotFoundException('Prompt template not found');
    if (!template.canAccess(userId)) {
      throw new ForbiddenException('No access to this template');
    }
  }
}

function computeLineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      result.push({
        type: 'context',
        content: aLines[i],
        oldLine: i + 1,
        newLine: j + 1,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', content: aLines[i], oldLine: i + 1 });
      i++;
    } else {
      result.push({ type: 'add', content: bLines[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < m) {
    result.push({ type: 'remove', content: aLines[i], oldLine: i + 1 });
    i++;
  }
  while (j < n) {
    result.push({ type: 'add', content: bLines[j], newLine: j + 1 });
    j++;
  }
  return result;
}
