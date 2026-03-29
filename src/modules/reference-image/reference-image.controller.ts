import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Types, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../schemas/prompt/prompt-template.schema';
import {
  Activity,
  ActivityDocument,
} from '../../schemas/core/activity.schema';
import { ReferenceImageS3Service } from './reference-image-s3.service';
import { ReferenceImageAnalysisService } from './reference-image-analysis.service';
import { TriggerExtractionDto } from './dto/trigger-extraction.dto';
import { PresignedUrlQueryDto } from './dto/presigned-url-query.dto';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class ReferenceImageController {
  private readonly logger = new Logger(ReferenceImageController.name);

  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly referenceImageS3Service: ReferenceImageS3Service,
    private readonly referenceImageAnalysisService: ReferenceImageAnalysisService,
  ) {}

  /**
   * Get presigned URL for viewing a reference image
   * GET /v1/reference-image/presigned-url?s3Key=...
   */
  @Get('reference-image/presigned-url')
  @Public()
  async getPresignedUrl(
    @Query() query: PresignedUrlQueryDto,
  ): Promise<{ presignedUrl: string; expiresIn: number }> {
    this.logger.log('Generating presigned URL', {
      component: 'ReferenceImageController',
      operation: 'getPresignedUrl',
      s3Key: query.s3Key,
    });

    const presignedUrl =
      await this.referenceImageS3Service.generatePresignedUrl(
        query.s3Key,
        3600,
      );

    return {
      presignedUrl,
      expiresIn: 3600,
    };
  }

  /**
   * Pre-upload reference image before template creation
   * POST /v1/reference-image/pre-upload
   */
  @Post('reference-image/pre-upload')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (req, file, callback) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async preUploadReferenceImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
  ): Promise<{
    s3Url: string;
    s3Key: string;
    uploadedAt: Date;
    uploadedBy: string;
    fileName: string;
    fileSize: number;
    fileType: string;
  }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log('Pre-uploading reference image', {
      component: 'ReferenceImageController',
      operation: 'preUploadReferenceImage',
      userId,
      fileName: file.originalname,
      fileSize: file.size,
    });

    // Upload to S3 with temporary path (will be moved when template is created)
    const tempTemplateId = `temp-${Date.now()}`;
    const { s3Key, s3Url } =
      await this.referenceImageS3Service.uploadReferenceImage(
        tempTemplateId,
        userId,
        file.buffer,
        file.originalname,
        file.mimetype,
      );

    return {
      s3Url,
      s3Key,
      uploadedAt: new Date(),
      uploadedBy: userId,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
    };
  }

  /**
   * Upload reference image for a template
   * POST /v1/templates/:templateId/reference-image/upload
   */
  @Post('templates/:templateId/reference-image/upload')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (req, file, callback) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadReferenceImage(
    @Param('templateId') templateId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
  ): Promise<{ message: string; data: PromptTemplateDocument }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check if user owns template
    if (template.createdBy.toString() !== userId) {
      throw new ForbiddenException('You do not have access to this template');
    }

    // Check if template is visual compliance
    if (!template.isVisualCompliance) {
      throw new BadRequestException(
        'Template is not a visual compliance template',
      );
    }

    this.logger.log('Uploading reference image', {
      component: 'ReferenceImageController',
      operation: 'uploadReferenceImage',
      templateId,
      userId,
      fileName: file.originalname,
      fileSize: file.size,
    });

    // Upload to S3
    const { s3Key, s3Url } =
      await this.referenceImageS3Service.uploadReferenceImage(
        templateId,
        userId,
        file.buffer,
        file.originalname,
        file.mimetype,
      );

    // Update template with reference image info
    template.referenceImage = {
      s3Url,
      s3Key,
      uploadedAt: new Date(),
      uploadedBy: userId,
      extractedFeatures: {
        extractedAt: new Date(),
        extractedBy: '',
        status: 'pending',
        analysis: {
          visualDescription: '',
          structuredData: {
            colors: { dominant: [], accent: [], background: '' },
            layout: { composition: '', orientation: '', spacing: '' },
            objects: [],
            text: { detected: [], prominent: [], language: '' },
            lighting: { type: '', direction: '', quality: '' },
            quality: { sharpness: '', clarity: '', professionalGrade: false },
          },
          criteriaAnalysis: [],
        },
        extractionCost: {
          initialCallTokens: { input: 0, output: 0, cost: 0 },
          followUpCalls: [],
          totalTokens: 0,
          totalCost: 0,
        },
        usage: {
          checksPerformed: 0,
          totalTokensSaved: 0,
          totalCostSaved: 0,
          averageConfidence: 0,
          lowConfidenceCount: 0,
        },
      },
    };

    await template.save();

    // Log activity
    await this.activityModel.create({
      userId: new Types.ObjectId(userId),
      type: 'reference_image_uploaded',
      title: 'Reference Image Uploaded',
      description: `Uploaded reference image for template "${template.name}"`,
      metadata: {
        templateId: new Types.ObjectId(templateId),
        templateName: template.name,
        fileName: file.originalname,
        fileSize: file.size,
        s3Key,
      },
    });

    // Trigger async feature extraction
    this.referenceImageAnalysisService
      .extractReferenceFeatures(
        s3Url,
        template.variables
          .filter((v: any) => v.name.startsWith('criterion_'))
          .map((v: any) => ({
            name: v.name,
            text: v.defaultValue || v.description || '',
          })),
        template.visualComplianceConfig?.industry || 'retail',
        templateId,
        userId,
      )
      .catch((error) => {
        this.logger.error('Background feature extraction failed', {
          component: 'ReferenceImageController',
          error: error instanceof Error ? error.message : String(error),
          templateId,
        });
      });

    return {
      message:
        'Reference image uploaded successfully. Feature extraction started in background.',
      data: template,
    };
  }

  /**
   * Manually trigger feature extraction
   * POST /v1/templates/:templateId/reference-image/extract
   */
  @Post('templates/:templateId/reference-image/extract')
  async triggerExtraction(
    @Param('templateId') templateId: string,
    @Body() body: TriggerExtractionDto,
    @CurrentUser() userId: string,
  ): Promise<{
    message: string;
    data: { templateId: string; status: string };
  }> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check access
    if (template.createdBy.toString() !== userId) {
      throw new ForbiddenException('Forbidden');
    }

    // Check if reference image exists
    if (!template.referenceImage || !template.referenceImage.s3Url) {
      throw new BadRequestException(
        'No reference image found for this template',
      );
    }

    // Check if already processing
    if (
      template.referenceImage.extractedFeatures?.status === 'processing' &&
      !body.forceRefresh
    ) {
      throw new ConflictException('Feature extraction already in progress');
    }

    // Trigger extraction (don't await)
    this.referenceImageAnalysisService
      .retryExtraction(templateId, userId)
      .catch((error) => {
        this.logger.error('Manual feature extraction failed', {
          component: 'ReferenceImageController',
          error: error instanceof Error ? error.message : String(error),
          templateId,
        });
      });

    return {
      message: 'Feature extraction started',
      data: {
        templateId,
        status: 'processing',
      },
    };
  }

  /**
   * Get extraction status
   * GET /v1/templates/:templateId/reference-image/status
   */
  @Get('templates/:templateId/reference-image/status')
  async getExtractionStatus(
    @Param('templateId') templateId: string,
    @CurrentUser() userId: string,
  ): Promise<{
    status: string;
    extractedAt?: Date;
    extractedBy?: string;
    errorMessage?: string;
    extractionCost?: any;
    usage?: any;
  }> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.referenceImage) {
      throw new NotFoundException('No reference image found');
    }

    return {
      status: template.referenceImage.extractedFeatures?.status || 'pending',
      extractedAt: template.referenceImage.extractedFeatures?.extractedAt,
      extractedBy: template.referenceImage.extractedFeatures?.extractedBy,
      errorMessage: template.referenceImage.extractedFeatures?.errorMessage,
      extractionCost: template.referenceImage.extractedFeatures?.extractionCost,
      usage: template.referenceImage.extractedFeatures?.usage,
    };
  }

  /**
   * Stream extraction status updates via SSE
   * GET /v1/templates/:templateId/reference-image/stream
   */
  @Get('templates/:templateId/reference-image/stream')
  async streamExtractionStatus(
    @Param('templateId') templateId: string,
    @CurrentUser() userId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    // Verify template exists
    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Get origin from request or use default
    const origin = res.req.headers.origin || 'http://localhost:3000';

    // Set SSE headers with CORS support
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, User-Agent, Accept, Cache-Control, X-Requested-With',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Type, Cache-Control, X-Accel-Buffering',
    );

    // Send initial connection message with current status
    const currentStatus =
      template.referenceImage?.extractedFeatures?.status || 'pending';
    res.write(
      `data: ${JSON.stringify({
        type: 'connected',
        message: 'Extraction status stream connected',
        templateId,
        status: currentStatus,
        extractedAt: template.referenceImage?.extractedFeatures?.extractedAt,
        extractedBy: template.referenceImage?.extractedFeatures?.extractedBy,
        usage: template.referenceImage?.extractedFeatures?.usage,
        extractionCost:
          template.referenceImage?.extractedFeatures?.extractionCost?.totalCost,
        errorMessage: template.referenceImage?.extractedFeatures?.errorMessage,
      })}\n\n`,
    );

    // Set up heartbeat to prevent timeout
    const heartbeatInterval = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 30000); // Send heartbeat every 30 seconds

    // Listen for extraction status updates
    const extractionEmitter =
      this.referenceImageAnalysisService.getExtractionEmitter();
    const statusUpdateHandler = (data: any) => {
      // Filter events for this specific template
      if (data.templateId === templateId) {
        res.write(
          `data: ${JSON.stringify({
            type: 'status_update',
            ...data,
          })}\n\n`,
        );

        // Close connection when extraction completes or fails
        if (data.status === 'completed' || data.status === 'failed') {
          res.write(
            `data: ${JSON.stringify({
              type: 'close',
              message: 'Extraction finished',
            })}\n\n`,
          );

          // Clean up and close
          clearInterval(heartbeatInterval);
          extractionEmitter.off('status_update', statusUpdateHandler);
          res.end();
        }
      }
    };

    extractionEmitter.on('status_update', statusUpdateHandler);

    // Handle client disconnect
    res.req.on('close', () => {
      clearInterval(heartbeatInterval);
      extractionEmitter.off('status_update', statusUpdateHandler);
    });

    // Set timeout to auto-close after 5 minutes
    const timeout = setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({
          type: 'timeout',
          message: 'Stream timeout - exceeded maximum duration',
        })}\n\n`,
      );
      clearInterval(heartbeatInterval);
      extractionEmitter.off('status_update', statusUpdateHandler);
      res.end();
    }, 300000); // 5 minutes

    // Clean up timeout on manual close
    res.req.on('close', () => {
      clearTimeout(timeout);
    });
  }

  /**
   * Get extracted features
   * GET /v1/templates/:templateId/reference-image/features
   */
  @Get('templates/:templateId/reference-image/features')
  async getExtractedFeatures(
    @Param('templateId') templateId: string,
    @CurrentUser() userId: string,
  ): Promise<any> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.referenceImage?.extractedFeatures) {
      throw new NotFoundException('No extracted features found');
    }

    return template.referenceImage.extractedFeatures;
  }

  /**
   * Delete reference image
   * DELETE /v1/templates/:templateId/reference-image
   */
  @Delete('templates/:templateId/reference-image')
  async deleteReferenceImage(
    @Param('templateId') templateId: string,
    @CurrentUser() userId: string,
  ): Promise<{ message: string }> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check access
    if (template.createdBy.toString() !== userId) {
      throw new ForbiddenException('Forbidden');
    }

    if (!template.referenceImage) {
      throw new NotFoundException('No reference image found');
    }

    const s3Key = template.referenceImage.s3Key;

    // Delete from S3
    await this.referenceImageS3Service.deleteReferenceImage(s3Key);

    // Remove from template
    template.referenceImage = undefined;
    await template.save();

    return {
      message: 'Reference image deleted successfully',
    };
  }

  /**
   * Get cost savings statistics
   * GET /v1/templates/:templateId/reference-image/cost-savings
   */
  @Get('templates/:templateId/reference-image/cost-savings')
  async getCostSavings(
    @Param('templateId') templateId: string,
    @CurrentUser() userId: string,
  ): Promise<{
    extractionCost: { totalTokens: number; totalCost: number };
    usage: {
      checksPerformed: number;
      totalTokensSaved: number;
      totalCostSaved: number;
      averageTokensPerCheck: number;
      averageCostPerCheck: number;
      averageConfidence: number;
      lowConfidenceCount: number;
    };
    savings: {
      netSavings: number;
      breakEven: boolean;
      checksToBreakEven: number;
      roi: number;
    };
  }> {
    // Validate templateId
    if (!Types.ObjectId.isValid(templateId)) {
      throw new BadRequestException('Invalid template ID');
    }

    const template = await this.promptTemplateModel.findById(templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.referenceImage?.extractedFeatures) {
      throw new NotFoundException('No extracted features found');
    }

    const { extractionCost, usage } = template.referenceImage.extractedFeatures;

    // Calculate break-even status
    const breakEven = usage.totalCostSaved >= extractionCost.totalCost;
    const checksToBreakEven = breakEven
      ? 0
      : Math.ceil(
          (extractionCost.totalCost - usage.totalCostSaved) /
            (usage.totalCostSaved / Math.max(usage.checksPerformed, 1)),
        );

    // Calculate ROI
    const roi =
      extractionCost.totalCost > 0
        ? ((usage.totalCostSaved - extractionCost.totalCost) /
            extractionCost.totalCost) *
          100
        : 0;

    return {
      extractionCost: {
        totalTokens: extractionCost.totalTokens,
        totalCost: extractionCost.totalCost,
      },
      usage: {
        checksPerformed: usage.checksPerformed,
        totalTokensSaved: usage.totalTokensSaved,
        totalCostSaved: usage.totalCostSaved,
        averageTokensPerCheck:
          usage.checksPerformed > 0
            ? Math.round(usage.totalTokensSaved / usage.checksPerformed)
            : 0,
        averageCostPerCheck:
          usage.checksPerformed > 0
            ? usage.totalCostSaved / usage.checksPerformed
            : 0,
        averageConfidence: usage.averageConfidence,
        lowConfidenceCount: usage.lowConfidenceCount,
      },
      savings: {
        netSavings: usage.totalCostSaved - extractionCost.totalCost,
        breakEven,
        checksToBreakEven,
        roi: Math.round(roi * 100) / 100, // Round to 2 decimals
      },
    };
  }
}
