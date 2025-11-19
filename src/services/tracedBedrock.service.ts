/**
 * TracedBedrock Service (Legacy Compatibility)
 * This file is kept for backward compatibility
 * All functionality now routes through TracedAIService which uses AIRouterService
 */

import { TracedAIService } from './tracedAI.service';

// Re-export BedrockService as TracedAIService for backward compatibility
export { BedrockService } from './tracedAI.service';

/**
 * @deprecated Use TracedAIService instead
 * This class is kept for backward compatibility only
 * All methods are inherited from TracedAIService
 */
export class TracedBedrockService extends TracedAIService {
    // All methods inherited from TracedAIService
    // No additional implementation needed
}
