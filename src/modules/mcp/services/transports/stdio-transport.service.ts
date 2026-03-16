import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export const STDIO_TRANSPORT_CONFIG = 'STDIO_TRANSPORT_CONFIG';

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // Message timeout in ms
  maxBuffer?: number; // Max buffer size for responses
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

@Injectable()
export class StdioTransportService implements OnModuleDestroy {
  private readonly logger = new Logger(StdioTransportService.name);
  private process: ChildProcess | null = null;
  private eventEmitter = new EventEmitter();
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    @Inject(STDIO_TRANSPORT_CONFIG)
    private readonly config: StdioTransportConfig,
  ) {
    this.eventEmitter.setMaxListeners(20);
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Stdio transport already started');
    }

    return new Promise((resolve, reject) => {
      try {
        this.logger.log('Starting MCP stdio transport', {
          command: this.config.command,
          args: this.config.args,
        });

        this.process = spawn(this.config.command, this.config.args || [], {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle process stdout (responses from MCP server)
        this.process.stdout?.on('data', (data) => {
          try {
            const messages = this.parseMessages(data.toString());
            for (const message of messages) {
              this.handleMessage(message);
            }
          } catch (error) {
            this.logger.error('Failed to parse MCP message', {
              data: data.toString(),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        // Handle process stderr (logs from MCP server)
        this.process.stderr?.on('data', (data) => {
          this.logger.debug('MCP server stderr', {
            data: data.toString().trim(),
          });
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          this.logger.log('MCP server process exited', { code, signal });
          this.eventEmitter.emit('exit', { code, signal });
          this.cleanup();
        });

        // Handle process error
        this.process.on('error', (error) => {
          this.logger.error('MCP server process error', { error });
          this.eventEmitter.emit('error', error);
          reject(error);
        });

        // Wait for process to be ready (basic check)
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.logger.log('MCP stdio transport started successfully');
            resolve();
          } else {
            reject(new Error('Failed to start MCP process'));
          }
        }, 1000);
      } catch (error) {
        this.logger.error('Failed to start stdio transport', { error });
        reject(error);
      }
    });
  }

  async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.process || this.process.killed) {
      throw new Error('MCP stdio transport not connected');
    }

    const id = ++this.requestId;
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`Request timeout after ${this.config.timeout || 30000}ms`),
        );
      }, this.config.timeout || 30000);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        // Send message to MCP server
        const messageStr = JSON.stringify(message) + '\n';
        const stdin = this.process?.stdin;
        if (stdin) {
          stdin.write(messageStr, 'utf8', (error) => {
            if (error) {
              clearTimeout(timeout);
              this.pendingRequests.delete(id);
              reject(error);
            }
          });
        } else {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error('Process stdin is not available'));
        }
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async sendNotification(method: string, params?: any): Promise<void> {
    if (!this.process || this.process.killed) {
      throw new Error('MCP stdio transport not connected');
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      try {
        const messageStr = JSON.stringify(message) + '\n';
        const stdin = this.process!.stdin;
        if (stdin) {
          stdin.write(messageStr, 'utf8', (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        } else {
          reject(new Error('Process stdin is not available'));
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  onMessage(handler: (message: MCPMessage) => void): void {
    this.eventEmitter.on('message', handler);
  }

  onExit(
    handler: (info: { code: number | null; signal: string | null }) => void,
  ): void {
    this.eventEmitter.on('exit', handler);
  }

  onError(handler: (error: Error) => void): void {
    this.eventEmitter.on('error', handler);
  }

  isConnected(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async stop(): Promise<void> {
    this.logger.log('Stopping MCP stdio transport');
    this.cleanup();
  }

  onModuleDestroy(): void {
    this.cleanup();
  }

  private handleMessage(message: MCPMessage): void {
    // Emit message event
    this.eventEmitter.emit('message', message);

    // Handle responses to pending requests
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(`MCP Error: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    }

    // Handle notifications (messages without id)
    if (message.method && message.id === undefined) {
      this.eventEmitter.emit('notification', message);
    }
  }

  private parseMessages(data: string): MCPMessage[] {
    const messages: MCPMessage[] = [];
    const lines = data.trim().split('\n');

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line.trim());
          messages.push(message);
        } catch (error) {
          this.logger.warn('Failed to parse MCP message line', {
            line: line.substring(0, 200),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return messages;
  }

  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport closed'));
    }
    this.pendingRequests.clear();

    // Kill process if running
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }

    this.process = null;
    this.eventEmitter.removeAllListeners();
  }
}
