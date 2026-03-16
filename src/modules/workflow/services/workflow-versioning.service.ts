import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkflowOrchestratorService } from '../workflow-orchestrator.service';
import type { WorkflowTemplate } from '../workflow.interfaces';
import {
  WorkflowTemplateVersion,
  WorkflowTemplateVersionDocument,
} from '../../../schemas/misc/workflow-template-version.schema';

export interface WorkflowVersion {
  templateId: string;
  version: number;
  snapshot: WorkflowTemplate;
  createdAt: Date;
  label?: string;
}

@Injectable()
export class WorkflowVersioningService {
  private readonly logger = new Logger(WorkflowVersioningService.name);

  constructor(
    private readonly orchestrator: WorkflowOrchestratorService,
    @InjectModel(WorkflowTemplateVersion.name)
    private readonly workflowTemplateVersionModel: Model<WorkflowTemplateVersionDocument>,
  ) {}

  /**
   * Create a new version snapshot of a workflow template.
   */
  async createVersion(
    templateId: string,
    label?: string,
  ): Promise<WorkflowVersion | null> {
    const template = await this.orchestrator.getWorkflowTemplate(templateId);
    if (!template) return null;

    // Get the next version number by counting existing versions
    const versionCount = await this.workflowTemplateVersionModel.countDocuments(
      {
        templateId,
      },
    );

    const versionDoc = await this.workflowTemplateVersionModel.create({
      templateId,
      version: versionCount + 1,
      snapshot: { ...template },
      createdAt: new Date(),
      label,
    });

    this.logger.log('Workflow version created', {
      templateId,
      version: versionDoc.version,
    });

    return {
      templateId: versionDoc.templateId,
      version: versionDoc.version,
      snapshot: versionDoc.snapshot,
      createdAt: versionDoc.createdAt,
      label: versionDoc.label,
    };
  }

  /**
   * List versions for a template.
   */
  async listVersions(templateId: string): Promise<WorkflowVersion[]> {
    const versions = await this.workflowTemplateVersionModel
      .find({ templateId })
      .sort({ version: -1 })
      .lean();

    return versions.map((doc) => ({
      templateId: doc.templateId,
      version: doc.version,
      snapshot: doc.snapshot,
      createdAt: doc.createdAt,
      label: doc.label,
    }));
  }

  /**
   * Get a specific version snapshot.
   */
  async getVersion(
    templateId: string,
    version: number,
  ): Promise<WorkflowVersion | null> {
    const doc = await this.workflowTemplateVersionModel
      .findOne({ templateId, version })
      .lean();

    if (!doc) return null;

    return {
      templateId: doc.templateId,
      version: doc.version,
      snapshot: doc.snapshot,
      createdAt: doc.createdAt,
      label: doc.label,
    };
  }
}
