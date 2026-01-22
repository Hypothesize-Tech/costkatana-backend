/**
 * TokenEstimator
 * Global utility for token estimation across all controllers and services
 * Eliminates Math.ceil(length/4) duplication found in 125+ files
 */
export class TokenEstimator {
    
    /**
     * Standard token estimation ratio
     * Approximately 4 characters per token for English text
     */
    private static readonly CHARS_PER_TOKEN = 4;

    /**
     * Estimate tokens from text length
     * Standard method using 4 characters per token ratio
     * 
     * @param text - Text content or text length
     * @returns Estimated token count
     */
    static estimate(text: string | number): number {
        const length = typeof text === 'string' ? text.length : text;
        return Math.ceil(length / this.CHARS_PER_TOKEN);
    }

    /**
     * Estimate total tokens for a conversation
     * Combines input and output token estimates
     * 
     * @param inputText - Input message text
     * @param outputTokens - Expected output tokens (default: 1000)
     * @returns Total estimated tokens
     */
    static estimateTotal(inputText: string | number, outputTokens: number = 1000): number {
        return this.estimate(inputText) + outputTokens;
    }

    /**
     * Estimate tokens from multiple messages
     * Useful for conversation history
     * 
     * @param messages - Array of message strings
     * @returns Total estimated tokens
     */
    static estimateMultiple(messages: string[]): number {
        return messages.reduce((total, msg) => total + this.estimate(msg), 0);
    }

    /**
     * Estimate tokens from message array with roles
     * Takes into account message structure overhead
     * 
     * @param messages - Array of messages with role and content
     * @returns Total estimated tokens
     */
    static estimateConversation(messages: Array<{ role: string; content: string }>): number {
        // Add 4 tokens per message for structure overhead (role, formatting, etc.)
        const messageOverhead = messages.length * 4;
        const contentTokens = messages.reduce((total, msg) => 
            total + this.estimate(msg.content), 0
        );
        
        return contentTokens + messageOverhead;
    }

    /**
     * Check if text exceeds token limit
     * 
     * @param text - Text to check
     * @param limit - Token limit
     * @returns True if exceeds limit
     */
    static exceedsLimit(text: string | number, limit: number): boolean {
        return this.estimate(text) > limit;
    }

    /**
     * Truncate text to fit within token limit
     * Adds ellipsis if truncated
     * 
     * @param text - Text to truncate
     * @param tokenLimit - Maximum tokens allowed
     * @returns Truncated text
     */
    static truncateToLimit(text: string, tokenLimit: number): string {
        const estimatedTokens = this.estimate(text);
        
        if (estimatedTokens <= tokenLimit) {
            return text;
        }
        
        // Calculate characters to keep
        const maxChars = tokenLimit * this.CHARS_PER_TOKEN;
        const ellipsis = '...';
        
        if (maxChars <= ellipsis.length) {
            return ellipsis;
        }
        
        return text.substring(0, maxChars - ellipsis.length) + ellipsis;
    }

    /**
     * Get characters per token ratio
     * Useful for custom calculations
     */
    static get charsPerToken(): number {
        return this.CHARS_PER_TOKEN;
    }
}
