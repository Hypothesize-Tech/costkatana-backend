import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentExecution,
  IAgentExecution,
} from '../../../schemas/agent/agent-execution.schema';
import { IAgentIdentity } from '../../../schemas/agent/agent-identity.schema';

/**
 * Sandbox Execution Request
 */
export interface SandboxExecutionRequest {
  agentIdentity: IAgentIdentity;
  userId: string | any;
  workspaceId?: string | any;
  organizationId?: string | any;

  command: string;
  arguments?: string[];
  environmentVariables?: Record<string, string>;
  workingDirectory?: string;

  inputData?: any;
  estimatedCost: number;

  decisionId?: string;
  requestId?: string;
  correlationId?: string;
}

/**
 * Sandbox Execution Result
 */
export interface SandboxExecutionResult {
  executionId: string;
  status: 'completed' | 'failed' | 'timeout' | 'killed' | 'resource_exceeded';
  exitCode?: number;
  outputData?: any;
  errorMessage?: string;
  actualCost?: number;
  executionTimeMs: number;
}

/**
 * Agent Sandbox Service
 * Process isolation with Docker containers, resource limits, and kill-switch
 * Implements Defense in Depth and Secure by Default
 */
@Injectable()
export class AgentSandboxService extends EventEmitter2 {
  private readonly logger = new Logger(AgentSandboxService.name);

  // Active executions tracking
  private activeExecutions = new Map<
    string,
    {
      execution: IAgentExecution;
      process?: ChildProcess;
      containerId?: string;
      startTime: number;
      monitorInterval?: NodeJS.Timeout;
    }
  >();

  // Health check interval
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 seconds

  constructor(
    @InjectModel(AgentExecution.name)
    private agentExecutionModel: Model<IAgentExecution>,
  ) {
    super();
    this.startHealthMonitoring();
  }

