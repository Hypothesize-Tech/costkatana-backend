/**
 * Model Metadata Provider
 * Centralized model names, providers, and descriptions
 */

export class ModelMetadata {
    /**
     * Get display name for model
     */
    static getDisplayName(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown Model';
        }

        const nameMap: Record<string, string> = {
            // === OpenAI GPT-5 Models (Latest) ===
            'gpt-5': 'GPT-5',
            'gpt-5-mini': 'GPT-5 Mini',
            'gpt-5-nano': 'GPT-5 Nano',
            'gpt-5-chat-latest': 'GPT-5 Chat Latest',
            'gpt-5-chat': 'GPT-5 Chat Latest',
            
            // === AWS Models ===
            'amazon.nova-micro-v1:0': 'Nova Micro',
            'amazon.nova-lite-v1:0': 'Nova Lite', 
            'amazon.nova-pro-v1:0': 'Nova Pro',
            'amazon.titan-text-lite-v1': 'Titan Text Lite',
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'Claude 3.5 Haiku',
            'anthropic.claude-sonnet-4-20250514-v1:0': 'Claude Sonnet 4',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Claude 3.5 Sonnet',
            'anthropic.claude-opus-4-6-v1': 'Claude Opus 4.6',
            'anthropic.claude-sonnet-4-6-v1:0': 'Claude Sonnet 4.6',
            'anthropic.claude-opus-4-1-20250805-v1:0': 'Claude 4 Opus',
            'meta.llama3-1-8b-instruct-v1:0': 'Llama 3.1 8B',
            'meta.llama3-1-70b-instruct-v1:0': 'Llama 3.1 70B',
            'meta.llama3-1-405b-instruct-v1:0': 'Llama 3.1 405B',
            'meta.llama3-2-1b-instruct-v1:0': 'Llama 3.2 1B',
            'meta.llama3-2-3b-instruct-v1:0': 'Llama 3.2 3B',
            'mistral.mistral-7b-instruct-v0:2': 'Mistral 7B',
            'mistral.mixtral-8x7b-instruct-v0:1': 'Mixtral 8x7B',
            'mistral.mistral-large-2402-v1:0': 'Mistral Large',
            'command-a-03-2025': 'Command A',
            'command-r7b-12-2024': 'Command R7B',
            'command-a-reasoning-08-2025': 'Command A Reasoning',
            'command-a-vision-07-2025': 'Command A Vision',
            'command-r-plus-04-2024': 'Command R+',
            'command-r-08-2024': 'Command R',
            'command-r-03-2024': 'Command R (03-2024)',
            'command': 'Command',
            'command-nightly': 'Command Nightly',
            'command-light': 'Command Light',
            'command-light-nightly': 'Command Light Nightly',
            'ai21.jamba-instruct-v1:0': 'Jamba Instruct',
            'ai21.j2-ultra-v1': 'Jurassic-2 Ultra',
            'ai21.j2-mid-v1': 'Jurassic-2 Mid',
            
            // Google Gemini Models
            'gemini-2.5-pro': 'Gemini 2.5 Pro',
            'gemini-2.5-flash': 'Gemini 2.5 Flash',
            'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
            'gemini-2.5-flash-audio': 'Gemini 2.5 Flash Audio',
            'gemini-2.5-flash-lite-audio-preview': 'Gemini 2.5 Flash Lite Audio Preview',
            'gemini-2.5-flash-native-audio-output': 'Gemini 2.5 Flash Native Audio Output',
            'gemini-2.0-flash': 'Gemini 2.0 Flash',
            'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
            'gemini-2.0-flash-audio': 'Gemini 2.0 Flash Audio',
            'gemini-1.5-pro': 'Gemini 1.5 Pro',
            'gemini-1.5-flash': 'Gemini 1.5 Flash',
            'gemini-1.5-flash-large-context': 'Gemini 1.5 Flash Large Context',
            'gemini-1.5-flash-8b-large-context': 'Gemini 1.5 Flash 8B Large Context',
            'gemini-1.5-pro-large-context': 'Gemini 1.5 Pro Large Context',
            'gemini-1.0-pro': 'Gemini 1.0 Pro',
            'gemini-1.0-pro-vision': 'Gemini 1.0 Pro Vision',
            
            // Google Gemma Models
            'gemma-2': 'Gemma 2',
            'gemma': 'Gemma',
            'shieldgemma-2': 'ShieldGemma 2',
            'paligemma': 'PaliGemma',
            'codegemma': 'CodeGemma',
            'txgemma': 'TxGemma',
            'medgemma': 'MedGemma',
            'medsiglip': 'MedSigLIP',
            't5gemma': 'T5Gemma',
            
            // Google Specialized Models
            'multimodal-embeddings': 'Multimodal Embeddings',
            'imagen-4-generation': 'Imagen 4 Generation',
            'imagen-4-fast-generation': 'Imagen 4 Fast Generation',
            'imagen-4-ultra-generation': 'Imagen 4 Ultra Generation',
            'imagen-3-generation': 'Imagen 3 Generation',
            'imagen-3-editing-customization': 'Imagen 3 Editing & Customization',
            'imagen-3-fast-generation': 'Imagen 3 Fast Generation',
            'imagen-captioning-vqa': 'Imagen Captioning & VQA',
            'veo-3': 'Veo 3',
            'veo-3-fast': 'Veo 3 Fast',
            'virtual-try-on': 'Virtual Try-On',
            'veo-3-preview': 'Veo 3 Preview',
            'veo-3-fast-preview': 'Veo 3 Fast Preview',
            
            // Mistral AI Models - Premier
            'mistral-medium-2508': 'Mistral Medium 3.1',
            'mistral-medium-latest': 'Mistral Medium 3.1',
            'magistral-medium-2507': 'Magistral Medium 1.1',
            'magistral-medium-latest': 'Magistral Medium 1.1',
            'codestral-2508': 'Codestral 2508',
            'codestral-latest': 'Codestral 2508',
            'voxtral-mini-2507': 'Voxtral Mini Transcribe',
            'voxtral-mini-latest': 'Voxtral Mini Transcribe',
            'devstral-medium-2507': 'Devstral Medium',
            'devstral-medium-latest': 'Devstral Medium',
            'mistral-ocr-2505': 'Mistral OCR 2505',
            'mistral-ocr-latest': 'Mistral OCR 2505',
            'mistral-large-2411': 'Mistral Large 2.1',
            'mistral-large-latest': 'Mistral Large 2.1',
            'pixtral-large-2411': 'Pixtral Large',
            'pixtral-large-latest': 'Pixtral Large',
            'mistral-small-2407': 'Mistral Small 2',
            'mistral-embed': 'Mistral Embed',
            'codestral-embed-2505': 'Codestral Embed',
            'mistral-moderation-2411': 'Mistral Moderation 24.11',
            'mistral-moderation-latest': 'Mistral Moderation 24.11',
            
            // Mistral AI Models - Open
            'magistral-small-2507': 'Magistral Small 1.1',
            'magistral-small-latest': 'Magistral Small 1.1',
            'voxtral-small-2507': 'Voxtral Small',
            'voxtral-small-latest': 'Voxtral Small',
            'mistral-small-2506': 'Mistral Small 3.2',
            'devstral-small-2507': 'Devstral Small 1.1',
            'devstral-small-latest': 'Devstral Small 1.1',
            'mistral-small-2503': 'Mistral Small 3.1',
            'mistral-small-2501': 'Mistral Small 3',
            'devstral-small-2505': 'Devstral Small 1',
            'pixtral-12b-2409': 'Pixtral 12B',
            'pixtral-12b': 'Pixtral 12B',
            'open-mistral-nemo-2407': 'Mistral NeMo 12B',
            'open-mistral-nemo': 'Mistral NeMo 12B',
            'mistral-nemo': 'Mistral NeMo',
            'open-mistral-7b': 'Mistral 7B',
            'open-mixtral-8x7b': 'Mixtral 8x7B',
            'open-mixtral-8x22b': 'Mixtral 8x22B',
            
            // Grok AI Models
            'grok-4-0709': 'Grok 4',
            'grok-3': 'Grok 3',
            'grok-3-mini': 'Grok 3 Mini',
            'grok-2-image-1212': 'Grok 2 Image',
            
            // Meta Llama 4 Models
            'llama-4-scout': 'Llama 4 Scout',
            'llama-4-maverick': 'Llama 4 Maverick',
            'llama-4-behemoth-preview': 'Llama 4 Behemoth Preview',
        };

