import { Logger } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

interface SafeBedrockEmbeddingsOptions {
  model?: string;
  region?: string;
  maxRetries?: number;
  timeout?: number;
}

export class SafeBedrockEmbeddings extends Embeddings {
  private readonly logger = new Logger(SafeBedrockEmbeddings.name);
  private client: BedrockRuntimeClient;
  private model: string;
  private maxRetries: number;
  private timeout: number;

  constructor(options: SafeBedrockEmbeddingsOptions = {}) {
    super({});
    this.model = options.model || 'amazon.titan-embed-text-v2:0';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000;

    this.client = new BedrockRuntimeClient({
      region: options.region || process.env.AWS_BEDROCK_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      maxAttempts: this.maxRetries,
    });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      try {
        const embedding = await this.embedQuery(text);
        embeddings.push(embedding);
      } catch (error: any) {
        this.logger.error(`Failed to embed document`, {
          error: error.message,
          textLength: text.length,
        });
        // Return zero vector as fallback
        embeddings.push(new Array(1024).fill(0));
      }
    }

    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const request = this.buildEmbeddingRequest(text);
      const command = new InvokeModelCommand(request);
      const response = await this.client.send(command);

      if (!response.body) {
        throw new Error('Empty response from Bedrock');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      return this.extractEmbeddings(responseBody);
    } catch (error: any) {
      this.logger.error(`Embedding failed`, {
        error: error.message,
        model: this.model,
        textLength: text.length,
      });
      // Return zero vector as fallback
      return new Array(1024).fill(0);
    }
  }

  private buildEmbeddingRequest(text: string) {
    if (this.model.includes('titan-embed-text-v2')) {
      return {
        modelId: this.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
        }),
      };
    } else if (this.model.includes('titan-embed-text-v1')) {
      return {
        modelId: this.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
        }),
      };
    } else {
      throw new Error(`Unsupported embedding model: ${this.model}`);
    }
  }

  private extractEmbeddings(responseBody: any): number[] {
    if (this.model.includes('titan-embed-text-v2')) {
      return responseBody.embedding;
    } else if (this.model.includes('titan-embed-text-v1')) {
      return responseBody.embedding;
    } else {
      throw new Error(
        `Unsupported model for embedding extraction: ${this.model}`,
      );
    }
  }
}

export function createSafeBedrockEmbeddings(
  options: SafeBedrockEmbeddingsOptions = {},
): SafeBedrockEmbeddings {
  return new SafeBedrockEmbeddings(options);
}
