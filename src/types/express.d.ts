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
            };
        }
    }
}