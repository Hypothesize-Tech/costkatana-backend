import {
  IsArray,
  IsOptional,
  IsString,
  IsObject,
  ValidateNested,
  MaxLength,
  MinLength,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RAGPatternType, RAGConfig } from '../rag/types/rag.types';

export class RAGEvalDatasetItemDto {
  @IsString()
  @MinLength(1, { message: 'Question cannot be empty' })
  @MaxLength(1000, { message: 'Question too long' })
  question: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Ground truth too long' })
  groundTruth?: string;
}

export class RAGEvalRequestDto {
  @IsArray()
  @MinLength(1, { message: 'Dataset must contain at least one item' })
  @MaxLength(50, { message: 'Dataset size must not exceed 50' })
  @ValidateNested({ each: true })
  @Type(() => RAGEvalDatasetItemDto)
  dataset: RAGEvalDatasetItemDto[];

  @IsOptional()
  @IsEnum(['naive', 'adaptive', 'iterative', 'recursive'] as const)
  pattern?: RAGPatternType;

  @IsOptional()
  @IsObject()
  config?: Partial<RAGConfig>;
}

export class RAGEvalResultItemDto {
  @IsString()
  question: string;

  @IsString()
  answer: string;

  @IsObject()
  metrics: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    overall: number;
  };

  @IsString()
  success: boolean;
}

export class RAGEvalAggregateDto {
  @IsObject()
  mean: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    overall: number;
  };

  @IsObject()
  std: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    overall: number;
  };

  @IsObject()
  min: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    overall: number;
  };

  @IsObject()
  max: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    overall: number;
  };
}

export class RAGEvalResponseDto {
  @IsArray()
  results: RAGEvalResultItemDto[];

  @ValidateNested()
  @Type(() => RAGEvalAggregateDto)
  aggregate: RAGEvalAggregateDto;

  @IsString()
  totalSamples: number;

  @IsString()
  failedSamples: number;
}
