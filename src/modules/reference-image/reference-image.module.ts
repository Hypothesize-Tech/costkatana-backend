import { Module } from '@nestjs/common';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { GenAITelemetryService } from '../../utils/genaiTelemetry';
import { BedrockService } from '../bedrock/bedrock.service';
import { ReferenceImageController } from './reference-image.controller';
import { ReferenceImageS3Service } from './reference-image-s3.service';
import { ReferenceImageAnalysisService } from './reference-image-analysis.service';

@Module({
  imports: [
    SchemasModule, // PromptTemplate, Activity models
    CommonModule, // LoggerService
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [ReferenceImageController],
  providers: [
    ReferenceImageS3Service,
    ReferenceImageAnalysisService,
    GenAITelemetryService, // required by BedrockService
    BedrockService,
  ],
  exports: [ReferenceImageAnalysisService, ReferenceImageS3Service],
})
export class ReferenceImageModule {}
