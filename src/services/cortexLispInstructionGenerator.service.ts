/**
 * Cortex LISP Instruction Generator Service
 * 
 * This service is a meta-AI layer that generates specialized, just-in-time prompts 
 * for the three main Cortex stages (Encoder, Core Processor, Decoder). It analyzes the 
 * user's natural language query to understand its domain (e.g., coding, technical writing, general knowledge)
 * and crafts tailored instructions and examples to guide the Cortex LLMs.
 * 
 * This approach solves the "LLM doesn't know LISP" problem by providing dynamic, 
 * context-aware guidance for every request, ensuring high-quality, accurate LISP
 * processing for any domain.
 */

import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';
import { CortexConfig, DEFAULT_CORTEX_CONFIG } from '../types/cortex.types';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface LispInstructions {
    encoderPrompt: string;
    coreProcessorPrompt: string;
    decoderPrompt: string;
    domain: 'code' | 'technical' | 'creative' | 'general' | 'data';
    confidence: number;
}

interface InstructionGeneratorCacheEntry {
    queryHash: string;
    instructions: LispInstructions;
    timestamp: Date;
}

// ============================================================================
// PROMPT TEMPLATE FOR THE INSTRUCTION GENERATOR
// ============================================================================

const INSTRUCTION_GENERATOR_PROMPT = `You are a Cortex Prompt Engineer, a specialized AI that generates instructions for other AIs.
Your task is to analyze a user's query and create tailored prompts for the three stages of the Cortex pipeline: Encoder, Core Processor, and Decoder.

**1. Analyze the User Query:**
   - **Identify the domain:** Is it code generation, technical analysis, creative writing, data query, or general knowledge?
   - **Extract key entities and intent:** What is the user asking for? What are the specific requirements?

**2. Generate Three Specialized Prompts:**

   - **Encoder Prompt:** Create a system prompt that tells the Encoder LLM how to convert the user's query into a Cortex LISP structure. Provide a clear example of the expected LISP output.
   
   - **Core Processor Prompt:** Create a system prompt for the Core Processor LLM. This prompt must explain how to GENERATE THE ANSWER in the correct LISP format for the identified domain. Provide a clear example of the LISP answer format.
   
   - **Decoder Prompt:** Create a system prompt for the Decoder LLM. This prompt should explain how to convert the LISP answer back into natural, well-formatted language, paying special attention to domain-specific formatting (e.g., code blocks, tables).

**EXAMPLE 1: Code Generation**

**User Query:** "Write a python function to calculate the factorial of a number and include error handling for negative inputs."

**Your Output (in JSON format):**
{
  "domain": "code",
  "confidence": 0.98,
  "encoderPrompt": "You are a Cortex Encoder. Convert this user query into a LISP command. For code requests, use the 'implement' action and specify the language, algorithm, and requirements. Example: (query: action_implement algorithm_factorial language_python requirements_[error_handling,negative_inputs])",
  "coreProcessorPrompt": "You are a Cortex Core Processor. You answer queries in LISP. For this code request, generate the complete Python function and place it inside the 'code_' field. Example: (answer: code_[def factorial(n):\\n  if n < 0:\\n    raise ValueError(\\"Input must be non-negative\\")\\n  return 1 if n == 0 else n * factorial(n-1)] language_python description_factorial_function_with_error_handling)",
  "decoderPrompt": "You are a Cortex Decoder. You convert LISP answers to natural language. When you see a 'code_' field, extract the code, format it in a proper markdown code block, and add a brief explanation. Example: 'Here is the Python factorial function with error handling:' followed by the formatted code."
}

**EXAMPLE 2: Technical Analysis**

**User Query:** "Compare the pros and cons of server-side rendering vs. client-side rendering for a high-traffic e-commerce website."

**Your Output (in JSON format):**
{
  "domain": "technical",
  "confidence": 0.95,
  "encoderPrompt": "You are a Cortex Encoder. Convert this technical query into a LISP structure. Use the 'compare' action and identify the items being compared and the context. Example: (query: action_compare item_1_ssr item_2_csr context_high_traffic_ecommerce)",
  "coreProcessorPrompt": "You are a Cortex Core Processor. Answer in LISP. Create a 'comparison' frame with 'pros' and 'cons' lists for each item. Example: (answer: frame_comparison (item: name_ssr pros_['SEO-friendly','fast_fcp'] cons_['high_server_load']) (item: name_csr pros_['rich_interactivity'] cons_['slow_initial_load','poor_seo']))",
  "decoderPrompt": "You are a Cortex Decoder. Convert the LISP comparison to natural language. Format the output with clear headings for 'Server-Side Rendering' and 'Client-Side Rendering', and use bullet points for the pros and cons under each."
}

**EXAMPLE 3: Creative Writing**

**User Query:** "Write a short, mysterious poem about a lighthouse that guides ghost ships."

**Your Output (in JSON format):**
{
  "domain": "creative",
  "confidence": 0.92,
  "encoderPrompt": "You are a Cortex Encoder. Convert this creative request into a LISP structure. Use the 'generate' action and specify the 'type' (poem), 'tone' (mysterious), and 'elements'. Example: (query: action_generate type_poem tone_mysterious elements_['lighthouse','ghost_ships'])",
  "coreProcessorPrompt": "You are a Cortex Core Processor. Answer in LISP. Generate the creative text and place it in a 'creative_content' field. Example: (answer: creative_content_['The spectral lens, a misty gleam,\\nOn phantom sails, a silent dream...'] style_mysterious)",
  "decoderPrompt": "You are a Cortex Decoder. Convert the LISP answer to natural language. Present the 'creative_content' directly as a formatted poem, preserving line breaks."
}

**EXAMPLE 4: General Knowledge**

**User Query:** "What was the significance of the Treaty of Westphalia?"

**Your Output (in JSON format):**
{
  "domain": "general",
  "confidence": 0.99,
  "encoderPrompt": "You are a Cortex Encoder. Convert this general knowledge question to a LISP structure. Use the 'explain' action and identify the 'topic'. Example: (query: action_explain topic_treaty_of_westphalia)",
  "coreProcessorPrompt": "You are a Cortex Core Processor. Answer in LISP. Provide a 'summary' and a list of 'key_points'. Example: (answer: summary_ended_thirty_years_war_and_established_sovereign_states key_points_['ended_major_european_religious_conflict','recognized_state_sovereignty','established_precedent_for_diplomacy'])",
  "decoderPrompt": "You are a Cortex Decoder. Convert the LISP answer to natural language. Start with the summary, followed by a bulleted list of the key points for clarity."
}

**Now, analyze the following user query and generate the three prompts.**`;


