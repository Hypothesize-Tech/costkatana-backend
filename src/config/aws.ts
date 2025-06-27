import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { S3Client } from '@aws-sdk/client-s3';

export const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

export const cloudWatchClient = new CloudWatchClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

export const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

// Helper function to detect model type
function detectModelType(modelId: string): 'nova' | 'claude3' | 'claude' | 'titan' | 'unknown' {
    const lowerModelId = modelId.toLowerCase();

    if (lowerModelId.includes('nova')) {
        return 'nova';
    } else if (lowerModelId.includes('claude-3') || lowerModelId.includes('claude-v3')) {
        return 'claude3';
    } else if (lowerModelId.includes('claude')) {
        return 'claude';
    } else if (lowerModelId.includes('titan')) {
        return 'titan';
    }

    return 'unknown';
}

const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
const modelType = detectModelType(modelId);

export const AWS_CONFIG = {
    bedrock: {
        modelId,
        modelType,
        maxTokens: parseInt(process.env.AWS_BEDROCK_MAX_TOKENS || '4096'),
        temperature: parseFloat(process.env.AWS_BEDROCK_TEMPERATURE || '0.7'),
        // Model-specific configs
        isNova: modelType === 'nova',
        isClaude3: modelType === 'claude3',
        isTitan: modelType === 'titan',
    },
    s3: {
        bucketName: process.env.AWS_S3_BUCKET || 'ai-cost-optimizer-reports',
    },
    cloudWatch: {
        namespace: 'AICostOptimizer',
    },
};