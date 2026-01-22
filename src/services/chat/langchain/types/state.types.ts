/**
 * Langchain Multi-Agent State Type Definitions
 */

import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

// Enhanced Langchain Multi-Agent State Management
export const LangchainChatState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
    }),
    currentAgent: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => 'coordinator',
    }),
    userId: Annotation<string>(),
    userMessage: Annotation<string>(),
    userIntent: Annotation<string>(),
    contextData: Annotation<Record<string, any>>(),
    integrationContext: Annotation<{
        aws?: any;
        google?: any;
        github?: any;
        vercel?: any;
        mongodb?: any;
    }>(),
    strategyFormation: Annotation<{
        questions: string[];
        responses: Record<string, any>;
        currentQuestion: number;
        isComplete: boolean;
        adaptiveQuestions?: string[];
    }>(),
    autonomousDecisions: Annotation<string[]>({
        reducer: (x, y) => [...(x || []), ...(y || [])],
        default: () => [],
    }),
    userInputCollection: Annotation<{
        active: boolean;
        currentField?: any;
        collectedData: Record<string, any>;
        progress: number;
    }>(),
    taskPriority: Annotation<number>({
        reducer: (x, y) => y ?? x,
        default: () => 1,
    }),
    conversationDepth: Annotation<number>({
        reducer: (x, y) => y ?? x,
        default: () => 0,
    }),
    proactiveInsights: Annotation<string[]>({
        reducer: (x, y) => [...(x || []), ...(y || [])],
        default: () => [],
    }),
    worldClassFeatures: Annotation<{
        emotionalIntelligence: boolean;
        contextualMemory: boolean;
        predictiveAnalytics: boolean;
        crossModalUnderstanding: boolean;
    }>({
        reducer: (x, y) => y ?? x,
        default: () => ({
            emotionalIntelligence: true,
            contextualMemory: true,
            predictiveAnalytics: true,
            crossModalUnderstanding: true,
        }),
    }),
});

export type LangchainChatStateType = typeof LangchainChatState.State;
