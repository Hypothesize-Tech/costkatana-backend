import { UserRole } from './models';

declare global {
    namespace Express {
        interface UserPayload {
            id: string;
            email: string;
            role: UserRole;
        }
        interface Request {
            user?: UserPayload;
            userId?: string;
            gatewayContext?: {
                startTime: number;
                requestId?: string;
                targetUrl?: string;
                projectId?: string;
                authMethodOverride?: "standard" | "gateway";
                cacheEnabled?: boolean;
                retryEnabled?: boolean;
                cacheUserScope?: boolean;
                cacheTTL?: number;
                cacheBucketMaxSize?: number;
                retryCount?: number;
                retryFactor?: number;
                retryMinTimeout?: number;
                retryMaxTimeout?: number;
                userId?: string;
                provider?: string;
                budgetId?: string;
                modelOverride?: string;
                stream?: boolean;
                // New cache-related properties
                semanticCacheEnabled?: boolean;
                deduplicationEnabled?: boolean;
                similarityThreshold?: number;
                inputTokens?: number;
                outputTokens?: number;
                cost?: number;
                isFailoverRequest?: boolean;
                // CPI system properties
                availableProviders?: string[];
                selectedModel?: string;
                routingDecision?: any;

                // 🚀 CORTEX PROCESSING PROPERTIES
                cortexEnabled?: boolean;
                cortexCoreModel?: string;
                cortexEncodingModel?: string;
                cortexDecodingModel?: string;
                cortexOperation?: 'optimize' | 'compress' | 'analyze' | 'transform' | 'sast';
                cortexOutputStyle?: 'formal' | 'casual' | 'technical' | 'conversational';
                cortexOutputFormat?: 'plain' | 'markdown' | 'structured';
                cortexPreserveSemantics?: boolean;
                cortexSemanticCache?: boolean;
                cortexPriority?: 'cost' | 'speed' | 'quality' | 'balanced';
                cortexBinaryEnabled?: boolean;
                cortexBinaryCompression?: 'basic' | 'standard' | 'aggressive';
                cortexSchemaValidation?: boolean;
                cortexStrictValidation?: boolean;
                cortexControlFlowEnabled?: boolean;
                cortexHybridExecution?: boolean;
                cortexFragmentCache?: boolean;
                cortexContextManagement?: boolean;
                cortexSessionId?: string;
                cortexContextCompression?: boolean;
                cortexMetadata?: any;
            };
        }
    }
}