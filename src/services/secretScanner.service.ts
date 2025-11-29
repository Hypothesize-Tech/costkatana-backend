import { loggingService } from './logging.service';
import * as crypto from 'crypto';

/**
 * Secret detection patterns based on truffleHog/GitLeaks
 */
interface SecretPattern {
    name: string;
    pattern: RegExp;
    severity: 'high' | 'medium' | 'low';
    description: string;
}

export interface SecretDetection {
    type: string;
    severity: 'high' | 'medium' | 'low';
    line: number;
    column: number;
    description: string;
    redacted: boolean;
}

export interface ScanResult {
    hasSecrets: boolean;
    detections: SecretDetection[];
    redactedContent: string;
    redactionCount: number;
}

export class SecretScannerService {
    private static readonly SECRET_PATTERNS: SecretPattern[] = [
        // AWS
        {
            name: 'AWS Access Key ID',
            pattern: /AKIA[0-9A-Z]{16}/gi,
            severity: 'high',
            description: 'AWS Access Key ID detected'
        },
        {
            name: 'AWS Secret Access Key',
            pattern: /aws_secret_access_key\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
            severity: 'high',
            description: 'AWS Secret Access Key detected'
        },
        // API Keys
        {
            name: 'Generic API Key',
            pattern: /(api[_-]?key|apikey)\s*[=:]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi,
            severity: 'high',
            description: 'API key detected'
        },
        {
            name: 'GitHub Token',
            pattern: /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}/gi,
            severity: 'high',
            description: 'GitHub personal access token detected'
        },
        // Passwords
        {
            name: 'Password',
            pattern: /(password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]{8,})['"]?/gi,
            severity: 'high',
            description: 'Password detected'
        },
        // Tokens
        {
            name: 'JWT Token',
            pattern: /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
            severity: 'high',
            description: 'JWT token detected'
        },
        {
            name: 'Bearer Token',
            pattern: /bearer\s+[A-Za-z0-9_\-]{20,}/gi,
            severity: 'high',
            description: 'Bearer token detected'
        },
        // Database
        {
            name: 'MongoDB Connection String',
            pattern: /mongodb\+srv?:\/\/[^\s'"]+/gi,
            severity: 'high',
            description: 'MongoDB connection string detected'
        },
        {
            name: 'PostgreSQL Connection String',
            pattern: /postgres(ql)?:\/\/[^\s'"]+/gi,
            severity: 'high',
            description: 'PostgreSQL connection string detected'
        },
        // OAuth
        {
            name: 'OAuth Client Secret',
            pattern: /(client[_-]?secret|oauth[_-]?secret)\s*[=:]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi,
            severity: 'high',
            description: 'OAuth client secret detected'
        },
        // Private Keys
        {
            name: 'Private Key',
            pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
            severity: 'high',
            description: 'Private key detected'
        },
        // Email (PII)
        {
            name: 'Email Address',
            pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            severity: 'low',
            description: 'Email address detected (PII)'
        },
        // Phone (PII)
        {
            name: 'Phone Number',
            pattern: /\b(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
            severity: 'low',
            description: 'Phone number detected (PII)'
        }
    ];

    /**
     * Scan content for secrets and PII
     */
    static scan(content: string, redact: boolean = true): ScanResult {
        const detections: SecretDetection[] = [];
        let redactionCount = 0;

        // Split content into lines for line number tracking
        const lines = content.split('\n');
        const redactedLines = [...lines];

        for (const pattern of this.SECRET_PATTERNS) {
            let match: RegExpExecArray | null;
            const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

            // Reset regex lastIndex for each pattern
            regex.lastIndex = 0;

            while ((match = regex.exec(content)) !== null) {
                const matchText = match[0];
                const lineNumber = content.substring(0, match.index).split('\n').length;
                const column = match.index - content.lastIndexOf('\n', match.index) - 1;

                detections.push({
                    type: pattern.name,
                    severity: pattern.severity,
                    line: lineNumber,
                    column: Math.max(0, column),
                    description: pattern.description,
                    redacted: false
                });

                // Redact if requested
                if (redact) {
                    const redactionMarker = this.getRedactionMarker(pattern.severity);
                    const lineIndex = lineNumber - 1;
                    redactedLines[lineIndex] = redactedLines[lineIndex].replace(matchText, redactionMarker);
                    redactionCount++;
                }
            }
        }

        const redactedContent = redactedLines.join('\n');

        return {
            hasSecrets: detections.length > 0,
            detections,
            redactedContent,
            redactionCount
        };
    }

    /**
     * Get redaction marker based on severity
     */
    private static getRedactionMarker(severity: 'high' | 'medium' | 'low'): string {
        switch (severity) {
            case 'high':
                return '[REDACTED: SECRET]';
            case 'medium':
                return '[REDACTED: SENSITIVE]';
            case 'low':
                return '[REDACTED: PII]';
            default:
                return '[REDACTED]';
        }
    }

    /**
     * Scan and redact secrets from code before indexing
     */
    static scanAndRedact(content: string, filePath: string): {
        content: string;
        hasSecrets: boolean;
        detectionCount: number;
        metadata: {
            redacted: boolean;
            detectionTypes: string[];
        };
    } {
        const result = this.scan(content, true);

        if (result.hasSecrets) {
            loggingService.warn('Secrets detected and redacted', {
                component: 'SecretScannerService',
                filePath,
                detectionCount: result.detections.length,
                types: result.detections.map(d => d.type),
                severity: result.detections.map(d => d.severity)
            });
        }

        return {
            content: result.redactedContent,
            hasSecrets: result.hasSecrets,
            detectionCount: result.detections.length,
            metadata: {
                redacted: result.hasSecrets,
                detectionTypes: result.detections.map(d => d.type)
            }
        };
    }

    /**
     * Check if file should be excluded from scanning (already excluded files)
     */
    static shouldExcludeFile(filePath: string): boolean {
        const excludePatterns = [
            /node_modules/,
            /\.git/,
            /dist/,
            /build/,
            /\.next/,
            /\.nuxt/,
            /\.cache/,
            /coverage/,
            /\.env\.example/,
            /\.env\.local/,
            /\.env\.test/
        ];

        return excludePatterns.some(pattern => pattern.test(filePath));
    }

    /**
     * Generate content hash for deduplication
     */
    static generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
}

