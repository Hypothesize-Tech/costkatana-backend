import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  FileTypeValidator,
  MaxFileSizeValidator,
  BadRequestException,
  ServiceUnavailableException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromptTemplateService } from './services/prompt-template.service';
import { TemplateExecutionService } from './services/template-execution.service';
import { ModelRecommendationService } from './services/model-recommendation.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  DuplicateTemplateDto,
  TemplateQueryDto,
  AddFeedbackDto,
  AIGenerateDto,
  AIDetectVariablesDto,
  AIOptimizeDto,
  ExecuteTemplateDto,
  CreateVisualComplianceDto,
} from './dto';

@Controller('api/prompt-templates')
@UseGuards(JwtAuthGuard)
export class PromptTemplateController {
  private readonly logger = new Logger(PromptTemplateController.name);

  constructor(
    private readonly promptTemplateService: PromptTemplateService,
    private readonly templateExecutionService: TemplateExecutionService,
    private readonly modelRecommendationService: ModelRecommendationService,
  ) {}

  // Standard CRUD Operations

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @CurrentUser('id') userId: string,
    @Body() createTemplateDto: CreateTemplateDto,
  ) {
    try {
      const template = await this.promptTemplateService.createTemplate(
        userId,
        createTemplateDto,
      );
      return {
        success: true,
        template,
      };
    } catch (error) {
      this.logger.error('Error creating template', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get()
  async getTemplates(
    @Query() query: TemplateQueryDto,
    @CurrentUser('id') userId?: string,
  ) {
    try {
      const result = await this.promptTemplateService.getTemplates(
        query,
        userId,
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      this.logger.error('Error getting templates', {
        query,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get('popular')
  async getPopularTemplates(
    @Query('category') category?: string,
    @Query('limit') limit?: number,
  ) {
    try {
      const templates = await this.promptTemplateService.getPopularTemplates(
        category,
        limit ? parseInt(limit.toString()) : 10,
      );
      return {
        success: true,
        templates,
      };
    } catch (error) {
      this.logger.error('Error getting popular templates', {
        category,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get('trending')
  async getTrendingTemplates(
    @Query('period') period: 'week' | 'month' | 'all' = 'week',
    @Query('category') category?: string,
    @Query('limit') limit?: number,
  ) {
    try {
      const templates = await this.promptTemplateService.getTrendingTemplates(
        period,
        category,
        limit ? parseInt(limit.toString()) : 10,
      );
      return {
        success: true,
        templates,
      };
    } catch (error) {
      this.logger.error('Error getting trending templates', {
        period,
        category,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId')
  async getTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId?: string,
  ) {
    try {
      const template = await this.promptTemplateService.getTemplateById(
        templateId,
        userId,
      );
      return {
        success: true,
        template,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error getting template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Put(':templateId')
  async updateTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
  ) {
    try {
      const template = await this.promptTemplateService.updateTemplate(
        templateId,
        userId,
        updateTemplateDto,
      );
      return {
        success: true,
        template,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error updating template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Delete(':templateId')
  async deleteTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      await this.promptTemplateService.deleteTemplate(templateId, userId);
      return {
        success: true,
        message: 'Template deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error deleting template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicateTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() duplicateTemplateDto?: DuplicateTemplateDto,
  ) {
    try {
      const template = await this.promptTemplateService.duplicateTemplate(
        templateId,
        userId,
        duplicateTemplateDto,
      );
      return {
        success: true,
        template,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error duplicating template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/feedback')
  async addFeedback(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() addFeedbackDto: AddFeedbackDto,
  ) {
    try {
      await this.promptTemplateService.addTemplateFeedback(
        templateId,
        userId,
        addFeedbackDto.rating,
        addFeedbackDto.comment,
      );
      return {
        success: true,
        message: 'Feedback added successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error adding feedback', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId/analytics')
  async getTemplateAnalytics(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      const analytics =
        await this.promptTemplateService.getTemplateAnalytics(templateId);
      return {
        success: true,
        analytics,
      };
    } catch (error) {
      this.logger.error('Error getting template analytics', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // AI-Powered Endpoints

  @Post('ai/generate')
  @HttpCode(HttpStatus.OK)
  async generateFromIntent(
    @CurrentUser('id') userId: string,
    @Body() aiGenerateDto: AIGenerateDto,
  ) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new ServiceUnavailableException('Request timeout')),
          30000,
        ),
      );

      const result = await Promise.race([
        this.promptTemplateService.generateTemplateFromIntent(
          userId,
          aiGenerateDto.intent,
          {
            category: aiGenerateDto.category,
            context: aiGenerateDto.context,
            constraints: aiGenerateDto.constraints,
          },
        ),
        timeoutPromise,
      ]);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error generating template from intent', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post('ai/detect-variables')
  async detectVariables(
    @CurrentUser('id') userId: string,
    @Body() aiDetectVariablesDto: AIDetectVariablesDto,
  ) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new ServiceUnavailableException('Request timeout')),
          30000,
        ),
      );

      const result = await Promise.race([
        this.promptTemplateService.detectVariables(
          aiDetectVariablesDto.content,
          userId,
          {
            autoFillDefaults: aiDetectVariablesDto.autoFillDefaults,
            validateTypes: aiDetectVariablesDto.validateTypes,
          },
        ),
        timeoutPromise,
      ]);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error detecting variables', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get('ai/recommendations')
  async getRecommendations(
    @CurrentUser('id') userId: string,
    @Query('currentProject') currentProject?: string,
    @Query('taskType') taskType?: string,
    @Query('limit') limit?: number,
  ) {
    try {
      const recommendations =
        await this.promptTemplateService.getRecommendations(userId, {
          currentProject,
          taskType,
          limit: limit ? parseInt(limit.toString()) : undefined,
        });
      return {
        success: true,
        recommendations,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error getting recommendations', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get('ai/search')
  async searchSemantic(
    @CurrentUser('id') userId: string,
    @Query('query') query: string,
    @Query('limit') limit?: number,
  ) {
    try {
      const results = await this.promptTemplateService.searchSemantic(
        query,
        userId,
        limit ? parseInt(limit.toString()) : 10,
      );
      return {
        success: true,
        results,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error performing semantic search', {
        userId,
        query,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/ai/optimize')
  async optimizeTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() aiOptimizeDto: AIOptimizeDto,
  ) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new ServiceUnavailableException('Request timeout')),
          30000,
        ),
      );

      const result = await Promise.race([
        this.promptTemplateService.optimizeTemplate(
          templateId,
          userId,
          aiOptimizeDto.optimizationType,
          {
            targetModel: aiOptimizeDto.targetModel,
            preserveIntent: aiOptimizeDto.preserveIntent,
          },
        ),
        timeoutPromise,
      ]);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error optimizing template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/ai/predict-effectiveness')
  async predictEffectiveness(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() body?: { variables?: Record<string, any> },
  ) {
    try {
      const result = await this.promptTemplateService.predictEffectiveness(
        templateId,
        userId,
        body?.variables,
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error predicting effectiveness', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId/ai/insights')
  async getInsights(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      const insights = await this.promptTemplateService.getInsights(templateId);
      return {
        success: true,
        insights,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error getting insights', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/ai/personalize')
  async personalizeTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      const result = await this.promptTemplateService.personalizeTemplate(
        templateId,
        userId,
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AI service temporarily unavailable'
      ) {
        throw new ServiceUnavailableException(
          'AI service temporarily unavailable',
        );
      }
      this.logger.error('Error personalizing template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/ai/apply-optimization')
  async applyOptimization(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { optimizedContent: string; metadata?: any },
  ) {
    try {
      const template = await this.promptTemplateService.applyOptimization(
        templateId,
        body.optimizedContent,
        userId,
        body.metadata,
      );
      return {
        success: true,
        template,
      };
    } catch (error) {
      this.logger.error('Error applying optimization', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Visual Compliance Endpoints

  @Post('visual-compliance')
  @HttpCode(HttpStatus.CREATED)
  async createVisualComplianceTemplate(
    @CurrentUser('id') userId: string,
    @Body() createVisualComplianceDto: CreateVisualComplianceDto,
  ) {
    try {
      const template =
        await this.promptTemplateService.createVisualComplianceTemplate(
          userId,
          createVisualComplianceDto,
        );
      return {
        success: true,
        template,
      };
    } catch (error) {
      this.logger.error('Error creating visual compliance template', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/use-visual')
  async useVisualTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { variables: Record<string, any>; projectId?: string },
  ) {
    try {
      const result =
        await this.promptTemplateService.executeVisualComplianceTemplate(
          templateId,
          userId,
          body.variables,
          body.projectId,
        );
      return {
        success: true,
        result,
      };
    } catch (error) {
      this.logger.error('Error using visual template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Post(':templateId/upload-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadTemplateImage(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { variableName: string },
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|gif|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    try {
      if (!body.variableName) {
        throw new BadRequestException('Variable name is required');
      }

      const result = await this.promptTemplateService.uploadTemplateImage(
        templateId,
        userId,
        body.variableName,
        file.buffer,
        file.mimetype,
      );

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      this.logger.error('Error uploading template image', {
        templateId,
        userId,
        variableName: body.variableName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Template Execution Endpoints

  @Post(':templateId/execute')
  async executeTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() executeTemplateDto: ExecuteTemplateDto,
  ) {
    try {
      const result = await this.promptTemplateService.executeTemplate({
        templateId,
        userId,
        ...executeTemplateDto,
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      this.logger.error('Error executing template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId/recommendation')
  async getModelRecommendation(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      const template = await this.promptTemplateService.getTemplateById(
        templateId,
        userId,
      );
      const recommendation =
        this.modelRecommendationService.recommendModel(template);

      return {
        success: true,
        recommendation,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      this.logger.error('Error getting model recommendation', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId/executions')
  async getExecutionHistory(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
  ) {
    try {
      const executions =
        await this.templateExecutionService.getExecutionHistory(
          templateId,
          userId,
          limit ? parseInt(limit.toString()) : 20,
        );

      return {
        success: true,
        executions,
      };
    } catch (error) {
      this.logger.error('Error getting execution history', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @Get(':templateId/execution-stats')
  async getExecutionStats(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
  ) {
    try {
      const stats =
        await this.templateExecutionService.getExecutionStats(templateId);

      return {
        success: true,
        stats,
      };
    } catch (error) {
      this.logger.error('Error getting execution stats', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Legacy endpoint for backward compatibility
  @Post(':templateId/use')
  async useTemplate(
    @Param('templateId') templateId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { variables: Record<string, any> },
  ) {
    try {
      const content = await this.promptTemplateService.useTemplate(
        templateId,
        userId,
        body.variables,
      );

      return {
        success: true,
        content,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Template not found') {
        throw new NotFoundException('Template not found');
      }
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        throw new ForbiddenException('Access denied');
      }
      this.logger.error('Error using template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
