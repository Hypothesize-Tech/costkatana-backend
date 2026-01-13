/**
 * SafeBedrockEmbeddings - A wrapper around BedrockEmbeddings that validates inputs
 * to prevent AWS Bedrock ValidationException: Malformed input request: expected minLength: 1
 * 
 * This wrapper ensures all text inputs are non-empty before calling the underlying service.
 */

import { BedrockEmbeddings, BedrockEmbeddingsParams } from '@langchain/aws';
import { loggingService } from './logging.service';

// Default embedding dimensions for Amazon Titan Embed Text v2
const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export class SafeBedrockEmbeddings extends BedrockEmbeddings {
    private dimensions: number;

    constructor(params: BedrockEmbeddingsParams & { dimensions?: number }) {
        super(params);
        this.dimensions = params.dimensions || DEFAULT_EMBEDDING_DIMENSIONS;
    }

    /**
     * Create a zero vector with the correct dimensions
     */
    private createZeroVector(): number[] {
        return new Array(this.dimensions).fill(0);
    }

    /**
     * Validate and clean text input
     * @returns cleaned text or null if invalid
     */
    private validateText(text: string | undefined | null): string | null {
        if (!text || typeof text !== 'string') {
            return null;
        }
        const cleaned = text.trim();
        if (cleaned.length === 0) {
            return null;
        }
        return cleaned;
    }

    /**
     * Override embedQuery to validate input before calling parent
     */
    async embedQuery(text: string): Promise<number[]> {
        const cleanedText = this.validateText(text);
        
        if (!cleanedText) {
            loggingService.warn('SafeBedrockEmbeddings: Empty text provided to embedQuery, returning zero vector', {
                component: 'SafeBedrockEmbeddings',
                operation: 'embedQuery',
                originalLength: text?.length || 0
            });
            return this.createZeroVector();
        }

        try {
            return await super.embedQuery(cleanedText);
        } catch (error: any) {
            // If it's still a validation error, return zero vector
            if (error?.name === 'ValidationException' || 
                error?.message?.includes('minLength: 1')) {
                loggingService.error('SafeBedrockEmbeddings: ValidationException despite validation, returning zero vector', {
                    component: 'SafeBedrockEmbeddings',
                    operation: 'embedQuery',
                    textLength: cleanedText.length,
                    error: error.message
                });
                return this.createZeroVector();
            }
            throw error;
        }
    }

    /**
     * Override embedDocuments to validate all inputs before calling parent
     */
    async embedDocuments(texts: string[]): Promise<number[][]> {
        if (!texts || !Array.isArray(texts) || texts.length === 0) {
            loggingService.warn('SafeBedrockEmbeddings: Empty or invalid texts array provided to embedDocuments', {
                component: 'SafeBedrockEmbeddings',
                operation: 'embedDocuments'
            });
            return [];
        }

        // Track which indices have valid content
        const validIndices: number[] = [];
        const validTexts: string[] = [];

        for (let i = 0; i < texts.length; i++) {
            const cleanedText = this.validateText(texts[i]);
            if (cleanedText) {
                validIndices.push(i);
                validTexts.push(cleanedText);
            }
        }

        // If no valid texts, return zero vectors for all
        if (validTexts.length === 0) {
            loggingService.warn('SafeBedrockEmbeddings: All texts were empty, returning zero vectors', {
                component: 'SafeBedrockEmbeddings',
                operation: 'embedDocuments',
                totalTexts: texts.length
            });
            return texts.map(() => this.createZeroVector());
        }

        // Log if some texts were filtered
        if (validTexts.length < texts.length) {
            loggingService.info('SafeBedrockEmbeddings: Filtered empty texts from embedDocuments batch', {
                component: 'SafeBedrockEmbeddings',
                operation: 'embedDocuments',
                totalTexts: texts.length,
                validTexts: validTexts.length,
                filteredOut: texts.length - validTexts.length
            });
        }

        try {
            // Get embeddings for valid texts only
            const validEmbeddings = await super.embedDocuments(validTexts);

            // Map embeddings back to original positions
            const result: number[][] = texts.map(() => this.createZeroVector());
            for (let i = 0; i < validIndices.length; i++) {
                result[validIndices[i]] = validEmbeddings[i];
            }

            return result;
        } catch (error: any) {
            // If it's still a validation error, return zero vectors
            if (error?.name === 'ValidationException' || 
                error?.message?.includes('minLength: 1')) {
                loggingService.error('SafeBedrockEmbeddings: ValidationException despite validation, returning zero vectors', {
                    component: 'SafeBedrockEmbeddings',
                    operation: 'embedDocuments',
                    validTextsCount: validTexts.length,
                    error: error.message
                });
                return texts.map(() => this.createZeroVector());
            }
            throw error;
        }
    }
}

/**
 * Factory function to create SafeBedrockEmbeddings with default configuration
 */
export function createSafeBedrockEmbeddings(params?: Partial<BedrockEmbeddingsParams & { dimensions?: number }>): SafeBedrockEmbeddings {
    return new SafeBedrockEmbeddings({
        region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
        model: process.env.RAG_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
        maxRetries: 3,
        dimensions: 1024,
        ...params
    });
}
