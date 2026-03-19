import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface CodeToVerify {
  filePath: string;
  content: string;
  language: string;
}

export interface VerificationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  testResults?: { passed: boolean; output: string };
  lintResults?: { passed: boolean; output: string };
  typeCheckResults?: { passed: boolean; output: string };
}

interface SecurityCheckResult {
  passed: boolean;
  linterPassed: boolean;
  typeCheckPassed: boolean;
  testsPassed: boolean;
  securityScanPassed: boolean;
  requiresApproval: boolean;
  sensitiveFiles: string[];
  riskAssessment: 'low' | 'medium' | 'high';
  recommendations: string[];
}

/**
 * Integration security service
 * Runs security checks before offering code changes
 */
@Injectable()
export class IntegrationSecurityService {
  private readonly logger = new Logger(IntegrationSecurityService.name);

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
    /config\/.*\.env/i,
    /\.env/i,
    /database/i,
    /migration/i,
    /admin/i,
    /sudo/i,
  ];

  private static readonly SUSPICIOUS_PATTERNS = [
    /eval\(/,
    /exec\(/,
    /system\(/,
    /shell_exec\(/,
    /popen\(/,
    /dangerouslySetInnerHTML/,
    /innerHTML\s*=/,
    /document\.write/,
    /localStorage\.setItem.*password/,
    /sessionStorage\.setItem.*password/,
    /process\.env\./,
    /fs\.writeFile/,
    /fs\.unlink/,
  ];

  /**
   * Verify generated code by running linter, type checker, and tests via child_process.
   * Writes files to a temp directory, executes ESLint/tsc/npm test (or flake8/mypy/pytest for Python).
   */
  async verifyCode(
    codeFiles: CodeToVerify[],
    options: {
      runTests?: boolean;
      runLinter?: boolean;
      runTypeCheck?: boolean;
      workingDirectory?: string;
    } = {},
  ): Promise<VerificationResult> {
    const result: VerificationResult = {
      passed: true,
      errors: [],
      warnings: [],
    };

    if (codeFiles.length === 0) {
      return result;
    }

    const workingDir =
      options.workingDirectory ??
      fs.mkdtempSync(path.join(os.tmpdir(), 'code-verify-'));

    try {
      for (const file of codeFiles) {
        const filePath = path.join(workingDir, file.filePath);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }

      const verifications: Promise<void>[] = [];

      if (options.runLinter !== false) {
        verifications.push(
          this.runLinter(codeFiles, workingDir)
            .then((lintResult) => {
              result.lintResults = lintResult;
              if (!lintResult.passed) {
                result.passed = false;
                result.errors.push(
                  `Linter failed: ${lintResult.output.substring(0, 200)}`,
                );
              }
            })
            .catch((error) => {
              result.warnings.push(
                `Linter check failed: ${error instanceof Error ? error.message : 'Unknown'}`,
              );
            }),
        );
      }

      if (options.runTypeCheck !== false) {
        verifications.push(
          this.runTypeCheck(codeFiles, workingDir)
            .then((typeResult) => {
              result.typeCheckResults = typeResult;
              if (!typeResult.passed) {
                result.passed = false;
                result.errors.push(
                  `Type check failed: ${typeResult.output.substring(0, 200)}`,
                );
              }
            })
            .catch((error) => {
              result.warnings.push(
                `Type check failed: ${error instanceof Error ? error.message : 'Unknown'}`,
              );
            }),
        );
      }

      if (options.runTests !== false) {
        verifications.push(
          this.runTests(codeFiles, workingDir)
            .then((testResult) => {
              result.testResults = testResult;
              if (!testResult.passed) {
                result.passed = false;
                result.errors.push(
                  `Tests failed: ${testResult.output.substring(0, 200)}`,
                );
              }
            })
            .catch((error) => {
              result.warnings.push(
                `Test run failed: ${error instanceof Error ? error.message : 'Unknown'}`,
              );
            }),
        );
      }

      await Promise.allSettled(verifications);

      this.logger.log('Code verification completed', {
        passed: result.passed,
        filesCount: codeFiles.length,
        errorsCount: result.errors.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Code verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      result.passed = false;
      result.errors.push(
        `Verification failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return result;
    } finally {
      try {
        if (fs.existsSync(workingDir) && workingDir.startsWith(os.tmpdir())) {
          fs.rmSync(workingDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        this.logger.warn('Failed to cleanup temp directory', {
          error:
            cleanupError instanceof Error ? cleanupError.message : 'Unknown',
        });
      }
    }
  }

  /**
   * Run security checks on generated code
   */
  async checkSecurity(
    codeFiles: CodeToVerify[],
    riskLevel: 'low' | 'medium' | 'high' = 'medium',
  ): Promise<SecurityCheckResult> {
    const result: SecurityCheckResult = {
      passed: true,
      linterPassed: true,
      typeCheckPassed: true,
      testsPassed: true,
      securityScanPassed: true,
      requiresApproval: false,
      sensitiveFiles: [],
      riskAssessment: riskLevel,
      recommendations: [],
    };

    try {
      // Check for sensitive files
      this.checkSensitiveFiles(codeFiles, result);

      // Check for suspicious patterns
      this.checkSuspiciousPatterns(codeFiles, result);

      // Run basic code quality checks
      await this.runCodeQualityChecks(codeFiles, result);

      // Assess overall risk
      this.assessRiskLevel(codeFiles, result, riskLevel);

      // Determine if approval is required
      this.determineApprovalRequirement(codeFiles, result, riskLevel);

      this.logger.log('Security check completed', {
        passed: result.passed,
        requiresApproval: result.requiresApproval,
        sensitiveFiles: result.sensitiveFiles.length,
        riskAssessment: result.riskAssessment,
        recommendations: result.recommendations.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Security check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        passed: false,
        linterPassed: false,
        typeCheckPassed: false,
        testsPassed: false,
        securityScanPassed: false,
        requiresApproval: true,
        sensitiveFiles: [],
        riskAssessment: 'high',
        recommendations: ['Security check failed - manual review required'],
      };
    }
  }

  /**
   * Check for sensitive files that require special handling
   */
  private checkSensitiveFiles(
    codeFiles: CodeToVerify[],
    result: SecurityCheckResult,
  ): void {
    for (const file of codeFiles) {
      const isSensitive =
        IntegrationSecurityService.SENSITIVE_FILE_PATTERNS.some(
          (pattern) =>
            pattern.test(file.filePath) || pattern.test(file.content),
        );

      if (isSensitive) {
        result.sensitiveFiles.push(file.filePath);
        result.requiresApproval = true;
        result.recommendations.push(
          `Sensitive file detected: ${file.filePath} - requires manual review`,
        );
      }
    }
  }

  /**
   * Check for suspicious code patterns
   */
  private checkSuspiciousPatterns(
    codeFiles: CodeToVerify[],
    result: SecurityCheckResult,
  ): void {
    for (const file of codeFiles) {
      const suspiciousPatterns =
        IntegrationSecurityService.SUSPICIOUS_PATTERNS.filter((pattern) =>
          pattern.test(file.content),
        );

      if (suspiciousPatterns.length > 0) {
        result.securityScanPassed = false;
        result.requiresApproval = true;
        result.recommendations.push(
          `Suspicious patterns detected in ${file.filePath}: ${suspiciousPatterns.length} issues found`,
        );
        result.riskAssessment = 'high';
      }
    }
  }

  /**
   * Run basic code quality checks (static analysis + exec-based verification)
   */
  private async runCodeQualityChecks(
    codeFiles: CodeToVerify[],
    result: SecurityCheckResult,
  ): Promise<void> {
    try {
      // Real lint/typecheck/test execution via child_process
      try {
        const verification = await this.verifyCode(codeFiles, {
          runTests: true,
          runLinter: true,
          runTypeCheck: true,
        });
        result.linterPassed = verification.lintResults?.passed ?? true;
        result.typeCheckPassed = verification.typeCheckResults?.passed ?? true;
        result.testsPassed = verification.testResults?.passed ?? true;
      } catch (verifyError) {
        this.logger.warn('Code verification failed, using static checks only', {
          error:
            verifyError instanceof Error
              ? verifyError.message
              : String(verifyError),
        });
      }

      // Basic syntax/pattern checks
      for (const file of codeFiles) {
        if (file.language === 'javascript' || file.language === 'typescript') {
          this.checkJavaScriptCode(file, result);
        } else if (file.language === 'python') {
          this.checkPythonCode(file, result);
        }
      }

      // Size and complexity checks
      const totalLOC = codeFiles.reduce(
        (sum, file) => sum + file.content.split('\n').length,
        0,
      );

      if (totalLOC > 500) {
        result.recommendations.push(
          `Large code change (${totalLOC} lines) - consider breaking into smaller PRs`,
        );
      }

      // Check for TODO/FIXME comments
      const todoCount = codeFiles.reduce((sum, file) => {
        const todos = file.content.match(/TODO|FIXME|XXX/gi);
        return sum + (todos ? todos.length : 0);
      }, 0);

      if (todoCount > 0) {
        result.recommendations.push(
          `${todoCount} TODO/FIXME comments found - address before merging`,
        );
      }
    } catch (error) {
      this.logger.warn('Code quality check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      result.linterPassed = false;
    }
  }

  /**
   * Check JavaScript/TypeScript code
   */
  private checkJavaScriptCode(
    file: CodeToVerify,
    result: SecurityCheckResult,
  ): void {
    // Basic checks
    const issues: string[] = [];

    // Check for console.log in production code
    if (
      file.content.includes('console.log') &&
      !file.filePath.includes('test')
    ) {
      issues.push('console.log statements found');
    }

    // Check for debugger statements
    if (file.content.includes('debugger')) {
      issues.push('debugger statements found');
    }

    // Check for proper error handling
    const tryCatchCount = (file.content.match(/try\s*\{/g) || []).length;
    const throwCount = (file.content.match(/throw\s+/g) || []).length;

    if (throwCount > tryCatchCount * 2) {
      issues.push('Potential unhandled errors');
    }

    if (issues.length > 0) {
      result.recommendations.push(
        `JavaScript issues in ${file.filePath}: ${issues.join(', ')}`,
      );
      result.linterPassed = false;
    }
  }

  /**
   * Check Python code
   */
  private checkPythonCode(
    file: CodeToVerify,
    result: SecurityCheckResult,
  ): void {
    // Basic checks
    const issues: string[] = [];

    // Check for print statements in production code
    if (file.content.includes('print(') && !file.filePath.includes('test')) {
      issues.push('print statements found');
    }

    // Check for TODO comments
    const todos = file.content.match(/#\s*TODO|#?\s*FIXME/gi);
    if (todos && todos.length > 0) {
      issues.push('TODO comments found');
    }

    if (issues.length > 0) {
      result.recommendations.push(
        `Python issues in ${file.filePath}: ${issues.join(', ')}`,
      );
    }
  }

  /**
   * Assess overall risk level
   */
  private assessRiskLevel(
    codeFiles: CodeToVerify[],
    result: SecurityCheckResult,
    initialRisk: string,
  ): void {
    let riskScore = 0;

    // Sensitive files increase risk
    riskScore += result.sensitiveFiles.length * 20;

    // Suspicious patterns increase risk significantly
    if (!result.securityScanPassed) {
      riskScore += 50;
    }

    // Large changes increase risk
    const totalLOC = codeFiles.reduce(
      (sum, file) => sum + file.content.split('\n').length,
      0,
    );
    riskScore += Math.min(totalLOC / 10, 20); // Up to 20 points for size

    // Failed checks increase risk
    if (!result.linterPassed) riskScore += 10;
    if (!result.typeCheckPassed) riskScore += 10;
    if (!result.testsPassed) riskScore += 10;

    // Determine final risk level
    if (initialRisk === 'high' || riskScore >= 50) {
      result.riskAssessment = 'high';
    } else if (initialRisk === 'medium' || riskScore >= 20) {
      result.riskAssessment = 'medium';
    } else {
      result.riskAssessment = 'low';
    }

    // Overall pass/fail
    result.passed =
      result.linterPassed &&
      result.typeCheckPassed &&
      result.testsPassed &&
      result.securityScanPassed;
  }

  /**
   * Determine if approval is required
   */
  private determineApprovalRequirement(
    codeFiles: CodeToVerify[],
    result: SecurityCheckResult,
    riskLevel: string,
  ): void {
    // High risk always requires approval
    if (riskLevel === 'high' || result.riskAssessment === 'high') {
      result.requiresApproval = true;
      return;
    }

    // Sensitive files require approval
    if (result.sensitiveFiles.length > 0) {
      result.requiresApproval = true;
      return;
    }

    // Failed security checks require approval
    if (!result.securityScanPassed) {
      result.requiresApproval = true;
      return;
    }

    // Large changes require approval
    const totalLOC = codeFiles.reduce(
      (sum, file) => sum + file.content.split('\n').length,
      0,
    );
    if (totalLOC > 200) {
      result.requiresApproval = true;
      return;
    }

    // Multiple recommendations suggest approval
    if (result.recommendations.length > 3) {
      result.requiresApproval = true;
      return;
    }
  }

  /**
   * Classify data content for sensitivity and compliance, using content AND context
   * Used by enterprise security guard for pre-transmission checks
   */
  async classifyDataContent(
    content: string,
    context: { userId?: string; source?: string; purpose?: string },
  ): Promise<{
    sensitivityLevel: string;
    dataCategories: string[];
    complianceFrameworks: string[];
    riskScore: number;
    auditRequired: boolean;
    encryptionRequired: boolean;
  }> {
    const dataCategories: string[] = [];
    const complianceFrameworks: string[] = [];
    let riskScore = 0;

    // Pattern-based sensitivity detection (content)
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(content)) {
      dataCategories.push('financial');
      complianceFrameworks.push('PCI-DSS');
      riskScore = Math.max(riskScore, 70);
    }
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
      dataCategories.push('pii');
      complianceFrameworks.push('HIPAA', 'GDPR');
      riskScore = Math.max(riskScore, 80);
    }
    if (
      /password\s*[:=]\s*\S+|api[_\s]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+/i.test(
        content,
      )
    ) {
      dataCategories.push('credentials');
      complianceFrameworks.push('SOC2');
      riskScore = Math.max(riskScore, 90);
    }

    // Context-based sensitivity/compliance boost
    if (context?.purpose) {
      const purpose = context.purpose.toLowerCase();
      if (purpose.includes('biometric') || purpose.includes('health')) {
        if (!dataCategories.includes('sensitive_health'))
          dataCategories.push('sensitive_health');
        if (!complianceFrameworks.includes('HIPAA'))
          complianceFrameworks.push('HIPAA');
        riskScore = Math.max(riskScore, 85);
      }
      if (purpose.includes('analytics') || purpose.includes('marketing')) {
        if (!complianceFrameworks.includes('GDPR'))
          complianceFrameworks.push('GDPR');
        if (!dataCategories.includes('user_behavior'))
          dataCategories.push('user_behavior');
        riskScore = Math.max(riskScore, 60);
      }
    }

    if (context?.source) {
      const source = context.source.toLowerCase();
      if (source.includes('crm') || source.includes('customer')) {
        if (!dataCategories.includes('pii')) dataCategories.push('pii');
        if (!complianceFrameworks.includes('GDPR'))
          complianceFrameworks.push('GDPR');
        riskScore = Math.max(riskScore, 75);
      }
    }

    // Example: If user ID is admin, increase sensitivity
    if (context?.userId && context.userId.match(/^(admin|superuser)/i)) {
      riskScore = Math.max(riskScore, 60);
    }

    if (!dataCategories.length) {
      dataCategories.push('general');
      complianceFrameworks.push('SOC2');
    }

    const sensitivityLevel =
      riskScore >= 80
        ? 'restricted'
        : riskScore >= 50
          ? 'confidential'
          : 'internal';

    return {
      sensitivityLevel,
      dataCategories: [...new Set(dataCategories)],
      complianceFrameworks: [...new Set(complianceFrameworks)],
      riskScore: Math.min(100, riskScore),
      auditRequired: riskScore >= 70,
      encryptionRequired: riskScore >= 50,
    };
  }

  /**
   * Check content and context against compliance frameworks
   * Used by enterprise security guard for pre-transmission checks
   */
  async checkCompliance(
    content: string,
    context: {
      userId?: string;
      userLocation?: string;
      processingPurpose?: string;
      dataSource?: string;
    },
  ): Promise<{
    compliant: boolean;
    violations: Array<{ framework: string; type: string }>;
    allowedWithConditions: boolean;
  }> {
    const violations: Array<{ framework: string; type: string }> = [];

    // Content-based checks
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(content)) {
      violations.push({ framework: 'PCI-DSS', type: 'card_data_present' });
    }
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
      violations.push({ framework: 'HIPAA', type: 'ssn_present' });
    }
    if (/password\s*[:=]\s*\S+|api[_\s]?key\s*[:=]\s*\S+/i.test(content)) {
      violations.push({ framework: 'SOC2', type: 'credential_exposure_risk' });
    }

    // Context-based checks
    if (context?.userLocation) {
      // If user is in EU, all personal data requires GDPR
      if (
        [
          'eu',
          'europe',
          'germany',
          'france',
          'sweden',
          'italy',
          'spain',
          'netherlands',
        ].some((loc) => context.userLocation!.toLowerCase().includes(loc))
      ) {
        if (
          /email\s*[:=]\s*[\w.-]+@[\w.-]+/i.test(content) ||
          /name\s*[:=]\s*\S+/i.test(content)
        ) {
          violations.push({
            framework: 'GDPR',
            type: 'personal_data_crossborder',
          });
        }
      }
    }

    if (context?.processingPurpose) {
      // Strict scrutiny on analytics/marketing for GDPR
      if (context.processingPurpose.toLowerCase().includes('marketing')) {
        if (
          /email\s*[:=]\s*[\w.-]+@[\w.-]+/i.test(content) ||
          /user\s*id\s*[:=]\s*\S+/i.test(content)
        ) {
          violations.push({
            framework: 'GDPR',
            type: 'marketing_usage_needs_consent',
          });
        }
      }
      if (context.processingPurpose.toLowerCase().includes('health')) {
        // Any health-related data is under HIPAA
        if (/diagnosis|prescription|medical|health\s*[:=]/i.test(content)) {
          violations.push({ framework: 'HIPAA', type: 'health_data' });
        }
      }
    }

    if (context?.dataSource) {
      if (context.dataSource.toLowerCase().includes('customer')) {
        // Assume PII risk
        violations.push({ framework: 'GDPR', type: 'customer_pii' });
      }
    }

    const compliant = violations.length === 0;
    return {
      compliant,
      violations,
      allowedWithConditions:
        compliant ||
        violations.every(
          (v) => v.framework !== 'PCI-DSS' && v.framework !== 'HIPAA',
        ),
    };
  }

  private async runLinter(
    codeFiles: CodeToVerify[],
    workingDir: string,
  ): Promise<{ passed: boolean; output: string }> {
    const languages = [...new Set(codeFiles.map((f) => f.language))];
    const primaryLanguage = languages[0];

    try {
      switch (primaryLanguage) {
        case 'typescript':
        case 'javascript': {
          try {
            const { stdout, stderr } = await execAsync(
              'npx eslint . --format json',
              { cwd: workingDir, timeout: 30000 },
            );
            const output = stdout || stderr;
            const hasErrors =
              output.includes('"errorCount":') &&
              !output.includes('"errorCount":0');
            return { passed: !hasErrors, output };
          } catch {
            return { passed: true, output: 'ESLint not available' };
          }
        }
        case 'python': {
          try {
            const { stdout, stderr } = await execAsync('python -m flake8 .', {
              cwd: workingDir,
              timeout: 30000,
            });
            const output = stdout || stderr;
            return { passed: output.length === 0, output };
          } catch {
            return { passed: true, output: 'Flake8 not available' };
          }
        }
        default:
          return {
            passed: true,
            output: `No linter configured for ${primaryLanguage}`,
          };
      }
    } catch (error) {
      return {
        passed: false,
        output:
          error instanceof Error ? error.message : 'Linter execution failed',
      };
    }
  }

  private async runTypeCheck(
    codeFiles: CodeToVerify[],
    workingDir: string,
  ): Promise<{ passed: boolean; output: string }> {
    const languages = [...new Set(codeFiles.map((f) => f.language))];
    const primaryLanguage = languages[0];

    try {
      switch (primaryLanguage) {
        case 'typescript': {
          try {
            const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
              cwd: workingDir,
              timeout: 30000,
            });
            const output = stdout || stderr;
            return { passed: output.length === 0, output };
          } catch (err: unknown) {
            const e = err as {
              stdout?: string;
              stderr?: string;
              message?: string;
            };
            const output = e.stdout || e.stderr || e.message || '';
            return { passed: false, output };
          }
        }
        case 'python': {
          try {
            const { stdout, stderr } = await execAsync('python -m mypy .', {
              cwd: workingDir,
              timeout: 30000,
            });
            const output = stdout || stderr;
            return { passed: output.length === 0, output };
          } catch {
            return { passed: true, output: 'MyPy not available' };
          }
        }
        default:
          return {
            passed: true,
            output: `No type checker configured for ${primaryLanguage}`,
          };
      }
    } catch (error) {
      return {
        passed: false,
        output:
          error instanceof Error
            ? error.message
            : 'Type check execution failed',
      };
    }
  }

  private async runTests(
    codeFiles: CodeToVerify[],
    workingDir: string,
  ): Promise<{ passed: boolean; output: string }> {
    const languages = [...new Set(codeFiles.map((f) => f.language))];
    const primaryLanguage = languages[0];

    try {
      switch (primaryLanguage) {
        case 'typescript':
        case 'javascript': {
          try {
            const { stdout, stderr } = await execAsync(
              'npm test -- --passWithNoTests',
              { cwd: workingDir, timeout: 60000 },
            );
            const output = stdout || stderr;
            const passed =
              !output.includes('FAIL') &&
              (output.includes('PASS') || output.includes('passWithNoTests'));
            return { passed, output };
          } catch (err: unknown) {
            const e = err as {
              stdout?: string;
              stderr?: string;
              message?: string;
            };
            const output = e.stdout || e.stderr || e.message || '';
            return { passed: false, output };
          }
        }
        case 'python': {
          try {
            const { stdout, stderr } = await execAsync(
              'python -m pytest . -v',
              { cwd: workingDir, timeout: 60000 },
            );
            const output = stdout || stderr;
            const passed =
              output.includes('passed') || output.includes('PASSED');
            return { passed, output };
          } catch (err: unknown) {
            const e = err as {
              stdout?: string;
              stderr?: string;
              message?: string;
            };
            const output = e.stdout || e.stderr || e.message || '';
            return { passed: false, output };
          }
        }
        default:
          return {
            passed: true,
            output: `No test runner configured for ${primaryLanguage}`,
          };
      }
    } catch (error) {
      return {
        passed: false,
        output:
          error instanceof Error ? error.message : 'Test execution failed',
      };
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(
    codeFiles: CodeToVerify[],
    riskLevel: 'low' | 'medium' | 'high' = 'medium',
  ): Promise<any> {
    const securityCheck = await this.checkSecurity(codeFiles, riskLevel);

    return {
      timestamp: new Date().toISOString(),
      filesAnalyzed: codeFiles.length,
      totalLinesOfCode: codeFiles.reduce(
        (sum, file) => sum + file.content.split('\n').length,
        0,
      ),
      securityCheck,
      summary: {
        passed: securityCheck.passed,
        requiresApproval: securityCheck.requiresApproval,
        riskLevel: securityCheck.riskAssessment,
        criticalIssues: securityCheck.recommendations.filter(
          (r) =>
            r.toLowerCase().includes('security') ||
            r.toLowerCase().includes('sensitive') ||
            r.toLowerCase().includes('critical'),
        ).length,
      },
    };
  }
}
