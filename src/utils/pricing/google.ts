import { ModelPricing, PricingUnit } from './types';

export const GOOGLE_PRICING: ModelPricing[] = [
  // === Gemini 3 Models (Latest) ===
  {
    modelId: 'gemini-3-pro-preview',
    modelName: 'Gemini 3 Pro Preview',
    provider: 'Google AI',
    inputPrice: 2.00,
    outputPrice: 12.00,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'reasoning', 'coding', 'agents'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Latest Gemini 3 Pro preview model. Cached: $0.20'
  },
  {
    modelId: 'gemini-3-pro-image-preview',
    modelName: 'Gemini 3 Pro Image Preview',
    provider: 'Google AI',
    inputPrice: 2.00,
    outputPrice: 12.00,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'image', 'vision'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Latest Gemini 3 Pro Image preview model'
  },
  // === Gemini 2.5 Models (Latest) ===
  {
    modelId: 'gemini-2.5-pro',
    modelName: 'Gemini 2.5 Pro',
    provider: 'Google AI',
    inputPrice: 1.25, // <= 200k tokens
    outputPrice: 10.0, // <= 200k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'reasoning', 'coding'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Our state-of-the-art thinking model, capable of reasoning over complex problems in code, math, and STEM, as well as analyzing large datasets, codebases, and documents using long context. Best for multimodal understanding, coding (web development), and complex prompts. Cached: $0.125. $2.50/$15.00 for prompts > 200k tokens'
  },
  {
    modelId: 'gemini-2.5-flash',
    modelName: 'Gemini 2.5 Flash',
    provider: 'Google AI',
    inputPrice: 0.3, // text/image/video
    outputPrice: 2.5,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'audio', 'fast'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Our best model in terms of price-performance, offering well-rounded capabilities. Best for large scale processing, low-latency, high volume tasks that require thinking, and agentic use cases. Support for Live API included for some endpoints. See the model\'s thinking process as part of the response. Cached: $0.03. Audio input: $1.00'
  },
  {
    modelId: 'gemini-2.5-flash-lite-preview',
    modelName: 'Gemini 2.5 Flash-Lite Preview',
    provider: 'Google AI',
    inputPrice: 0.1, // text/image/video
    outputPrice: 0.4,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'image', 'video', 'multimodal', 'reasoning', 'thinking', 'high-throughput'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Our fastest flash model optimized for cost-efficiency and high throughput. Features 1M token context window and multimodal input. Outperforms 2.0 Flash on most evaluation benchmarks. Audio input: $0.50'
  },
  {
    modelId: 'gemini-2.5-flash-preview-09-2025',
    modelName: 'Gemini 2.5 Flash Preview',
    provider: 'Google AI',
    inputPrice: 0.3, // text/image/video
    outputPrice: 2.5,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'audio', 'fast'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Gemini 2.5 Flash preview model. Cached: $0.03'
  },
  {
    modelId: 'gemini-2.5-flash-lite',
    modelName: 'Gemini 2.5 Flash-Lite',
    provider: 'Google AI',
    inputPrice: 0.1, // text/image/video
    outputPrice: 0.4,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'fast'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Our fastest flash model optimized for cost-efficiency and high throughput (stable version). Features 1M token context window and multimodal input. Cached: $0.01. Audio input: $0.50'
  },
  {
    modelId: 'gemini-2.5-flash-audio',
    modelName: 'Gemini 2.5 Flash Audio',
    provider: 'Google AI',
    inputPrice: 1.0, // audio input
    outputPrice: 2.5, // text output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['audio', 'multimodal', 'audio-input'],
    category: 'audio',
    isLatest: true,
    notes: 'Gemini 2.5 Flash with audio input capabilities'
  },
  {
    modelId: 'gemini-2.5-flash-lite-audio-preview',
    modelName: 'Gemini 2.5 Flash-Lite Audio Preview',
    provider: 'Google AI',
    inputPrice: 0.5, // audio input
    outputPrice: 0.4, // text output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['audio', 'multimodal', 'audio-input', 'high-throughput'],
    category: 'audio',
    isLatest: true,
    notes: 'Gemini 2.5 Flash-Lite with audio input capabilities'
  },
  {
    modelId: 'gemini-2.5-flash-native-audio',
    modelName: 'Gemini 2.5 Flash Native Audio',
    provider: 'Google AI',
    inputPrice: 0.5, // text
    outputPrice: 2.0, // text
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['audio', 'multimodal', 'native-audio'],
    category: 'audio',
    isLatest: true,
    notes: 'Native audio model optimized for higher quality audio outputs. Audio/video input: $3.00, Audio output: $12.00'
  },
  {
    modelId: 'gemini-2.5-flash-native-audio-output',
    modelName: 'Gemini 2.5 Flash Native Audio Output',
    provider: 'Google AI',
    inputPrice: 3.0, // audio/video input
    outputPrice: 12.0, // audio output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['audio', 'multimodal', 'native-audio', 'audio-output'],
    category: 'audio',
    isLatest: true,
    notes: 'Native audio model with audio output capabilities'
  },
  {
    modelId: 'gemini-2.5-flash-preview-tts',
    modelName: 'Gemini 2.5 Flash Preview TTS',
    provider: 'Google AI',
    inputPrice: 0.5,
    outputPrice: 10.0, // audio output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text-to-speech', 'audio', 'tts'],
    category: 'audio',
    isLatest: true,
    notes: '2.5 Flash TTS model optimized for price-performant, low-latency speech generation'
  },
  {
    modelId: 'gemini-2.5-pro-preview-tts',
    modelName: 'Gemini 2.5 Pro Preview TTS',
    provider: 'Google AI',
    inputPrice: 1.0,
    outputPrice: 20.0, // audio output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text-to-speech', 'audio', 'tts'],
    category: 'audio',
    isLatest: true,
    notes: '2.5 Pro TTS model optimized for powerful, low-latency speech generation'
  },

  // === Gemini 2.0 Models ===
  {
    modelId: 'gemini-2.0-flash',
    modelName: 'Gemini 2.0 Flash',
    provider: 'Google AI',
    inputPrice: 0.1, // text/image/video
    outputPrice: 0.4,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'audio'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Our second generation workhorse model, with a 1 million token context window. Most balanced multimodal model built for the era of Agents. Cached: $0.025. Audio input: $0.70'
  },
  {
    modelId: 'gemini-2.0-flash-lite',
    modelName: 'Gemini 2.0 Flash-Lite',
    provider: 'Google AI',
    inputPrice: 0.075,
    outputPrice: 0.3,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'fast'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Our second generation small workhorse model, with a 1 million token context window. Optimized for cost efficiency and low latency, built for at scale usage'
  },
  {
    modelId: 'gemini-2.0-flash-audio',
    modelName: 'Gemini 2.0 Flash Audio',
    provider: 'Google AI',
    inputPrice: 0.7, // audio input
    outputPrice: 0.4, // text output
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['audio', 'multimodal', 'audio-input'],
    category: 'audio',
    isLatest: false,
    notes: 'Gemini 2.0 Flash with audio input capabilities'
  },

  // === Gemini 1.5 Models ===
  {
    modelId: 'gemini-1.5-flash',
    modelName: 'Gemini 1.5 Flash',
    provider: 'Google AI',
    inputPrice: 0.075, // <= 128k tokens
    outputPrice: 0.3, // <= 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'image', 'video', 'multimodal'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Fastest multimodal model for diverse, repetitive tasks. $0.15/$0.60 for prompts > 128k tokens'
  },
  {
    modelId: 'gemini-1.5-flash-large-context',
    modelName: 'Gemini 1.5 Flash Large Context',
    provider: 'Google AI',
    inputPrice: 0.15, // > 128k tokens
    outputPrice: 0.6, // > 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'image', 'video', 'multimodal', 'large-context'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Gemini 1.5 Flash with large context pricing (>128k tokens)'
  },
  {
    modelId: 'gemini-1.5-flash-8b',
    modelName: 'Gemini 1.5 Flash-8B',
    provider: 'Google AI',
    inputPrice: 0.0375, // <= 128k tokens
    outputPrice: 0.15, // <= 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'image', 'video', 'multimodal', 'efficient'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Smallest model for lower intelligence use cases. $0.075/$0.30 for prompts > 128k tokens'
  },
  {
    modelId: 'gemini-1.5-flash-8b-large-context',
    modelName: 'Gemini 1.5 Flash-8B Large Context',
    provider: 'Google AI',
    inputPrice: 0.075, // > 128k tokens
    outputPrice: 0.3, // > 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'image', 'video', 'multimodal', 'efficient', 'large-context'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Gemini 1.5 Flash-8B with large context pricing (>128k tokens)'
  },
  {
    modelId: 'gemini-1.5-pro',
    modelName: 'Gemini 1.5 Pro',
    provider: 'Google AI',
    inputPrice: 1.25, // <= 128k tokens
    outputPrice: 5.0, // <= 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'code', 'reasoning', 'multimodal'],
    category: 'text',
    isLatest: false,
    notes: 'Highest intelligence Gemini 1.5 series model with 2M context. $2.50/$10.00 for prompts > 128k tokens'
  },
  {
    modelId: 'gemini-1.5-pro-large-context',
    modelName: 'Gemini 1.5 Pro Large Context',
    provider: 'Google AI',
    inputPrice: 2.5, // > 128k tokens
    outputPrice: 10.0, // > 128k tokens
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'code', 'reasoning', 'multimodal', 'large-context'],
    category: 'text',
    isLatest: false,
    notes: 'Gemini 1.5 Pro with large context pricing (>128k tokens)'
  },

  // === Gemma Models (Open Source) ===
  {
    modelId: 'gemma-3n',
    modelName: 'Gemma 3n',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'multimodal', '140-languages', 'mobile-optimized'],
    category: 'text',
    isLatest: true,
    notes: 'The latest open models, designed for efficient execution on low-resource devices, capable of multimodal input (text, image, video, audio), and trained with data in over 140 spoken languages. Open model built for efficient performance on everyday devices (free tier only)'
  },
  {
    modelId: 'gemma-3',
    modelName: 'Gemma 3',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'open-source', 'multimodal', '140-languages', 'wide-variety-tasks'],
    category: 'text',
    isLatest: true,
    notes: 'The third generation of our open models, featuring the ability to solve a wide variety of tasks with text and image input, support for over 140 languages, and long 128K context window (free tier only)'
  },
  {
    modelId: 'gemma-2',
    modelName: 'Gemma 2',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'text-generation', 'summarization', 'extraction'],
    category: 'text',
    isLatest: false,
    notes: 'The second generation of our open models featuring text generation, summarization, and extraction (free tier only)'
  },
  {
    modelId: 'gemma',
    modelName: 'Gemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'text-generation', 'summarization', 'extraction', 'lightweight'],
    category: 'text',
    isLatest: false,
    notes: 'A small-sized, lightweight open model supporting text generation, summarization, and extraction (free tier only)'
  },

  // === Specialized Gemma Models ===
  {
    modelId: 'shieldgemma-2',
    modelName: 'ShieldGemma 2',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'safety-evaluation', 'instruction-tuned'],
    category: 'safety',
    isLatest: true,
    notes: 'Instruction tuned models for evaluating the safety of text and images against a set of defined safety policies (free tier only)'
  },
  {
    modelId: 'paligemma',
    modelName: 'PaliGemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'vision-language', 'siglip', 'gemma'],
    category: 'vision-language',
    isLatest: true,
    notes: 'Our open vision-language model that combines SigLIP and Gemma (free tier only)'
  },
  {
    modelId: 'codegemma',
    modelName: 'CodeGemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'coding', 'fill-in-middle', 'code-generation', 'mathematical-reasoning'],
    category: 'coding',
    isLatest: true,
    notes: 'Powerful, lightweight open model that can perform a variety of coding tasks like fill-in-the-middle code completion, code generation, natural language understanding, mathematical reasoning, and instruction following (free tier only)'
  },
  {
    modelId: 'txgemma',
    modelName: 'TxGemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'therapeutic', 'predictions', 'classifications', 'efficient-training'],
    category: 'therapeutic',
    isLatest: true,
    notes: 'Generates predictions, classifications or text based on therapeutic related data and can be used to efficiently build AI models for therapeutic-related tasks with less data and less compute (free tier only)'
  },
  {
    modelId: 'medgemma',
    modelName: 'MedGemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'medical', 'medical-comprehension', 'variants'],
    category: 'medical',
    isLatest: true,
    notes: 'Collection of Gemma 3 variants that are trained for performance on medical text and image comprehension (free tier only)'
  },
  {
    modelId: 'medsiglip',
    modelName: 'MedSigLIP',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'medical', 'medical-images', 'embedding-space'],
    category: 'medical',
    isLatest: true,
    notes: 'SigLIP variant that is trained to encode medical images and text into a common embedding space (free tier only)'
  },
  {
    modelId: 't5gemma',
    modelName: 'T5Gemma',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source', 'encoder-decoder', 'research', 'lightweight', 'powerful'],
    category: 'research',
    isLatest: true,
    notes: 'A family of lightweight yet powerful encoder-decoder research models from Google (free tier only)'
  },

  // === Embeddings Models ===
  {
    modelId: 'gemini-embedding-001',
    modelName: 'Gemini Embedding',
    provider: 'Google AI',
    inputPrice: 0.15,
    outputPrice: 0.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2048,
    capabilities: ['embeddings'],
    category: 'embedding',
    isLatest: true,
    notes: 'Gemini embedding model for semantic search and similarity tasks'
  },
  {
    modelId: 'text-embedding-004',
    modelName: 'Text Embedding 004',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2048,
    capabilities: ['embedding', 'semantic-search', 'classification', 'clustering'],
    category: 'embedding',
    isLatest: true,
    notes: 'State-of-the-art text embedding model for semantic search, classification, clustering, and similar tasks (free tier only)'
  },
  {
    modelId: 'multimodal-embeddings',
    modelName: 'Multimodal Embeddings',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2048,
    capabilities: ['embedding', 'multimodal', 'image-classification', 'image-search'],
    category: 'embedding',
    isLatest: true,
    notes: 'Generates vectors based on images, which can be used for downstream tasks like image classification, image search, and more (free tier only)'
  },

  // === Imagen Models (Image Generation) ===
  {
    modelId: 'imagen-4-generation',
    modelName: 'Imagen 4 for Generation',
    provider: 'Google AI',
    inputPrice: 0.04, // Standard
    outputPrice: 0.04, // Standard
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'higher-quality'],
    category: 'image',
    isLatest: true,
    notes: 'Use text prompts to generate novel images with higher quality than our previous image generation models'
  },
  {
    modelId: 'imagen-4-fast-generation',
    modelName: 'Imagen 4 for Fast Generation',
    provider: 'Google AI',
    inputPrice: 0.04, // Standard
    outputPrice: 0.04, // Standard
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'higher-quality', 'lower-latency'],
    category: 'image',
    isLatest: true,
    notes: 'Use text prompts to generate novel images with higher quality and lower latency than our previous image generation models'
  },
  {
    modelId: 'imagen-4-ultra-generation',
    modelName: 'Imagen 4 for Ultra Generation',
    provider: 'Google AI',
    inputPrice: 0.06, // Ultra
    outputPrice: 0.06, // Ultra
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'higher-quality', 'better-prompt-adherence'],
    category: 'image',
    isLatest: true,
    notes: 'Use text prompts to generate novel images with higher quality and better prompt adherence than our previous image generation models'
  },
  {
    modelId: 'imagen-3-generation',
    modelName: 'Imagen 3 for Generation',
    provider: 'Google AI',
    inputPrice: 0.03,
    outputPrice: 0.03,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image'],
    category: 'image',
    isLatest: false,
    notes: 'Use text prompts to generate novel images'
  },
  {
    modelId: 'imagen-3-editing-customization',
    modelName: 'Imagen 3 for Editing and Customization',
    provider: 'Google AI',
    inputPrice: 0.03,
    outputPrice: 0.03,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'image-editing', 'customization', 'mask-editing'],
    category: 'image',
    isLatest: false,
    notes: 'Use text prompts to edit existing input images, or parts of an image with a mask or generate new images based upon the context provided by input reference images'
  },
  {
    modelId: 'imagen-3-fast-generation',
    modelName: 'Imagen 3 for Fast Generation',
    provider: 'Google AI',
    inputPrice: 0.03,
    outputPrice: 0.03,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'lower-latency'],
    category: 'image',
    isLatest: false,
    notes: 'Use text prompts to generate novel images with lower latency than our other image generation models'
  },
  {
    modelId: 'imagen-captioning-vqa',
    modelName: 'Imagen for Captioning & VQA',
    provider: 'Google AI',
    inputPrice: 0.03,
    outputPrice: 0.03,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image', 'image-editing', 'mask-editing', 'captioning', 'vqa'],
    category: 'image',
    isLatest: false,
    notes: 'Use text prompts to generate novel images, edit existing ones, edit parts of an image with a mask and more'
  },

  // === Veo Models (Video Generation) ===
  {
    modelId: 'veo-2',
    modelName: 'Veo 2',
    provider: 'Google AI',
    inputPrice: 0.35, // per second
    outputPrice: 0.35, // per second
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['video-generation', 'text-to-video', 'image-to-video', 'higher-quality'],
    category: 'video',
    isLatest: true,
    notes: 'Use text prompts and images to generate novel videos with higher quality than our previous video generation model (priced per second)'
  },
  {
    modelId: 'veo-3',
    modelName: 'Veo 3',
    provider: 'Google AI',
    inputPrice: 0.35, // per second
    outputPrice: 0.35, // per second
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['video-generation', 'text-to-video', 'image-to-video', 'higher-quality'],
    category: 'video',
    isLatest: true,
    notes: 'Use text prompts and images to generate novel videos with higher quality than our previous video generation model (priced per second)'
  },
  {
    modelId: 'veo-3-fast',
    modelName: 'Veo 3 Fast',
    provider: 'Google AI',
    inputPrice: 0.35, // per second
    outputPrice: 0.35, // per second
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['video-generation', 'text-to-video', 'image-to-video', 'higher-quality', 'lower-latency'],
    category: 'video',
    isLatest: true,
    notes: 'Use text prompts and images to generate novel videos with higher quality and lower latency than our previous video generation model (priced per second)'
  },

  // === Preview Models ===
  {
    modelId: 'virtual-try-on',
    modelName: 'Virtual Try-On',
    provider: 'Google AI',
    inputPrice: 0.0, // Free tier only
    outputPrice: 0.0, // Free tier only
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'virtual-try-on', 'clothing'],
    category: 'image',
    isLatest: true,
    notes: 'Generate images of people wearing clothing products (preview model, free tier only)'
  },
  {
    modelId: 'veo-3-preview',
    modelName: 'Veo 3 Preview',
    provider: 'Google AI',
    inputPrice: 0.35, // per second
    outputPrice: 0.35, // per second
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['video-generation', 'text-to-video', 'image-to-video', 'higher-quality', 'preview'],
    category: 'video',
    isLatest: true,
    notes: 'Use text prompts and images to generate novel videos with higher quality than our previous video generation model (preview model, priced per second)'
  },
  {
    modelId: 'veo-3-fast-preview',
    modelName: 'Veo 3 Fast Preview',
    provider: 'Google AI',
    inputPrice: 0.35, // per second
    outputPrice: 0.35, // per second
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['video-generation', 'text-to-video', 'image-to-video', 'higher-quality', 'lower-latency', 'preview'],
    category: 'video',
    isLatest: true,
    notes: 'Use text prompts and images to generate novel videos with higher quality and lower latency than our previous video generation model (preview model, priced per second)'
  },

  // === Legacy Models for Backward Compatibility ===
  {
    modelId: 'gemini-1.0-pro',
    modelName: 'Gemini 1.0 Pro',
    provider: 'Google AI',
    inputPrice: 1.00,
    outputPrice: 2.00,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 32768,
    capabilities: ['text', 'vision', 'multimodal'],
    category: 'text',
    isLatest: false,
    notes: 'Earlier generation Gemini model (legacy)'
  },
  {
    modelId: 'gemini-1.0-pro-vision',
    modelName: 'Gemini 1.0 Pro Vision',
    provider: 'Google AI',
    inputPrice: 1.00,
    outputPrice: 2.00,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 32768,
    capabilities: ['text', 'vision', 'multimodal'],
    category: 'text',
    isLatest: false,
    notes: 'Earlier generation Gemini model with vision capabilities (legacy)'
  }
]; 