/**
 * MCP Tool Protocol
 * Handles tool registration, discovery, and execution
 */

import { EventEmitter } from 'events';
import { Tool, ToolParameter, ToolResult, ToolExecutionContext } from './types.js';

/**
 * Tool executor function type
 */
export type ToolExecutor = (params: Record<string, any>, context?: ToolExecutionContext) => Promise<any>;

/**
 * Tool registration options
 */
export interface ToolRegistrationOptions {
  enabled?: boolean;
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
  timeout?: number;
  retries?: number;
}

/**
 * MCP Tool Protocol
 * Manages tool lifecycle and execution
 */
export class MCPToolProtocol extends EventEmitter {
  private tools = new Map<string, { definition: Tool; executor: ToolExecutor; options: ToolRegistrationOptions }>();
  private executionStats = new Map<string, { calls: number; errors: number; totalTime: number }>();
  private activeExecutions = new Map<string, number>(); // Track concurrent executions per tool
  private rateLimitWindows = new Map<string, { count: number; resetAt: number }>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 10) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Register a tool
   */
  registerTool(
    definition: Tool,
    executor: ToolExecutor,
    options: ToolRegistrationOptions = {}
  ): void {
    if (this.tools.has(definition.id)) {
      throw new Error(`Tool ${definition.id} is already registered`);
    }

    this.validateToolDefinition(definition);

    this.tools.set(definition.id, {
      definition,
      executor,
      options: {
        enabled: true,
        timeout: 30000,
        retries: 0,
        ...options,
      },
    });

    this.executionStats.set(definition.id, {
      calls: 0,
      errors: 0,
      totalTime: 0,
    });

    this.emit('tool_registered', { toolId: definition.id, name: definition.name });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolId: string): boolean {
    const deleted = this.tools.delete(toolId);
    if (deleted) {
      this.executionStats.delete(toolId);
      this.emit('tool_unregistered', { toolId });
    }
    return deleted;
  }

  /**
   * Get tool definition
   */
  getTool(toolId: string): Tool | undefined {
    return this.tools.get(toolId)?.definition;
  }

  /**
   * List all registered tools
   */
  listTools(): Tool[] {
    return Array.from(this.tools.values())
      .filter(t => t.options.enabled)
      .map(t => t.definition);
  }

  /**
   * Execute a tool with concurrency and rate limit enforcement
   */
  async executeTool(toolId: string, parameters: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(toolId);

    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolId} not found`,
      };
    }

    if (!tool.options.enabled) {
      return {
        success: false,
        error: `Tool ${toolId} is disabled`,
      };
    }

    // Check rate limits
    if (tool.options.rateLimit) {
      const rateLimitResult = this.checkRateLimit(toolId, tool.options.rateLimit);
      if (!rateLimitResult.allowed) {
        return {
          success: false,
          error: `Rate limit exceeded for tool ${toolId}. ${rateLimitResult.message}`,
        };
      }
    }

    // Check concurrent executions
    const currentActive = this.activeExecutions.get(toolId) || 0;
    if (currentActive >= this.maxConcurrent) {
      return {
        success: false,
        error: `Maximum concurrent executions (${this.maxConcurrent}) reached for tool ${toolId}`,
      };
    }

    // Validate parameters
    const validation = this.validateParameters(tool.definition.parameters, parameters);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.error}`,
      };
    }

    const startTime = Date.now();
    const stats = this.executionStats.get(toolId)!;
    stats.calls++;

    // Track concurrent execution
    this.activeExecutions.set(toolId, currentActive + 1);

    try {
      this.emit('tool_execution_started', { toolId, parameters, context });

      // Execute with timeout
      const result = await this.executeWithTimeout(
        tool.executor(parameters, context),
        tool.options.timeout!
      );

      const executionTime = Date.now() - startTime;
      stats.totalTime += executionTime;

      this.emit('tool_execution_completed', { toolId, executionTime, result });

      return {
        success: true,
        data: result,
        metadata: {
          executionTime,
          toolId,
        },
      };
    } catch (error: any) {
      stats.errors++;
      const executionTime = Date.now() - startTime;

      this.emit('tool_execution_failed', { toolId, error: error.message, executionTime });

      return {
        success: false,
        error: error.message || 'Tool execution failed',
        metadata: {
          executionTime,
          toolId,
        },
      };
    } finally {
      // Decrement concurrent execution counter
      const current = this.activeExecutions.get(toolId) || 0;
      this.activeExecutions.set(toolId, Math.max(0, current - 1));
    }
  }

  /**
   * Check rate limit for a tool
   */
  private checkRateLimit(toolId: string, config: { maxCalls: number; windowMs: number }): { allowed: boolean; message?: string } {
    const now = Date.now();
    let window = this.rateLimitWindows.get(toolId);

    if (!window || now > window.resetAt) {
      // Reset window
      window = { count: 0, resetAt: now + config.windowMs };
      this.rateLimitWindows.set(toolId, window);
    }

    if (window.count >= config.maxCalls) {
      const resetIn = Math.ceil((window.resetAt - now) / 1000);
      return {
        allowed: false,
        message: `Retry after ${resetIn} seconds`,
      };
    }

    window.count++;
    return { allowed: true };
  }

  /**
   * Get execution statistics
   */
  getStats(toolId?: string): any {
    if (toolId) {
      return this.executionStats.get(toolId);
    }

    const allStats: Record<string, any> = {};
    this.executionStats.forEach((stats, id) => {
      allStats[id] = {
        ...stats,
        avgTime: stats.calls > 0 ? stats.totalTime / stats.calls : 0,
        errorRate: stats.calls > 0 ? stats.errors / stats.calls : 0,
      };
    });
    return allStats;
  }

  /**
   * Validate tool definition
   */
  private validateToolDefinition(tool: Tool): void {
    if (!tool.id || !tool.name || !tool.description) {
      throw new Error('Tool must have id, name, and description');
    }

    if (!Array.isArray(tool.parameters)) {
      throw new Error('Tool parameters must be an array');
    }

    // Validate parameter definitions
    tool.parameters.forEach(param => {
      if (!param.name || !param.type) {
        throw new Error('Tool parameters must have name and type');
      }
    });
  }

  /**
   * Validate parameters against definition
   */
  private validateParameters(
    definition: ToolParameter[],
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    for (const param of definition) {
      if (param.required && !(param.name in params)) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }

      if (param.name in params) {
        const value = params[param.name];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (param.type !== 'object' && actualType !== param.type) {
          return {
            valid: false,
            error: `Parameter ${param.name} must be of type ${param.type}, got ${actualType}`,
          };
        }

        // Validate enum values
        if (param.enum && !param.enum.includes(value)) {
          return {
            valid: false,
            error: `Parameter ${param.name} must be one of: ${param.enum.join(', ')}`,
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Execute promise with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      ),
    ]);
  }
}
