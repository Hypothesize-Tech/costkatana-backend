export enum AIProvider {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  AWSBedrock = 'aws-bedrock',
  Google = 'google-ai',
  Cohere = 'cohere',
  HuggingFace = 'huggingface',
  DeepSeek = 'deepseek',
  Grok = 'grok',
  Ollama = 'ollama',
  Replicate = 'replicate',
  Azure = 'azure',
}

/**
 * Provider object mapping for backward compatibility
 */
export const AIProviderObj = {
  OpenAI: AIProvider.OpenAI,
  Anthropic: AIProvider.Anthropic,
  AWSBedrock: AIProvider.AWSBedrock,
  Google: AIProvider.Google,
  Cohere: AIProvider.Cohere,
  HuggingFace: AIProvider.HuggingFace,
  DeepSeek: AIProvider.DeepSeek,
  Grok: AIProvider.Grok,
  Ollama: AIProvider.Ollama,
  Replicate: AIProvider.Replicate,
  Azure: AIProvider.Azure,
} as const;
