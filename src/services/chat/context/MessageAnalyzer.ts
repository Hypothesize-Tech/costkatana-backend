/**
 * Message Analyzer
 * Analyzes messages for intent, domain, and language framework detection
 */

import { MessageAnalysisResult, LanguageFramework } from './types/context.types';

export class MessageAnalyzer {
    /**
     * Analyze message to determine intent, domain, subject, and confidence
     */
    static analyzeMessage(message: string, recentMessages: any[]): MessageAnalysisResult {
        const lowerMessage = message.toLowerCase();
        
        // Detect intent
        const intent = this.detectIntent(lowerMessage);
        
        // Detect domain and subject
        const { domain, subject, confidence } = this.detectDomain(lowerMessage, recentMessages);

        return { subject, intent, domain, confidence };
    }

    /**
     * Detect user intent from message
     */
    private static detectIntent(lowerMessage: string): string {
        if (lowerMessage.includes('how to') || lowerMessage.includes('integrate') || lowerMessage.includes('install')) {
            return 'integration';
        } else if (lowerMessage.includes('example') || lowerMessage.includes('code')) {
            return 'example';
        } else if (lowerMessage.includes('error') || lowerMessage.includes('issue') || lowerMessage.includes('problem')) {
            return 'troubleshooting';
        }
        return 'general';
    }

    /**
     * Detect conversation domain and subject
     */
    private static detectDomain(lowerMessage: string, recentMessages: any[]): {
        domain: string;
        subject?: string;
        confidence: number;
    } {
        let domain = 'general';
        let subject: string | undefined;
        let confidence = 0.5;

        // CostKatana domain detection
        if (lowerMessage.includes('costkatana') || lowerMessage.includes('cost katana')) {
            domain = 'costkatana';
            confidence = 0.9;
            
            if (lowerMessage.includes('python') || lowerMessage.includes('pypi')) {
                subject = 'cost-katana';
            } else if (lowerMessage.includes('npm') || lowerMessage.includes('javascript') || lowerMessage.includes('typescript')) {
                subject = 'cost-katana';
            } else if (lowerMessage.includes('cli') || lowerMessage.includes('command')) {
                subject = 'cost-katana-cli';
            }
        }
        // Package domain detection
        else if (lowerMessage.includes('package') || lowerMessage.includes('npm') || lowerMessage.includes('pypi')) {
            domain = 'packages';
            confidence = 0.8;
        }
        // Billing domain detection
        else if (lowerMessage.includes('cost') || lowerMessage.includes('billing') || lowerMessage.includes('pricing')) {
            domain = 'billing';
            confidence = 0.7;
        }

        // Check for coreference (this, that, it, the package, etc.)
        const hasCoref = this.detectCoreference(lowerMessage);
        if (hasCoref && recentMessages.length > 0) {
            // Try to resolve from recent context
            const recentContext = recentMessages.slice(-3).map(m => m.content).join(' ');
            if (recentContext.includes('cost-katana') || recentContext.includes('python') || recentContext.includes('npm')) {
                subject = 'cost-katana';
            } else if (recentContext.includes('cost-katana-cli') || recentContext.includes('cli')) {
                subject = 'cost-katana-cli';
            }
            confidence = Math.max(confidence, 0.6);
        }

        return { domain, subject, confidence };
    }

    /**
     * Detect if message contains coreference patterns
     */
    private static detectCoreference(lowerMessage: string): boolean {
        const corefPatterns = [
            /this\s+(package|tool|service|model)/g,
            /that\s+(package|tool|service|model)/g,
            /the\s+(package|tool|service|model)/g,
            /\bit\b/g
        ];
        
        return corefPatterns.some(pattern => pattern.test(lowerMessage));
    }

    /**
     * Detect programming language or framework from message
     */
    static detectLanguageFramework(message: string): LanguageFramework {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('python') || lowerMessage.includes('pip') || lowerMessage.includes('pypi')) {
            return 'python';
        } else if (lowerMessage.includes('javascript') || lowerMessage.includes('typescript') || lowerMessage.includes('node') || lowerMessage.includes('npm')) {
            return 'javascript';
        } else if (lowerMessage.includes('react') || lowerMessage.includes('vue') || lowerMessage.includes('angular')) {
            return 'frontend';
        }
        
        return undefined;
    }
}
