import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BedrockModule } from '../bedrock/bedrock.module';
import { ParallelExecutionOptimizerService } from './services/parallel-execution-optimizer.service';
import { PromptCompilerService } from './services/prompt-compiler.service';
import { IRPromptCompilerService } from './services/ir-prompt-compiler.service';

@Module({
  imports: [MongooseModule, BedrockModule],
  providers: [
    ParallelExecutionOptimizerService,
    PromptCompilerService,
    IRPromptCompilerService,
  ],
  exports: [
    ParallelExecutionOptimizerService,
    PromptCompilerService,
    IRPromptCompilerService,
  ],
})
export class CompilerModule {}
