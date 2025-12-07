import { EventEmitter } from 'events';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { AgentExecution, IAgentExecution } from '../models/AgentExecution';
import { IAgentIdentity } from '../models/AgentIdentity';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

/**
 * Sandbox Execution Request
 */
export interface SandboxExecutionRequest {
  agentIdentity: IAgentIdentity;
  userId: string | mongoose.Types.ObjectId;
  workspaceId?: string | mongoose.Types.ObjectId;
  organizationId?: string | mongoose.Types.ObjectId;
  
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
export class AgentSandboxService extends EventEmitter {
  private static instance: AgentSandboxService;
  
  // Active executions tracking
  private activeExecutions = new Map<string, {
    execution: IAgentExecution;
    process?: ChildProcess;
    containerId?: string;
    startTime: number;
    monitorInterval?: NodeJS.Timeout;
  }>();

  // Health check interval
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 seconds

  private constructor() {
    super();
    this.startHealthMonitoring();
  }

  public static getInstance(): AgentSandboxService {
    if (!AgentSandboxService.instance) {
      AgentSandboxService.instance = new AgentSandboxService();
    }
    return AgentSandboxService.instance;
  }

  /**
   * Execute agent code in isolated sandbox
   */
  public async executeInSandbox(
    request: SandboxExecutionRequest
  ): Promise<SandboxExecutionResult> {
    const executionId = this.generateExecutionId();
    const sandboxId = this.generateSandboxId();
    
    try {
      loggingService.info('Starting sandbox execution', {
        component: 'AgentSandboxService',
        operation: 'executeInSandbox',
        executionId,
        agentId: request.agentIdentity.agentId,
        sandboxRequired: request.agentIdentity.sandboxRequired
      });

      // Check if sandbox is required
      if (!request.agentIdentity.sandboxRequired) {
        loggingService.warn('Sandbox not required for agent - executing without isolation', {
          component: 'AgentSandboxService',
          executionId,
          agentId: request.agentIdentity.agentId
        });
        // For non-sandboxed execution, still track but execute directly
        // In production, you'd want stricter enforcement
      }

      // Create execution record
      const execution = await this.createExecutionRecord(
        executionId,
        sandboxId,
        request
      );

      // Check concurrent limit
      const agentExecutions = Array.from(this.activeExecutions.values())
        .filter(e => e.execution.agentId === request.agentIdentity.agentId);
      
      if (agentExecutions.length >= request.agentIdentity.maxConcurrentExecutions) {
        throw new Error(`Agent concurrent execution limit exceeded (${request.agentIdentity.maxConcurrentExecutions})`);
      }

      // Start execution based on isolation type
      const isolationType = request.agentIdentity.sandboxConfig?.isolationLevel || 'container';
      
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

      loggingService.info('Sandbox execution completed', {
        component: 'AgentSandboxService',
        operation: 'executeInSandbox',
        executionId,
        status: result.status,
        executionTimeMs: result.executionTimeMs
      });

      return result;
    } catch (error) {
      loggingService.error('Sandbox execution failed', {
        component: 'AgentSandboxService',
        operation: 'executeInSandbox',
        executionId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Update execution as failed
      await AgentExecution.updateOne(
        { executionId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        }
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
    request: SandboxExecutionRequest
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Build Docker command with resource limits
      const dockerArgs = this.buildDockerCommand(execution, request);
      
      loggingService.info('Launching Docker container', {
        component: 'AgentSandboxService',
        operation: 'executeInContainer',
        executionId: execution.executionId,
        sandboxId: execution.sandboxId
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
        executionTimeMs
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      
      return {
        executionId: execution.executionId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs
      };
    }
  }

  /**
   * Execute in isolated process (lighter weight than container)
   */
  private async executeInProcess(
    execution: IAgentExecution,
    request: SandboxExecutionRequest
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    
    try {
      loggingService.info('Launching isolated process', {
        component: 'AgentSandboxService',
        operation: 'executeInProcess',
        executionId: execution.executionId
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
        executionTimeMs
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      
      return {
        executionId: execution.executionId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs
      };
    }
  }

  /**
   * Build Docker command with security constraints
   */
  private buildDockerCommand(
    execution: IAgentExecution,
    request: SandboxExecutionRequest
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
      
      // Timeout (Docker doesn't have built-in timeout, handled externally)
      
      // Environment variables (filtered)
      ...Object.entries(request.environmentVariables || {})
        .filter(([key]) => this.isAllowedEnvVar(key))
        .map(([key, value]) => `-e ${key}=${value}`),
      
      // Image (use lightweight Alpine-based image)
      'alpine:latest',
      
      // Command
      request.command,
      ...(request.arguments || [])
    ];

    return args;
  }

  /**
   * Run Docker command with timeout and monitoring
   */
  private async runDockerCommand(
    args: string[],
    execution: IAgentExecution
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
            stderr
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
    execution: IAgentExecution
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const timeout = execution.resourceLimits.maxExecutionTimeSeconds * 1000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Build environment with resource limits (Unix ulimit)
      const env = {
        ...process.env,
        ...request.environmentVariables
      };

      const proc = spawn(request.command, request.arguments || [], {
        env,
        cwd: request.workingDirectory,
        timeout: timeout,
        // Note: Resource limits via ulimit would be set here in production
        // This is a simplified version
      });

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
            stderr
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
        const execution = await AgentExecution.findOne({ executionId });
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
        const resourceUsage = execDoc.getResourceUtilization ? execDoc.getResourceUtilization() : 0;
        this.emit('execution_heartbeat', {
          executionId,
          status: execution.status,
          resourceUsage
        });
      } catch (error) {
        loggingService.error('Execution monitoring error', {
          component: 'AgentSandboxService',
          executionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 5000);
  }

  /**
   * Kill execution (kill-switch)
   */
  public async killExecution(executionId: string, reason: string): Promise<void> {
    try {
      const execData = this.activeExecutions.get(executionId);
      if (!execData) {
        loggingService.warn('Execution not found for kill', {
          component: 'AgentSandboxService',
          executionId
        });
        return;
      }

      loggingService.warn('Killing execution', {
        component: 'AgentSandboxService',
        operation: 'killExecution',
        executionId,
        reason
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
      await AgentExecution.updateOne(
        { executionId },
        {
          $set: {
            status: 'killed',
            completedAt: new Date(),
            killRequested: true,
            killRequestedAt: new Date(),
            killReason: reason,
            forceKilled: true
          }
        }
      );

      // Emit event
      this.emit('execution_killed', {
        executionId,
        reason
      });

      // Cleanup
      this.activeExecutions.delete(executionId);
    } catch (error) {
      loggingService.error('Failed to kill execution', {
        component: 'AgentSandboxService',
        operation: 'killExecution',
        executionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Create execution record
   */
  private async createExecutionRecord(
    executionId: string,
    sandboxId: string,
    request: SandboxExecutionRequest
  ): Promise<IAgentExecution> {
    const sandboxConfig = request.agentIdentity.sandboxConfig;
    
    const execution = new AgentExecution({
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
        maxExecutionTimeSeconds: sandboxConfig?.maxExecutionTimeSeconds || 300
      },
      
      networkPolicy: {
        allowOutbound: true,
        allowInbound: false,
        allowedEndpoints: sandboxConfig?.allowedNetworkEndpoints || [],
        blockedEndpoints: [],
        allowDNS: true
      },
      
      filesystemPolicy: {
        rootPath: '/app',
        readOnlyPaths: ['/'],
        writablePaths: ['/tmp'],
        tempDirectory: '/tmp',
        maxFileSize: 10485760 // 10MB
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
      forceKilled: false
    });

    await execution.save();

    // Track active execution
    this.activeExecutions.set(executionId, {
      execution,
      startTime: Date.now()
    });

    return execution;
  }

  /**
   * Update execution record with results
   */
  private async updateExecutionRecord(
    executionId: string,
    result: SandboxExecutionResult
  ): Promise<void> {
    await AgentExecution.updateOne(
      { executionId },
      {
        $set: {
          status: result.status,
          completedAt: new Date(),
          executionTimeMs: result.executionTimeMs,
          exitCode: result.exitCode,
          outputData: result.outputData,
          errorMessage: result.errorMessage,
          actualCost: result.actualCost
        }
      }
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
            const timeSinceHeartbeat = Date.now() - execution.lastHeartbeatAt.getTime();
            if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT) {
              loggingService.warn('Execution heartbeat timeout', {
                component: 'AgentSandboxService',
                executionId,
                timeSinceHeartbeat
              });
              
              execution.healthCheckFailures++;
              if (execution.healthCheckFailures >= 3) {
                await this.killExecution(executionId, 'Health check failures exceeded');
              }
            }
          }
        } catch (error) {
          loggingService.error('Health monitoring error', {
            component: 'AgentSandboxService',
            executionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Helper methods
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateSandboxId(): string {
    return `sandbox-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  }

  private isAllowedEnvVar(key: string): boolean {
    // Whitelist approach - only allow safe environment variables
    const allowedPrefixes = ['APP_', 'CUSTOM_', 'USER_'];
    const blocked = ['PATH', 'HOME', 'USER', 'AWS_', 'SECRET_', 'KEY_', 'TOKEN_', 'PASSWORD_'];
    
    if (blocked.some(prefix => key.startsWith(prefix))) {
      return false;
    }
    
    return allowedPrefixes.some(prefix => key.startsWith(prefix));
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

// Export singleton instance
export const agentSandboxService = AgentSandboxService.getInstance();

