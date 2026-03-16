import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParallelExecutionOptimizerService } from './services/parallel-execution-optimizer.service';
import { PromptCompilerService } from './services/prompt-compiler.service';

@Module({
  imports: [MongooseModule],
  providers: [ParallelExecutionOptimizerService, PromptCompilerService],
  exports: [ParallelExecutionOptimizerService, PromptCompilerService],
})
export class CompilerModule {}
