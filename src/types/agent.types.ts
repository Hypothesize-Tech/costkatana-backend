export interface AgentQuery {
  userId: string;
  query: string;
  context?: {
    projectId?: string;
    conversationId?: string;
    previousMessages?: Array<{ role: string; content: string }>;
    isProjectWizard?: boolean;
    projectType?: string;
    wizardState?: any;
    previousResponses?: any;
    knowledgeBaseContext?: string;
    systemCapabilities?: string[];
    availableAgentTypes?: string[];
    useMultiAgent?: boolean;
    [key: string]: any;
  };
  callbacks?: any[];
}

export interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    sources?: string[];
    executionTime?: number;
    errorType?: string;
    knowledgeEnhanced?: boolean;
    knowledgeContextLength?: number;
    fromCache?: boolean;
    langchainEnhanced?: boolean;
    webSearchUsed?: boolean;
    coordinated?: boolean;
    participatingAgents?: string[];
    workflowType?: string;
    totalAgents?: number;
    successfulAgents?: number;
    fallbackUsed?: boolean;
    /** Hierarchical / coordination-specific metadata */
    coordinator?: boolean;
    childBranches?: number;
    executionStrategy?: 'parallel' | 'sequential';
    error?: boolean;
    hierarchicalExecution?: boolean;
    branchesExecuted?: number;
    totalBranches?: number;
    hierarchicalFailure?: boolean;
    aiWebSearchDecision?: {
      required: boolean;
      reason: string;
    };
  };
  usage?: { tokens: number; cost: number };
  thinking?: {
    title: string;
    steps: Array<{
      step: number;
      description: string;
      reasoning: string;
      outcome?: string;
    }>;
    summary?: string;
  };
}
