/**
 * Autonomous Agent Detector
 * Detects if a user message requires autonomous/governed agent workflow
 */

import { loggingService } from '@services/logging.service';
import { BedrockService } from '@services/tracedBedrock.service';

export class AutonomousDetector {
    // Keywords that indicate autonomous request
    private static readonly AUTONOMOUS_KEYWORDS = [
        'create', 'build', 'deploy', 'develop', 'make', 'setup', 'implement',
        'generate', 'scaffold', 'initialize', 'configure', 'establish',
        'design', 'architect', 'construct', 'launch', 'ship', 'release',
        'write', 'code', 'program'
    ];

    // Keywords that indicate project-related requests
    private static readonly PROJECT_KEYWORDS = [
        'app', 'application', 'website', 'api', 'service', 'project',
        'system', 'platform', 'solution', 'software', 'tool', 'product',
        'todo', 'list', 'mern', 'react', 'node', 'fullstack', 'backend', 'frontend'
    ];

    // Patterns that indicate building something
    private static readonly BUILD_PATTERNS = [
        /build\s+(?:a|an|the)?\s*\w+/i,
        /create\s+(?:a|an|the)?\s*\w+/i,
        /make\s+(?:a|an|me|the)?\s*\w+/i,
        /develop\s+(?:a|an|the)?\s*\w+/i,
        /deploy\s+(?:a|an|the|my)?\s*\w+/i,
        /i\s+(?:want|need)\s+(?:to\s+)?(?:build|create|make)/i,
        /(?:can|could)\s+you\s+(?:build|create|make)/i
    ];

    /**
     * Detect if a message requires autonomous agent workflow
     */
    static async detect(message: string): Promise<boolean> {
        try {
            const messageLower = message.toLowerCase();

            // 1. Check for autonomous keywords
            const hasAutonomousKeyword = this.hasAutonomousKeyword(messageLower);
            if (hasAutonomousKeyword) {
                loggingService.info('🤖 Autonomous request detected via keywords', {
                    message: message.substring(0, 100),
                    hasAutonomousKeyword,
                    hasProjectKeyword: this.hasProjectKeyword(messageLower)
                });
                return true;
            }

            // 2. Check for specific build patterns
            const matchesPattern = this.matchesBuildPattern(message);
            if (matchesPattern) {
                loggingService.info('🤖 Autonomous request detected via pattern', {
                    message: message.substring(0, 100)
                });
                return true;
            }

            // 3. For edge cases, use AI for more sophisticated detection
            const aiDetected = await this.detectWithAI(message);
            
            loggingService.info('🤖 Autonomous request detection result', {
                message: message.substring(0, 100),
                detected: aiDetected,
                method: 'AI'
            });

            return aiDetected;

        } catch (error) {
            loggingService.error('Failed to detect autonomous request', {
                error: error instanceof Error ? error.message : String(error),
                message
            });
            return false;
        }
    }

    /**
     * Check if message has autonomous keywords
     */
    private static hasAutonomousKeyword(messageLower: string): boolean {
        return this.AUTONOMOUS_KEYWORDS.some(keyword => 
            messageLower.includes(keyword)
        );
    }

    /**
     * Check if message has project keywords
     */
    private static hasProjectKeyword(messageLower: string): boolean {
        return this.PROJECT_KEYWORDS.some(keyword => 
            messageLower.includes(keyword)
        );
    }

    /**
     * Check if message matches build patterns
     */
    private static matchesBuildPattern(message: string): boolean {
        return this.BUILD_PATTERNS.some(pattern => pattern.test(message));
    }

    /**
     * Use AI to detect autonomous intent for edge cases
     */
    private static async detectWithAI(message: string): Promise<boolean> {
        const prompt = `Analyze if this message requires an autonomous agent workflow (creating projects, deploying code, building applications, etc.):
        
Message: "${message}"

Respond with ONLY "true" or "false".`;

        const response = await BedrockService.invokeModel(
            prompt,
            'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            { recentMessages: [{ role: 'user', content: prompt }] }
        );

        return response.trim().toLowerCase() === 'true';
    }
}