// ============================================================================
// CORTEX LISP INSTRUCTION GENERATOR SERVICE
// ============================================================================

export class CortexLispInstructionGeneratorService {
    private static instance: CortexLispInstructionGeneratorService;
    private bedrockService: BedrockService;
    private cache = new Map<string, InstructionGeneratorCacheEntry>();

    private constructor() {
        this.bedrockService = new BedrockService();
    }

    public static getInstance(): CortexLispInstructionGeneratorService {
        if (!CortexLispInstructionGeneratorService.instance) {
            CortexLispInstructionGeneratorService.instance = new CortexLispInstructionGeneratorService();
        }
        return CortexLispInstructionGeneratorService.instance;
    }

    /**
     * Generates tailored LISP instructions for a given user query.
     */
    public async generateInstructions(userQuery: string, config?: Partial<CortexConfig>): Promise<LispInstructions> {
        const queryHash = await this.hashQuery(userQuery);
        
        // 1. Check cache first
        const cached = this.cache.get(queryHash);
        if (cached && (Date.now() - cached.timestamp.getTime()) < 3600000) { // 1-hour TTL
            loggingService.info('🧠 Using cached LISP instructions', { queryHash });
            return cached.instructions;
        }

        loggingService.info('🧠 Generating new LISP instructions...', { userQuery });

        try {
            const model = config?.instructionGenerator?.model || DEFAULT_CORTEX_CONFIG.instructionGenerator.model;
            const fullPrompt = `${INSTRUCTION_GENERATOR_PROMPT}\n\n**User Query:** "${userQuery}"`;

            const response = await BedrockService.invokeModel(fullPrompt, model);
            
            let responseText = '';
            if (typeof response === 'string') {
                responseText = response;
            } else if (response.content && response.content[0] && response.content[0].text) {
                responseText = response.content[0].text;
            }

            // Clean the response to ensure it's valid JSON
            const jsonResponse = this.extractJson(responseText);
            const instructions = JSON.parse(jsonResponse) as LispInstructions;

            // 2. Cache the new instructions
            this.cache.set(queryHash, { queryHash, instructions, timestamp: new Date() });

            loggingService.info('✅ Successfully generated LISP instructions', { domain: instructions.domain });

            return instructions;

        } catch (error) {
            loggingService.error('❌ Failed to generate LISP instructions', {
                error: error instanceof Error ? error.message : String(error),
                userQuery
            });
            // Fallback to a generic set of instructions
            return this.getGenericInstructions();
        }
    }
    
    private extractJson(text: string): string {
        const match = text.match(/\{[\s\S]*\}/);
        return match ? match[0] : '{}';
    }

    private async hashQuery(query: string): Promise<string> {
        const data = new TextEncoder().encode(query);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    private getGenericInstructions(): LispInstructions {
        return {
            domain: 'general',
            confidence: 0.5,
            encoderPrompt: `You are a Cortex Encoder. Convert the user's query into a generic LISP structure. Example: (query: content_[user_query_here])`,
            coreProcessorPrompt: `You are a Cortex Core Processor. Answer the LISP query factually and concisely. Example: (answer: content_[your_answer_here])`,
            decoderPrompt: `You are a Cortex Decoder. Convert the LISP answer into natural, readable language.`
        };
    }
}