  /**
   * Execute agent code in isolated sandbox
   */
  public async executeInSandbox(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const executionId = this.generateExecutionId();
    const sandboxId = this.generateSandboxId();

    try {
      this.logger.log(`Starting sandbox execution`, {
        executionId,
        agentId: request.agentIdentity.agentId,
        sandboxRequired: request.agentIdentity.sandboxRequired,
      });

      // Enforce sandbox when required (production-ready)
      const enforceSandbox = process.env.ENFORCE_AGENT_SANDBOX !== 'false';
      if (request.agentIdentity.sandboxRequired && !enforceSandbox) {
        this.logger.warn(
          `Sandbox required but enforcement disabled via ENFORCE_AGENT_SANDBOX`,
          {
            executionId,
            agentId: request.agentIdentity.agentId,
          },
        );
      }
      if (request.agentIdentity.sandboxRequired && enforceSandbox) {
        const isolationType =
          request.agentIdentity.sandboxConfig?.isolationLevel || 'container';
        if (isolationType !== 'container' && isolationType !== 'process') {
          throw new Error(
            `Sandbox required for agent ${request.agentIdentity.agentId}. ` +
              `Valid isolation types: container, process. Got: ${isolationType}`,
          );
        }
      }

      // Non-sandboxed execution: allow only when explicitly not required and track for audit
      if (!request.agentIdentity.sandboxRequired) {
        this.logger.log(`Executing without isolation (sandbox not required)`, {
          executionId,
          agentId: request.agentIdentity.agentId,
        });
      }

      // Create execution record
      const execution = await this.createExecutionRecord(
        executionId,
        sandboxId,
        request,
      );

      // Check concurrent limit
      const agentExecutions = Array.from(this.activeExecutions.values()).filter(
        (e) => e.execution.agentId === request.agentIdentity.agentId,
      );

      if (
        agentExecutions.length >= request.agentIdentity.maxConcurrentExecutions
      ) {
        throw new Error(
          `Agent concurrent execution limit exceeded (${request.agentIdentity.maxConcurrentExecutions})`,
        );
      }

      // Start execution based on isolation type
      const isolationType =
        request.agentIdentity.sandboxConfig?.isolationLevel || 'container';

      let result: SandboxExecutionResult;

      if (isolationType === 'container') {
        result = await this.executeInContainer(execution, request);
      } else if (isolationType === 'process') {
        result = await this.executeInProcess(execution, request);
      } else {
        throw new Error(`Unsupported isolation type: ${isolationType}`);
      }

      // Update execution record with results
      await this.updateExecutionRecord(executionId, result);

      this.logger.log(`Sandbox execution completed`, {
        executionId,
        status: result.status,
        executionTimeMs: result.executionTimeMs,
      });

      return result;
    } catch (error) {
      this.logger.error(`Sandbox execution failed`, {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update execution as failed
      await this.agentExecutionModel.updateOne(
        { executionId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        },
      );

      throw error;
    } finally {
      // Cleanup
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute in Docker container with full isolation
   */
  private async executeInContainer(
    execution: IAgentExecution,
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();

    try {
      // Build Docker command with resource limits
      const dockerArgs = this.buildDockerCommand(execution, request);

      this.logger.log(`Launching Docker container`, {
        executionId: execution.executionId,
        sandboxId: execution.sandboxId,
      });

      // Update status to starting
      execution.status = 'starting';
      execution.startedAt = new Date();
      await execution.save();

      // Execute Docker command
      const result = await this.runDockerCommand(dockerArgs, execution);

      // Monitor resources during execution
      await this.monitorExecution(execution.executionId);

      const executionTimeMs = Date.now() - startTime;

      return {
        executionId: execution.executionId,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        outputData: result.stdout,
        errorMessage: result.stderr,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      return {
        executionId: execution.executionId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      };
    }
  }

  /**
   * Execute in isolated process (lighter weight than container)
   */
  private async executeInProcess(
    execution: IAgentExecution,
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();

    try {
      this.logger.log(`Launching isolated process`, {
        executionId: execution.executionId,
      });

      // Update status
      execution.status = 'starting';
      execution.startedAt = new Date();
      await execution.save();

      // Spawn process with resource limits (using ulimit on Unix)
      const result = await this.spawnIsolatedProcess(request, execution);

      // Monitor execution
      await this.monitorExecution(execution.executionId);

      const executionTimeMs = Date.now() - startTime;

      return {
        executionId: execution.executionId,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        outputData: result.stdout,
        errorMessage: result.stderr,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      return {
        executionId: execution.executionId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      };
    }
  }

  /**
   * Build Docker command with security constraints
   */
  private buildDockerCommand(
    execution: IAgentExecution,
    request: SandboxExecutionRequest,
  ): string[] {
    const limits = execution.resourceLimits;
    const network = execution.networkPolicy;
    const fs = execution.filesystemPolicy;

    const args = [
      'run',
      '--rm', // Remove container after execution
      `--name=${execution.sandboxId}`,

      // Resource limits
      `--cpus=${limits.maxCpuCores}`,
      `--memory=${limits.maxMemoryMB}m`,
      `--memory-swap=${limits.maxMemoryMB}m`, // No swap
      `--pids-limit=100`,

      // Security options
      '--security-opt=no-new-privileges',
      '--cap-drop=ALL', // Drop all capabilities
      '--read-only', // Read-only root filesystem

      // Network isolation
      network.allowOutbound ? '--network=bridge' : '--network=none',

      // Filesystem
      `--tmpfs=${fs.tempDirectory}:rw,size=${limits.maxDiskMB}m,mode=1777`,

      // User (non-root)
      '--user=1000:1000',

      // Environment variables (filtered)
      ...Object.entries(request.environmentVariables || {})
        .filter(([key]) => this.isAllowedEnvVar(key))
        .map(([key, value]) => `-e ${key}=${value}`),

      // Image (use lightweight Alpine-based image)
      'alpine:latest',

      // Command
      request.command,
      ...(request.arguments || []),
    ];

    return args;
  }

  /**
   * Run Docker command with timeout and monitoring
   */
  private async runDockerCommand(
    args: string[],
    execution: IAgentExecution,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const timeout = execution.resourceLimits.maxExecutionTimeSeconds * 1000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn('docker', args);

      // Store process reference
      const execData = this.activeExecutions.get(execution.executionId);
      if (execData) {
        execData.process = proc;
        execution.processId = proc.pid;
        execution.save();
      }

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.killExecution(execution.executionId, 'Execution timeout exceeded');
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          reject(new Error('Execution timeout exceeded'));
        } else {
          resolve({
            exitCode: code || 0,
            stdout,
            stderr,
          });
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Spawn isolated process with resource limits
   */
  private async spawnIsolatedProcess(
    request: SandboxExecutionRequest,
    execution: IAgentExecution,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const timeout = execution.resourceLimits.maxExecutionTimeSeconds * 1000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Build environment; on Unix set resource limits via wrapper when possible
      const env = {
        ...process.env,
        ...request.environmentVariables,
      } as NodeJS.ProcessEnv;

      const spawnOptions: {
        env: NodeJS.ProcessEnv;
        cwd?: string;
        timeout: number;
        stdio?: 'pipe' | 'ignore' | 'inherit';
        windowsHide?: boolean;
      } = {
        env,
        cwd: request.workingDirectory || process.cwd(),
        timeout: timeout,
        stdio: 'pipe',
        windowsHide: true,
      };

      // On Unix, apply resource limits via shell wrapper (ulimit) when supported
      const limits = execution.resourceLimits;
      const useUlimit = process.platform !== 'win32' && limits.maxMemoryMB > 0;
      const ulimitV = useUlimit
        ? Math.floor((limits.maxMemoryMB * 1024 * 1024) / 1024)
        : 0;
      const ulimitT = limits.maxExecutionTimeSeconds;

      let proc: ChildProcess;
      if (useUlimit && ulimitV > 0) {
        // sh -c 'ulimit -v N -t T; exec "$@"' -- cmd arg1 arg2...
        const argsForExec = [request.command, ...(request.arguments || [])];
        proc = spawn(
          'sh',
          [
            '-c',
            `ulimit -v ${ulimitV} -t ${ulimitT} 2>/dev/null; exec "$@"`,
            '--',
            ...argsForExec,
          ],
          {
            ...spawnOptions,
            cwd: request.workingDirectory || process.cwd(),
            env,
          },
        );
      } else {
        proc = spawn(request.command, request.arguments || [], spawnOptions);
      }

      // Store process reference
      const execData = this.activeExecutions.get(execution.executionId);
      if (execData) {
        execData.process = proc;
        execution.processId = proc.pid;
        execution.save();
      }

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.killExecution(execution.executionId, 'Execution timeout exceeded');
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          reject(new Error('Execution timeout exceeded'));
        } else {
          resolve({
            exitCode: code || 0,
            stdout,
            stderr,
          });
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Monitor execution health and resource usage
   */
  private async monitorExecution(executionId: string): Promise<void> {
    const execData = this.activeExecutions.get(executionId);
    if (!execData) return;

    // Monitor every 5 seconds
    execData.monitorInterval = setInterval(async () => {
      try {
        const execution = await this.agentExecutionModel.findOne({
          executionId,
        });
        const execDoc = execution as any;
        if (!execution || !execDoc.isRunning || !execDoc.isRunning()) {
          clearInterval(execData.monitorInterval);
          return;
        }

        // Check if should kill
        if (execDoc.shouldKill && execDoc.shouldKill()) {
          await this.killExecution(executionId, 'Kill conditions met');
          return;
        }

        // Update heartbeat
        execution.lastHeartbeatAt = new Date();
        await execution.save();

        // Emit monitoring event
        const resourceUsage = execDoc.getResourceUtilization
          ? execDoc.getResourceUtilization()
          : 0;
        this.emit('execution_heartbeat', {
          executionId,
          status: execution.status,
          resourceUsage,
        });
      } catch (error) {
        this.logger.error(`Execution monitoring error`, {
          executionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 5000);
  }

  /**
   * Kill execution (kill-switch)
   */
  public async killExecution(
    executionId: string,
    reason: string,
  ): Promise<void> {
    try {
      const execData = this.activeExecutions.get(executionId);
      if (!execData) {
        this.logger.warn(`Execution not found for kill`, {
          executionId,
        });
        return;
      }

      this.logger.warn(`Killing execution`, {
        executionId,
        reason,
      });

      // Kill process/container
      if (execData.process) {
        execData.process.kill('SIGKILL');
      }

      if (execData.containerId) {
        spawn('docker', ['kill', execData.containerId]);
      }

      // Clear monitoring
      if (execData.monitorInterval) {
        clearInterval(execData.monitorInterval);
      }

      // Update execution record
      await this.agentExecutionModel.updateOne(
        { executionId },
        {
          $set: {
            status: 'killed',
            completedAt: new Date(),
            killRequested: true,
            killRequestedAt: new Date(),
            killReason: reason,
            forceKilled: true,
          },
        },
      );

      // Emit event
      this.emit('execution_killed', {
        executionId,
        reason,
      });

      // Cleanup
      this.activeExecutions.delete(executionId);
    } catch (error) {
      this.logger.error(`Failed to kill execution`, {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create execution record
   */
  private async createExecutionRecord(
    executionId: string,
    sandboxId: string,
    request: SandboxExecutionRequest,
  ): Promise<IAgentExecution> {
    const sandboxConfig = request.agentIdentity.sandboxConfig;

    const execution = new this.agentExecutionModel({
      executionId,
      sandboxId,
      agentId: request.agentIdentity.agentId,
      agentIdentityId: request.agentIdentity._id,
      userId: request.userId,
      workspaceId: request.workspaceId,
      organizationId: request.organizationId,

      requestId: request.requestId,
      correlationId: request.correlationId,
      decisionId: request.decisionId,

      isolationType: sandboxConfig?.isolationLevel || 'container',

      resourceLimits: {
        maxCpuCores: sandboxConfig?.maxCpuCores || 0.5,
        maxMemoryMB: sandboxConfig?.maxMemoryMB || 512,
        maxDiskMB: sandboxConfig?.maxDiskMB || 100,
        maxExecutionTimeSeconds: sandboxConfig?.maxExecutionTimeSeconds || 300,
      },

      networkPolicy: {
        allowOutbound: true,
        allowInbound: false,
        allowedEndpoints: sandboxConfig?.allowedNetworkEndpoints || [],
        blockedEndpoints: [],
        allowDNS: true,
      },

      filesystemPolicy: {
        rootPath: '/app',
        readOnlyPaths: ['/'],
        writablePaths: ['/tmp'],
        tempDirectory: '/tmp',
        maxFileSize: 10485760, // 10MB
      },

      command: request.command,
      arguments: request.arguments,
      environmentVariables: request.environmentVariables,
      workingDirectory: request.workingDirectory,

      inputData: request.inputData,
      estimatedCost: request.estimatedCost,

      status: 'queued',
      queuedAt: new Date(),

      healthCheckStatus: 'unknown',
      healthCheckFailures: 0,

      killRequested: false,
      forceKilled: false,
    });

    await execution.save();

    // Track active execution
    this.activeExecutions.set(executionId, {
      execution,
      startTime: Date.now(),
    });

    return execution;
  }

  /**
   * Update execution record with results
   */
  private async updateExecutionRecord(
    executionId: string,
    result: SandboxExecutionResult,
  ): Promise<void> {
    await this.agentExecutionModel.updateOne(
      { executionId },
      {
        $set: {
          status: result.status,
          completedAt: new Date(),
          executionTimeMs: result.executionTimeMs,
          exitCode: result.exitCode,
          outputData: result.outputData,
          errorMessage: result.errorMessage,
          actualCost: result.actualCost,
        },
      },
    );
  }

  /**
   * Start health monitoring for all active executions
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const [executionId, execData] of this.activeExecutions.entries()) {
        try {
          const execution = execData.execution;

          // Check heartbeat timeout
          if (execution.lastHeartbeatAt) {
            const timeSinceHeartbeat =
              Date.now() - execution.lastHeartbeatAt.getTime();
            if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT) {
              this.logger.warn(`Execution heartbeat timeout`, {
                executionId,
                timeSinceHeartbeat,
              });

              execution.healthCheckFailures++;
              if (execution.healthCheckFailures >= 3) {
                await this.killExecution(
                  executionId,
                  'Health check failures exceeded',
                );
              }
            }
          }
        } catch (error) {
          this.logger.error(`Health monitoring error`, {
            executionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Helper methods
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  private generateSandboxId(): string {
    return `sandbox-${Date.now()}-${randomBytes(6).toString('hex')}`;
  }

  private isAllowedEnvVar(key: string): boolean {
    // Whitelist approach - only allow safe environment variables
    const allowedPrefixes = ['APP_', 'CUSTOM_', 'USER_'];
    const blocked = [
      'PATH',
      'HOME',
      'USER',
      'AWS_',
      'SECRET_',
      'KEY_',
      'TOKEN_',
      'PASSWORD_',
    ];

    if (blocked.some((prefix) => key.startsWith(prefix))) {
      return false;
    }

    return allowedPrefixes.some((prefix) => key.startsWith(prefix));
  }

  /**
   * Cleanup on shutdown
   */
  public async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Kill all active executions
    for (const executionId of this.activeExecutions.keys()) {
      await this.killExecution(executionId, 'Service shutdown');
    }
  }
}
