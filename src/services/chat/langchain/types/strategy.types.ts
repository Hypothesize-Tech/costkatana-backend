/**
 * Dynamic User Input Strategy Types
 */

// Dynamic User Input Strategy Interface
export interface DynamicInputStrategy {
    collectUserInput: boolean;
    questionFlow: string[];
    adaptiveQuestioning: boolean;
    maxInteractions: number;
    strategyFormation: boolean;
    personalizedApproach: boolean;
}

// Session types for user input collection
export interface UserInputSession {
    state: any;
    questionIndex: number;
    timestamp: Date;
}

export interface StrategyFormationSession {
    state: any;
    responses: Record<string, any>;
    timestamp: Date;
}

// Option type for IntegrationSelector
export interface SelectionOption {
    id: string;
    label: string;
    value: string;
    description?: string;
    icon?: string;
}
