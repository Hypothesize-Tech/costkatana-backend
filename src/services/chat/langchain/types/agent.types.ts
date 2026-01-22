/**
 * Langchain Agent Configuration Types
 */

import { Tool } from '@langchain/core/tools';

// Enhanced Agent Configuration Interface
export interface LangchainAgentConfig {
    name: string;
    type: 'coordinator' | 'specialist' | 'integration' | 'autonomous' | 'strategy';
    model: 'claude' | 'gpt4' | 'bedrock';
    specialization: string;
    tools: Tool[];
    systemPrompt: string;
    autonomyLevel: 'low' | 'medium' | 'high' | 'full';
}

// Agent executor interface
export interface LangchainAgent {
    name: string;
    model: any;
    config: LangchainAgentConfig;
    invoke: (messages: any[]) => Promise<any>;
}
