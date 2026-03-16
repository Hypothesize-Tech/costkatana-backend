import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OptimizationTemplate,
  OptimizationTemplateDocument,
} from '../../../schemas/misc/optimization-template.schema';

@Injectable()
export class OptimizationTemplateService {
  private readonly logger = new Logger(OptimizationTemplateService.name);

  constructor(
    @InjectModel(OptimizationTemplate.name)
    private readonly templateModel: Model<OptimizationTemplateDocument>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultTemplates();
  }

  /**
   * Get all enabled optimization templates
   */
  async getTemplates(): Promise<OptimizationTemplate[]> {
    try {
      return await this.templateModel.find({ enabled: true }).sort({ name: 1 });
    } catch (error) {
      this.logger.error('Failed to fetch optimization templates', { error });
      return [];
    }
  }

  /**
   * Get template by ID
   */
  async getTemplateById(id: string): Promise<OptimizationTemplate | null> {
    try {
      return await this.templateModel.findOne({ id, enabled: true });
    } catch (error) {
      this.logger.error('Failed to fetch optimization template', { id, error });
      return null;
    }
  }

  /**
   * Get templates by category
   */
  async getTemplatesByCategory(
    category: string,
  ): Promise<OptimizationTemplate[]> {
    try {
      return await this.templateModel
        .find({ category, enabled: true })
        .sort({ name: 1 });
    } catch (error) {
      this.logger.error('Failed to fetch templates by category', {
        category,
        error,
      });
      return [];
    }
  }

  /**
   * Seed default optimization templates
   */
  private async seedDefaultTemplates(): Promise<void> {
    try {
      const existingCount = await this.templateModel.countDocuments();
      if (existingCount > 0) {
        this.logger.log('Templates already seeded, skipping');
        return;
      }

      const defaultTemplates = [
        {
          id: 'creative_writing',
          name: 'Creative Writing',
          description: 'Optimize prompts for creative writing tasks',
          category: 'writing',
          template: 'Write a {type} about {topic} in a {style} style.',
          variables: ['type', 'topic', 'style'],
          expectedReduction: 25,
          enabled: true,
        },
        {
          id: 'code_generation',
          name: 'Code Generation',
          description: 'Optimize prompts for code generation tasks',
          category: 'programming',
          template: 'Generate {language} code to {task}. Include {features}.',
          variables: ['language', 'task', 'features'],
          expectedReduction: 30,
          enabled: true,
        },
        {
          id: 'data_analysis',
          name: 'Data Analysis',
          description: 'Optimize prompts for data analysis tasks',
          category: 'analysis',
          template:
            'Analyze the following {data_type} and provide insights on {metrics}.',
          variables: ['data_type', 'metrics'],
          expectedReduction: 35,
          enabled: true,
        },
        {
          id: 'question_answering',
          name: 'Question Answering',
          description: 'Optimize prompts for factual question answering',
          category: 'qa',
          template:
            'Answer the following question: {question}. Provide evidence and reasoning.',
          variables: ['question'],
          expectedReduction: 20,
          enabled: true,
        },
        {
          id: 'summarization',
          name: 'Text Summarization',
          description: 'Optimize prompts for text summarization tasks',
          category: 'summarization',
          template:
            'Summarize the following {content_type} in {length} words: {content}',
          variables: ['content_type', 'length', 'content'],
          expectedReduction: 28,
          enabled: true,
        },
        {
          id: 'translation',
          name: 'Translation',
          description: 'Optimize prompts for translation tasks',
          category: 'translation',
          template:
            'Translate the following text from {source_lang} to {target_lang}: {text}',
          variables: ['source_lang', 'target_lang', 'text'],
          expectedReduction: 15,
          enabled: true,
        },
      ];

      await this.templateModel.insertMany(defaultTemplates);
      this.logger.log(
        `Seeded ${defaultTemplates.length} default optimization templates`,
      );
    } catch (error) {
      this.logger.error('Failed to seed default templates', { error });
    }
  }

  /**
   * Create a new template (admin only)
   */
  async createTemplate(
    templateData: Partial<OptimizationTemplate>,
  ): Promise<OptimizationTemplate> {
    try {
      const template = new this.templateModel(templateData);
      return await template.save();
    } catch (error) {
      this.logger.error('Failed to create optimization template', { error });
      throw error;
    }
  }

  /**
   * Update a template (admin only)
   */
  async updateTemplate(
    id: string,
    updates: Partial<OptimizationTemplate>,
  ): Promise<OptimizationTemplate | null> {
    try {
      return await this.templateModel.findOneAndUpdate(
        { id },
        { ...updates, updatedAt: new Date() },
        { new: true },
      );
    } catch (error) {
      this.logger.error('Failed to update optimization template', {
        id,
        error,
      });
      throw error;
    }
  }

  /**
   * Delete a template (admin only)
   */
  async deleteTemplate(id: string): Promise<boolean> {
    try {
      const result = await this.templateModel.deleteOne({ id });
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error('Failed to delete optimization template', {
        id,
        error,
      });
      throw error;
    }
  }
}