        return nameMap[modelId] || modelId.split('.').pop()?.split('-')[0] || modelId;
    }

    /**
     * Get provider for model
     */
    static getProvider(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown';
        }

        if (modelId.startsWith('amazon.')) return 'Amazon';
        if (modelId.startsWith('anthropic.')) return 'Anthropic';
        if (modelId.startsWith('meta.')) return 'Meta';
        if (modelId.startsWith('cohere.')) return 'Cohere';
        if (modelId.startsWith('mistral.')) return 'Mistral AI';
        if (modelId.startsWith('ai21.')) return 'AI21 Labs';
        return 'Unknown';
    }

    /**
     * Get description for model
     */
    static getDescription(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown AI model';
        }

        const descriptionMap: Record<string, string> = {
            // === OpenAI GPT-5 Models (Latest) ===
            'gpt-5': 'OpenAI GPT-5 - Latest flagship model with advanced intelligence and reasoning capabilities',
            'gpt-5-mini': 'OpenAI GPT-5 Mini - Efficient variant with balanced performance and cost',
            'gpt-5-nano': 'OpenAI GPT-5 Nano - Fastest and most cost-effective GPT-5 variant',
            'gpt-5-chat-latest': 'OpenAI GPT-5 Chat Latest - Latest chat model with advanced conversational capabilities',
            'gpt-5-chat': 'OpenAI GPT-5 Chat Latest - Latest chat model with advanced conversational capabilities',
            
            // === AWS Models ===
            'amazon.nova-micro-v1:0': 'Fast and cost-effective model for simple tasks',
            'amazon.nova-lite-v1:0': 'Balanced performance and cost for general use',
            'amazon.nova-pro-v1:0': 'High-performance model for complex tasks',
            'amazon.titan-text-lite-v1': 'Lightweight text generation model',
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'Fast and intelligent for quick responses',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Advanced reasoning and analysis capabilities',
            'anthropic.claude-sonnet-4-20250514-v1:0': 'High-performance model with exceptional reasoning',
            'anthropic.claude-opus-4-6-v1': 'Next-gen flagship for agents, coding, and enterprise workflows',
            'anthropic.claude-sonnet-4-6-v1:0': 'Latest Sonnet: coding, computer use, long-context reasoning, agents',
            'anthropic.claude-opus-4-1-20250805-v1:0': 'Most powerful model for complex reasoning',
            'meta.llama3-1-8b-instruct-v1:0': 'Good balance of performance and efficiency',
            'meta.llama3-1-70b-instruct-v1:0': 'Large model for complex reasoning tasks',
            'meta.llama3-1-405b-instruct-v1:0': 'Most capable Llama model for advanced tasks',
            'meta.llama3-2-1b-instruct-v1:0': 'Compact, efficient model for basic tasks',
            'meta.llama3-2-3b-instruct-v1:0': 'Efficient model for general tasks',
            'mistral.mistral-7b-instruct-v0:2': 'Efficient open-source model',
            'mistral.mixtral-8x7b-instruct-v0:1': 'High-quality mixture of experts model',
            'mistral.mistral-large-2402-v1:0': 'Advanced reasoning and multilingual capabilities',
            'command-a-03-2025': 'Most performant model to date, excelling at tool use, agents, RAG, and multilingual use cases',
            'command-r7b-12-2024': 'Small, fast update delivered in December 2024, excels at RAG, tool use, and complex reasoning',
            'command-a-reasoning-08-2025': 'First reasoning model, able to think before generating output for nuanced problem-solving and agent-based tasks in 23 languages',
            'command-a-vision-07-2025': 'First model capable of processing images, excelling in enterprise use cases like charts, graphs, diagrams, table understanding, OCR, and object detection',
            'command-r-plus-04-2024': 'Instruction-following conversational model for complex RAG workflows and multi-step tool use',
            'command-r-08-2024': 'Update of Command R model delivered in August 2024',
            'command-r-03-2024': 'Instruction-following conversational model for complex workflows like code generation, RAG, tool use, and agents',
            'command': 'Instruction-following conversational model for language tasks with high quality and reliability',
            'command-nightly': 'Latest experimental version, not recommended for production use',
            'command-light': 'Smaller, faster version of command, almost as capable but much faster',
            'command-light-nightly': 'Latest experimental version of command-light, not recommended for production use',
            'ai21.jamba-instruct-v1:0': 'Hybrid architecture for long context tasks',
            'ai21.j2-ultra-v1': 'Large language model for complex tasks',
            'ai21.j2-mid-v1': 'Mid-size model for balanced performance',
            
            // Google Gemini Models
            'gemini-2.5-pro': 'Our most advanced reasoning Gemini model, made to solve complex problems. Best for multimodal understanding, coding, and complex prompts',
            'gemini-2.5-flash': 'Best model in terms of price-performance, offering well-rounded capabilities with Live API support and thinking process visibility',
            'gemini-2.5-flash-lite': 'Most cost effective model that supports high throughput tasks with 1M token context window and multimodal input',
            'gemini-2.5-flash-audio': 'Gemini 2.5 Flash model with audio input and output capabilities for multimodal interactions',
            'gemini-2.5-flash-lite-audio-preview': 'Preview version of Gemini 2.5 Flash Lite with audio capabilities for testing and evaluation',
            'gemini-2.5-flash-native-audio-output': 'Gemini 2.5 Flash model with native audio output generation capabilities',
            'gemini-2.0-flash': 'Newest multimodal model with next generation features and improved capabilities',
            'gemini-2.0-flash-lite': 'Gemini 2.0 Flash model optimized for cost efficiency and low latency',
            'gemini-2.0-flash-audio': 'Gemini 2.0 Flash model with audio input and output capabilities',
            'gemini-1.5-pro': 'Advanced model with long context window for complex reasoning and vision tasks',
            'gemini-1.5-flash': 'Fast and efficient model with multimodal capabilities and 1M token context',
            'gemini-1.5-flash-large-context': 'Gemini 1.5 Flash with extended context window for long-form content processing',
            'gemini-1.5-flash-8b-large-context': '8B parameter version of Gemini 1.5 Flash with large context window',
            'gemini-1.5-pro-large-context': 'Gemini 1.5 Pro with extended context window for complex long-form tasks',
            'gemini-1.0-pro': 'Balanced model for general text generation and analysis tasks',
            'gemini-1.0-pro-vision': 'Gemini 1.0 Pro with vision capabilities for multimodal understanding',
            
            // Grok AI Models
            'grok-4-0709': 'Latest Grok 4 with reasoning, vision support coming soon. 2M TPM, 480 RPM rate limits',
            'grok-3': 'Standard Grok 3 model. 600 RPM rate limits',
            'grok-3-mini': 'Cost-effective Grok 3 Mini. 480 RPM rate limits',
            'grok-2-image-1212': 'Grok 2 image generation model. $0.07 per image, 300 RPM rate limits',
            
            // Meta Llama 4 Models
            'llama-4-scout': 'Class-leading natively multimodal model with superior text and visual intelligence, single H100 GPU efficiency, and 10M context window for seamless long document analysis',
            'llama-4-maverick': 'Industry-leading natively multimodal model for image and text understanding with groundbreaking intelligence and fast responses at a low cost',
            'llama-4-behemoth-preview': 'Early preview of the Llama 4 teacher model used to distill Llama 4 Scout and Llama 4 Maverick. Still in training phase',
            
            // Mistral AI Models - Premier
            'mistral-medium-2508': 'Our frontier-class multimodal model released August 2025. Improving tone and performance.',
            'mistral-medium-latest': 'Our frontier-class multimodal model released August 2025. Improving tone and performance.',
            'magistral-medium-2507': 'Our frontier-class reasoning model released July 2025.',
            'magistral-medium-latest': 'Our frontier-class reasoning model released July 2025.',
            'codestral-2508': 'Our cutting-edge language model for coding released end of July 2025, specializes in low-latency, high-frequency tasks.',
            'codestral-latest': 'Our cutting-edge language model for coding released end of July 2025, specializes in low-latency, high-frequency tasks.',
            'voxtral-mini-2507': 'An efficient audio input model, fine-tuned and optimized for transcription purposes only.',
            'voxtral-mini-latest': 'An efficient audio input model, fine-tuned and optimized for transcription purposes only.',
            'devstral-medium-2507': 'An enterprise grade text model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'devstral-medium-latest': 'An enterprise grade text model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'mistral-ocr-2505': 'Our OCR service powering our Document AI stack that enables our users to extract interleaved text and images.',
            'mistral-ocr-latest': 'Our OCR service powering our Document AI stack that enables our users to extract interleaved text and images.',
            'mistral-large-2411': 'Our top-tier large model for high-complexity tasks with the latest version released November 2024.',
            'mistral-large-latest': 'Our top-tier large model for high-complexity tasks with the latest version released November 2024.',
            'pixtral-large-2411': 'Our first frontier-class multimodal model released November 2024.',
            'pixtral-large-latest': 'Our first frontier-class multimodal model released November 2024.',
            'mistral-small-2407': 'Our updated small version, released September 2024.',
            'mistral-embed': 'Our state-of-the-art semantic for extracting representation of text extracts.',
            'codestral-embed-2505': 'Our state-of-the-art semantic for extracting representation of code extracts.',
            'mistral-moderation-2411': 'Our moderation service that enables our users to detect harmful text content.',
            'mistral-moderation-latest': 'Our moderation service that enables our users to detect harmful text content.',
            
            // Mistral AI Models - Open
            'magistral-small-2507': 'Our small reasoning model released July 2025.',
            'magistral-small-latest': 'Our small reasoning model released July 2025.',
            'voxtral-small-2507': 'Our first model with audio input capabilities for instruct use cases.',
            'voxtral-small-latest': 'Our first model with audio input capabilities for instruct use cases.',
            'mistral-small-2506': 'An update to our previous small model, released June 2025.',
            'devstral-small-2507': 'An update to our open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'devstral-small-latest': 'An update to our open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'mistral-small-2503': 'A new leader in the small models category with image understanding capabilities, released March 2025.',
            'mistral-small-2501': 'A new leader in the small models category, released January 2025.',
            'devstral-small-2505': 'A 24B text model, open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'pixtral-12b-2409': 'A 12B model with image understanding capabilities in addition to text.',
            'pixtral-12b': 'A 12B model with image understanding capabilities in addition to text.',
            'open-mistral-nemo-2407': 'Our best multilingual open source model released July 2024.',
            'open-mistral-nemo': 'Our best multilingual open source model released July 2024.',
            'mistral-nemo': 'State-of-the-art Mistral model trained specifically for code tasks.',
            'open-mistral-7b': 'A 7B transformer model, fast-deployed and easily customisable.',
            'open-mixtral-8x7b': 'A 7B sparse Mixture-of-Experts (SMoE). Uses 12.9B active parameters out of 45B total.',
            'open-mixtral-8x22b': 'Most performant open model. A 22B sparse Mixture-of-Experts (SMoE). Uses only 39B active parameters out of 141B.',
            
            // Google Gemma Models
            'gemma-2': 'Latest open models designed for efficient execution on low-resource devices with multimodal input support',
            'gemma': 'Third generation of open models featuring wide variety of tasks with text and image input',
            'shieldgemma-2': 'Instruction tuned models for evaluating the safety of text and images against defined safety policies',
            'paligemma': 'Open vision-language model that combines SigLIP and Gemma for multimodal tasks',
            'codegemma': 'Powerful, lightweight open model for coding tasks like fill-in-the-middle completion and code generation',
            'txgemma': 'Generates predictions and classifications based on therapeutic related data for medical AI applications',
            'medgemma': 'Collection of Gemma 3 variants trained for performance on medical text and image comprehension',
            'medsiglip': 'SigLIP variant trained to encode medical images and text into a common embedding space',
            't5gemma': 'Family of lightweight yet powerful encoder-decoder research models from Google',
            
            // Google Specialized Models
            'multimodal-embeddings': 'Generates vectors based on images and text for semantic search, classification, and clustering',
            'imagen-4-generation': 'Use text prompts to generate novel images with higher quality than previous image generation models',
            'imagen-4-fast-generation': 'Use text prompts to generate novel images with higher quality and lower latency',
            'imagen-4-ultra-generation': 'Use text prompts to generate novel images with ultra quality and best prompt adherence',
            'imagen-3-generation': 'Use text prompts to generate novel images with good quality and performance',
            'imagen-3-editing-customization': 'Edit existing input images or parts of images with masks and generate new images based on reference context',
            'imagen-3-fast-generation': 'Generate novel images with lower latency than other image generation models',
            'imagen-captioning-vqa': 'Generate captions for images and answer visual questions for image understanding tasks',
            'veo-3': 'Use text prompts and images to generate novel videos with higher quality than previous video generation models',
            'veo-3-fast': 'Generate novel videos with higher quality and lower latency than previous video generation models',
            'virtual-try-on': 'Generate images of people wearing clothing products for fashion and retail applications',
            'veo-3-preview': 'Preview version of Veo 3 for testing and evaluation of video generation capabilities',
            'veo-3-fast-preview': 'Preview version of Veo 3 Fast for testing fast video generation capabilities',
        };

        return descriptionMap[modelId] || 'Advanced AI model for text generation and chat';
    }
}
