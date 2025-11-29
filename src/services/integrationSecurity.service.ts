import { CodeVerificationService, CodeToVerify } from './codeVerification.service';
import { loggingService } from './logging.service';

export interface SecurityCheckResult {
    passed: boolean;
    linterPassed: boolean;
    typeCheckPassed: boolean;
    testsPassed: boolean;
    securityScanPassed: boolean;
    requiresApproval: boolean;
    sensitiveFiles: string[];
}

/**
 * Integration security service
 * Runs security checks before offering code changes
 */
export class IntegrationSecurityService {
    private static readonly SENSITIVE_FILE_PATTERNS = [
        /auth/i,
        /security/i,
        /password/i,
        /token/i,
        /key/i,
        /credential/i,
        /secret/i,
        /infrastructure/i,
        /infra/i,
        /deploy/i,
        /config\/.*\.env/i
    ];

    /**
     * Run security checks on generated code
     */
    static async checkSecurity(
        codeFiles: CodeToVerify[],
        riskLevel: 'low' | 'medium' | 'high'
    ): Promise<SecurityCheckResult> {
        const result: SecurityCheckResult = {
            passed: true,
            linterPassed: true,
            typeCheckPassed: true,
            testsPassed: true,
            securityScanPassed: true,
            requiresApproval: false,
            sensitiveFiles: []
        };

        // Check for sensitive files
        for (const file of codeFiles) {
            const isSensitive = this.SENSITIVE_FILE_PATTERNS.some(pattern =>
                pattern.test(file.filePath)
            );

            if (isSensitive) {
                result.sensitiveFiles.push(file.filePath);
                result.requiresApproval = true;
            }
        }

        // Run verification (linter, type check, tests)
        try {
            const verification = await CodeVerificationService.verifyCode(codeFiles, {
                runTests: true,
                runLinter: true,
                runTypeCheck: true
            });

            result.linterPassed = verification.lintResults?.passed ?? true;
            result.typeCheckPassed = verification.typeCheckResults?.passed ?? true;
            result.testsPassed = verification.testResults?.passed ?? true;

            if (!verification.passed) {
                result.passed = false;
            }
        } catch (error) {
            loggingService.warn('Security verification failed', {
                component: 'IntegrationSecurityService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            result.passed = false;
        }

        // High risk always requires approval
        if (riskLevel === 'high') {
            result.requiresApproval = true;
        }

        // Large changes require approval
        const totalLOC = codeFiles.reduce((sum, file) => 
            sum + file.content.split('\n').length, 0
        );
        if (totalLOC > 200) {
            result.requiresApproval = true;
        }

        loggingService.info('Security check completed', {
            component: 'IntegrationSecurityService',
            passed: result.passed,
            requiresApproval: result.requiresApproval,
            sensitiveFilesCount: result.sensitiveFiles.length
        });

        return result;
    }

    /**
     * Check if file is sensitive
     */
    static isSensitiveFile(filePath: string): boolean {
        return this.SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(filePath));
    }

    /**
     * Emergency kill-switch check
     */
    static async checkKillSwitch(
        userId: string,
        organizationId?: string
    ): Promise<boolean> {
        // In production, would check database for kill-switch status
        // For now, always return false (kill-switch not active)
        return false;
    }
}

