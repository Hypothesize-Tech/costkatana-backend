import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { GenAITelemetryService } from '../../utils/genaiTelemetry';
import { BedrockService } from './bedrock.service';
import { GuardrailsService } from './services/guardrails.service';

/**
 * Bedrock module – provides BedrockService for RAG and other LLM consumers.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Usage.name, schema: UsageSchema }]),
  ],
  providers: [GenAITelemetryService, BedrockService, GuardrailsService],
  exports: [BedrockService, GuardrailsService],
})
export class BedrockModule {}
