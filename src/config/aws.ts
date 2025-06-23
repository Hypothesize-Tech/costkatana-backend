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

export const AWS_CONFIG = {
    bedrock: {
        modelId: process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',
        maxTokens: 4096,
        temperature: 0.7,
    },
    s3: {
        bucketName: process.env.AWS_S3_BUCKET || 'ai-cost-optimizer-reports',
    },
    cloudWatch: {
        namespace: 'AICostOptimizer',
    },
};