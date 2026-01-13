import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromEnv } from '@aws-sdk/credential-providers';
import { loggingService } from './logging.service';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: fromEnv(),
});

export const getEmbedding = async (text: string): Promise<number[]> => {
  // Validate input - AWS Bedrock requires minLength: 1
  if (!text || text.trim().length === 0) {
    loggingService.warn('Empty text provided to getEmbedding, returning zero vector');
    // Return a zero vector of standard dimensions (1536 for Titan)
    return new Array(1536).fill(0);
  }

  const cleanText = text.trim();
  const params = {
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: '*/*',
    body: JSON.stringify({ inputText: cleanText }),
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedBody = new TextDecoder().decode(response.body);
    const parsedBody = JSON.parse(decodedBody);
    return parsedBody.embedding;
  } catch (error) {
    loggingService.error('Error generating embedding:', { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to generate embedding.');
  }
};
