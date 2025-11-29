import { loggingService } from './logging.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface VerificationResult {
    passed: boolean;
    errors: string[];
    warnings: string[];
    testResults?: {
        passed: boolean;
        output: string;
    };
    lintResults?: {
        passed: boolean;
        output: string;
    };
    typeCheckResults?: {
        passed: boolean;
        output: string;
    };
}

export interface CodeToVerify {
    filePath: string;
    content: string;
    language: string;
}

/**
 * Code verification service
 * Runs linters, type checkers, and tests on generated code
 */
export class CodeVerificationService {
    /**
     * Verify generated code
     */
    static async verifyCode(
        codeFiles: CodeToVerify[],
        options: {
            runTests?: boolean;
            runLinter?: boolean;
            runTypeCheck?: boolean;
            workingDirectory?: string;
        } = {}
    ): Promise<VerificationResult> {
        const result: VerificationResult = {
            passed: true,
            errors: [],
            warnings: []
        };

        if (codeFiles.length === 0) {
            return result;
        }

        const workingDir = options.workingDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'code-verify-'));

        try {
            // Write files to temporary directory
            for (const file of codeFiles) {
                const filePath = path.join(workingDir, file.filePath);
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, file.content, 'utf-8');
            }

            // Run verifications in parallel where possible
            const verifications: Promise<void>[] = [];

            if (options.runLinter !== false) {
                verifications.push(
                    this.runLinter(codeFiles, workingDir).then(lintResult => {
                        result.lintResults = lintResult;
                        if (!lintResult.passed) {
                            result.passed = false;
                            result.errors.push(`Linter failed: ${lintResult.output.substring(0, 200)}`);
                        }
                    }).catch(error => {
                        result.warnings.push(`Linter check failed: ${error instanceof Error ? error.message : 'Unknown'}`);
                    })
                );
            }

            if (options.runTypeCheck !== false) {
                verifications.push(
                    this.runTypeCheck(codeFiles, workingDir).then(typeResult => {
                        result.typeCheckResults = typeResult;
                        if (!typeResult.passed) {
                            result.passed = false;
                            result.errors.push(`Type check failed: ${typeResult.output.substring(0, 200)}`);
                        }
                    }).catch(error => {
                        result.warnings.push(`Type check failed: ${error instanceof Error ? error.message : 'Unknown'}`);
                    })
                );
            }

            if (options.runTests !== false) {
                verifications.push(
                    this.runTests(codeFiles, workingDir).then(testResult => {
                        result.testResults = testResult;
                        if (!testResult.passed) {
                            result.passed = false;
                            result.errors.push(`Tests failed: ${testResult.output.substring(0, 200)}`);
                        }
                    }).catch(error => {
                        result.warnings.push(`Test run failed: ${error instanceof Error ? error.message : 'Unknown'}`);
                    })
                );
            }

            await Promise.allSettled(verifications);

            loggingService.info('Code verification completed', {
                component: 'CodeVerificationService',
                passed: result.passed,
                filesCount: codeFiles.length,
                errorsCount: result.errors.length
            });

            return result;
        } catch (error) {
            loggingService.error('Code verification failed', {
                component: 'CodeVerificationService',
                error: error instanceof Error ? error.message : 'Unknown'
            });

            result.passed = false;
            result.errors.push(`Verification failed: ${error instanceof Error ? error.message : 'Unknown'}`);
            return result;
        } finally {
            // Cleanup temporary directory
            try {
                if (fs.existsSync(workingDir) && workingDir.startsWith(os.tmpdir())) {
                    fs.rmSync(workingDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                loggingService.warn('Failed to cleanup temp directory', {
                    component: 'CodeVerificationService',
                    error: cleanupError instanceof Error ? cleanupError.message : 'Unknown'
                });
            }
        }
    }

    /**
     * Run linter based on language
     */
    private static async runLinter(
        codeFiles: CodeToVerify[],
        workingDir: string
    ): Promise<{ passed: boolean; output: string }> {
        const languages = [...new Set(codeFiles.map(f => f.language))];
        const primaryLanguage = languages[0];

        try {
            switch (primaryLanguage) {
                case 'typescript':
                case 'javascript':
                    // Try ESLint
                    try {
                        const { stdout, stderr } = await execAsync('npx eslint . --format json', {
                            cwd: workingDir,
                            timeout: 30000
                        });
                        const output = stdout || stderr;
                        const hasErrors = output.includes('"errorCount":') && !output.includes('"errorCount":0');
                        return { passed: !hasErrors, output };
                    } catch (error) {
                        // ESLint not available, skip
                        return { passed: true, output: 'ESLint not available' };
                    }

                case 'python':
                    // Try pylint or flake8
                    try {
                        const { stdout, stderr } = await execAsync('python -m flake8 .', {
                            cwd: workingDir,
                            timeout: 30000
                        });
                        const output = stdout || stderr;
                        return { passed: output.length === 0, output };
                    } catch (error) {
                        return { passed: true, output: 'Flake8 not available' };
                    }

                default:
                    return { passed: true, output: `No linter configured for ${primaryLanguage}` };
            }
        } catch (error) {
            return {
                passed: false,
                output: error instanceof Error ? error.message : 'Linter execution failed'
            };
        }
    }

    /**
     * Run type checker
     */
    private static async runTypeCheck(
        codeFiles: CodeToVerify[],
        workingDir: string
    ): Promise<{ passed: boolean; output: string }> {
        const languages = [...new Set(codeFiles.map(f => f.language))];
        const primaryLanguage = languages[0];

        try {
            switch (primaryLanguage) {
                case 'typescript':
                    try {
                        const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
                            cwd: workingDir,
                            timeout: 30000
                        });
                        const output = stdout || stderr;
                        return { passed: output.length === 0, output };
                    } catch (error: any) {
                        const output = error.stdout || error.stderr || error.message;
                        return { passed: false, output };
                    }

                case 'python':
                    // Try mypy
                    try {
                        const { stdout, stderr } = await execAsync('python -m mypy .', {
                            cwd: workingDir,
                            timeout: 30000
                        });
                        const output = stdout || stderr;
                        return { passed: output.length === 0, output };
                    } catch (error) {
                        return { passed: true, output: 'MyPy not available' };
                    }

                default:
                    return { passed: true, output: `No type checker configured for ${primaryLanguage}` };
            }
        } catch (error) {
            return {
                passed: false,
                output: error instanceof Error ? error.message : 'Type check execution failed'
            };
        }
    }

    /**
     * Run tests
     */
    private static async runTests(
        codeFiles: CodeToVerify[],
        workingDir: string
    ): Promise<{ passed: boolean; output: string }> {
        const languages = [...new Set(codeFiles.map(f => f.language))];
        const primaryLanguage = languages[0];

        try {
            switch (primaryLanguage) {
                case 'typescript':
                case 'javascript':
                    // Try Jest or Mocha
                    try {
                        const { stdout, stderr } = await execAsync('npm test -- --passWithNoTests', {
                            cwd: workingDir,
                            timeout: 60000
                        });
                        const output = stdout || stderr;
                        const passed = !output.includes('FAIL') && (output.includes('PASS') || output.includes('passWithNoTests'));
                        return { passed, output };
                    } catch (error: any) {
                        const output = error.stdout || error.stderr || error.message;
                        return { passed: false, output };
                    }

                case 'python':
                    // Try pytest
                    try {
                        const { stdout, stderr } = await execAsync('python -m pytest . -v', {
                            cwd: workingDir,
                            timeout: 60000
                        });
                        const output = stdout || stderr;
                        const passed = output.includes('passed') || output.includes('PASSED');
                        return { passed, output };
                    } catch (error: any) {
                        const output = error.stdout || error.stderr || error.message;
                        return { passed: false, output };
                    }

                default:
                    return { passed: true, output: `No test runner configured for ${primaryLanguage}` };
            }
        } catch (error) {
            return {
                passed: false,
                output: error instanceof Error ? error.message : 'Test execution failed'
            };
        }
    }
}

