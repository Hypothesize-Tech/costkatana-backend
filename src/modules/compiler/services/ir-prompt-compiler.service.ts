/**
 * IR Prompt Compiler Service
 *
 * Wraps the legacy IR-based prompt compiler (src/compiler/promptCompiler.service) with
 * Bedrock-powered summarization for context compression. Use this when you need the
 * full IR optimization pipeline with real AI summarization.
 */

import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { PromptCompilerService as LegacyPromptCompiler } from '../../../compiler/promptCompiler.service';

const SUMMARIZATION_MODEL = 'us.anthropic.claude-3-haiku-20240307-v1:0';

@Injectable()
export class IRPromptCompilerService {
  /**
   * Compile prompt with full optimization pipeline and real AI summarization.
   */
  async compile(
    prompt: string,
    options: {
      optimizationLevel?: 0 | 1 | 2 | 3;
      targetTokens?: number;
      preserveQuality?: boolean;
      enableParallelization?: boolean;
    } = {},
  ) {
    const summarizer = async (
      text: string,
      _maxOutputTokens?: number,
    ): Promise<string> => {
      const userPrompt = `Summarize the following in 1-3 concise sentences. Preserve key facts and intent. Output only the summary.\n\n${text}`;
      const response = await BedrockService.invokeModel(
        userPrompt,
        SUMMARIZATION_MODEL,
        { useSystemPrompt: false },
      );
      return (response ?? '').trim();
    };

    return LegacyPromptCompiler.compile(prompt, {
      ...options,
      summarizer,
    });
  }
}
