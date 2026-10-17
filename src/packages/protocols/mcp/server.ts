/**
 * MCP Server
 * Main server implementation for Model Context Protocol
 */

import { EventEmitter } from 'events';
import { MCPToolProtocol } from './tool-protocol.js';
import { MCPResourceManager } from './resource-manager.js';
import { MCPPromptServer } from './prompt-server.js';
import { MCPContextMaintenance } from './context-maintenance.js';
import {
  MCPServerConfig,
  MCPMessage,
  MCPMessageType,
  Tool,
  Resource,
  PromptTemplate,
  ContextProvider,
  ToolExecutionContext
} from './types.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('server');

/**
 * Default MCP server configuration
 */
const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'Jurexio MCP Server',
  version: '1.0.0',
  capabilities: {
    tools: true,
    resources: true,
    context: true,
    prompts: true,
    streaming: false,
  },
  maxToolExecutionTime: 30000,
  maxConcurrentTools: 10,
};

/**
 * MCP Server
 * Provides unified protocol for agent-tool-resource interactions
 */
export class MCPServer extends EventEmitter {
  private config: MCPServerConfig;
  private toolProtocol: MCPToolProtocol;
  private resourceManager: MCPResourceManager;
  private promptServer: MCPPromptServer;
  private contextMaintenance: MCPContextMaintenance;
  private contextProviders = new Map<string, ContextProvider>();
  private running = false;

  constructor(config: Partial<MCPServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.toolProtocol = new MCPToolProtocol();
    this.resourceManager = new MCPResourceManager();
    this.promptServer = new MCPPromptServer();
    this.contextMaintenance = new MCPContextMaintenance();

    this.setupEventForwarding();
  }

  /**
   * Start the MCP server
   */
  start(): void {
    if (this.running) {
      throw new Error('MCP server is already running');
    }

    this.running = true;
    this.emit('server_started', { config: this.config });
    logger.info(`✅ MCP Server started: ${this.config.name} v${this.config.version}`);
  }

  /**
   * Stop the MCP server
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.emit('server_stopped');
    logger.info('✅ MCP Server stopped');
  }

  /**
   * Handle MCP message
   */
  async handleMessage(message: MCPMessage): Promise<MCPMessage> {
    if (!this.running) {
      return this.createErrorResponse(message.id, 'Server is not running');
    }

    try {
      switch (message.type) {
        case 'tool_list_request':
          return this.handleToolListRequest(message);
        case 'tool_call_request':
          return await this.handleToolCallRequest(message);
        case 'resource_list_request':
          return this.handleResourceListRequest(message);
        case 'resource_read_request':
          return await this.handleResourceReadRequest(message);
        case 'prompt_list_request':
          return this.handlePromptListRequest(message);
        case 'prompt_render_request':
          return this.handlePromptRenderRequest(message);
        case 'context_request': // Legacy, kept for backward compatibility
          return await this.handleContextRequest(message);
        case 'context_save_request':
          return this.handleContextSaveRequest(message);
        case 'context_update_request':
          return await this.handleContextUpdateRequest(message);
        case 'context_list_request':
          return this.handleContextListRequest(message);
        case 'context_snapshot_request':
          return this.handleContextSnapshotRequest(message);
        default:
          return this.createErrorResponse(message.id, `Unsupported message type: ${message.type}`);
      }
    } catch (error: any) {
      return this.createErrorResponse(message.id, error.message);
    }
  }

  /**
   * Get tool protocol (for advanced usage)
   */
  getToolProtocol(): MCPToolProtocol {
    return this.toolProtocol;
  }

  /**
   * Get resource manager (for advanced usage)
   */
  getResourceManager(): MCPResourceManager {
    return this.resourceManager;
  }

  /**
   * Get prompt server (for advanced usage)
   */
  getPromptServer(): MCPPromptServer {
    return this.promptServer;
  }

  /**
   * Get context maintenance (for advanced usage)
   */
  getContextMaintenance(): MCPContextMaintenance {
    return this.contextMaintenance;
  }

  /**
   * Register context provider
   */
  registerContextProvider(name: string, provider: ContextProvider): void {
    this.contextProviders.set(name, provider);
    this.emit('context_provider_registered', { name });
  }

  /**
   * Register prompt template
   */
  registerPromptTemplate(template: PromptTemplate): void {
    this.promptServer.register(template);
    this.emit('prompt_template_registered', { templateId: template.id });
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): MCPServerConfig['capabilities'] {
    return this.config.capabilities;
  }

  /**
   * Get server info
   */
  getInfo(): { name: string; version: string; capabilities: any; stats: any } {
    return {
      name: this.config.name,
      version: this.config.version,
      capabilities: this.config.capabilities,
      stats: {
        tools: this.toolProtocol.listTools().length,
        resources: this.resourceManager.listResources().length,
        contextProviders: this.contextProviders.size,
        promptTemplates: this.promptServer.list().length,
        contextWindows: 0, // Will be tracked by context maintenance
      },
    };
  }

  /**
   * Setup event forwarding from sub-components
   */
  private setupEventForwarding(): void {
    // Forward tool protocol events
    this.toolProtocol.on('tool_execution_started', (data) => {
      this.emit('tool_execution_started', data);
    });

    this.toolProtocol.on('tool_execution_completed', (data) => {
      this.emit('tool_execution_completed', data);
    });

    this.toolProtocol.on('tool_execution_failed', (data) => {
      this.emit('tool_execution_failed', data);
    });

    // Forward resource manager events
    this.resourceManager.on('resource_read_started', (data) => {
      this.emit('resource_read_started', data);
    });

    this.resourceManager.on('resource_read_completed', (data) => {
      this.emit('resource_read_completed', data);
    });
  }

  /**
   * Handle tool list request
   */
  private handleToolListRequest(message: MCPMessage): MCPMessage {
    const tools = this.toolProtocol.listTools();
    return this.createResponse(message.id, 'tool_list_response', { tools });
  }

  /**
   * Handle tool call request
   */
  private async handleToolCallRequest(message: MCPMessage): Promise<MCPMessage> {
    const { toolId, parameters, context } = message.payload;
    const result = await this.toolProtocol.executeTool(toolId, parameters, context);
    return this.createResponse(message.id, 'tool_call_response', result);
  }

  /**
   * Handle resource list request
   */
  private handleResourceListRequest(message: MCPMessage): MCPMessage {
    const { type } = message.payload || {};
    const resources = this.resourceManager.listResources(type);
    return this.createResponse(message.id, 'resource_list_response', { resources });
  }

  /**
   * Handle resource read request
   */
  private async handleResourceReadRequest(message: MCPMessage): Promise<MCPMessage> {
    const { resourceId, params } = message.payload;
    const data = await this.resourceManager.readResource(resourceId, params);
    return this.createResponse(message.id, 'resource_read_response', { data });
  }

  /**
   * Handle context request (legacy)
   */
  private async handleContextRequest(message: MCPMessage): Promise<MCPMessage> {
    const { providerName, params } = message.payload;
    const provider = this.contextProviders.get(providerName);

    if (!provider) {
      return this.createErrorResponse(message.id, `Context provider ${providerName} not found`);
    }

    const context = await provider(params);
    return this.createResponse(message.id, 'context_response', { context });
  }

  /**
   * Handle prompt list request
   * Supports legacy format via optional 'legacy' flag in payload
   */
  private handlePromptListRequest(message: MCPMessage): MCPMessage {
    const { legacy } = message.payload || {};
    
    // Use legacy format (string[] variables) if requested, otherwise use full PromptVariable[] format
    const prompts = legacy ? this.promptServer.listLegacy() : this.promptServer.list();
    
    this.emit('prompt_list_requested', { count: prompts.length, legacy: !!legacy });
    return this.createResponse(message.id, 'prompt_list_response', { prompts });
  }

  /**
   * Handle prompt render request
   */
  private handlePromptRenderRequest(message: MCPMessage): MCPMessage {
    const { promptId, variables } = message.payload;
    
    if (!promptId) {
      return this.createErrorResponse(message.id, 'promptId is required');
    }

    try {
      this.emit('prompt_render_started', { promptId });
      const rendered = this.promptServer.render(promptId, variables || {});
      this.emit('prompt_render_completed', { promptId, length: rendered.length });
      return this.createResponse(message.id, 'prompt_render_response', { rendered });
    } catch (error: any) {
      this.emit('prompt_render_failed', { promptId, error: error.message });
      return this.createErrorResponse(message.id, error.message);
    }
  }

  /**
   * Handle context save request
   */
  private handleContextSaveRequest(message: MCPMessage): MCPMessage {
    const { windowId, message: contextMsg } = message.payload;

    if (!windowId) {
      return this.createErrorResponse(message.id, 'windowId is required');
    }

    try {
      // Create window if it doesn't exist
      let window = this.contextMaintenance.getWindow(windowId);
      if (!window) {
        window = this.contextMaintenance.createWindow(windowId);
        this.emit('context_window_created', { windowId });
      }

      const savedMessage = this.contextMaintenance.addMessage(windowId, contextMsg);
      this.emit('context_message_saved', { windowId, messageId: savedMessage.id });
      return this.createResponse(message.id, 'context_save_response', { message: savedMessage });
    } catch (error: any) {
      return this.createErrorResponse(message.id, error.message);
    }
  }

  /**
   * Handle context update request
   * Now delegates to MCPContextMaintenance.updateMessage() for proper maintenance triggering
   */
  private async handleContextUpdateRequest(message: MCPMessage): Promise<MCPMessage> {
    const { windowId, messageId, updates } = message.payload;

    if (!windowId || !messageId) {
      return this.createErrorResponse(message.id, 'windowId and messageId are required');
    }

    try {
      // Delegate to updateMessage which handles token recalculation and maintenance re-evaluation
      const updatedMessage = await this.contextMaintenance.updateMessage(windowId, messageId, updates);

      this.emit('context_message_updated', { windowId, messageId });
      return this.createResponse(message.id, 'context_update_response', { message: updatedMessage });
    } catch (error: any) {
      return this.createErrorResponse(message.id, error.message);
    }
  }

  /**
   * Handle context list request
   */
  private handleContextListRequest(message: MCPMessage): MCPMessage {
    const windows = this.contextMaintenance.listWindows();
    this.emit('context_list_requested', { count: windows.length });
    return this.createResponse(message.id, 'context_list_response', { windows });
  }

  /**
   * Handle context snapshot request
   */
  private handleContextSnapshotRequest(message: MCPMessage): MCPMessage {
    const { windowId } = message.payload;

    if (!windowId) {
      return this.createErrorResponse(message.id, 'windowId is required');
    }

    try {
      const window = this.contextMaintenance.getWindow(windowId);
      if (!window) {
        return this.createErrorResponse(message.id, `Context window ${windowId} not found`);
      }

      const snapshot = {
        messages: window.messages,
        tokenCount: window.tokenCount,
        timestamp: new Date(),
      };

      this.emit('context_snapshot_created', { windowId, messageCount: window.messages.length });
      return this.createResponse(message.id, 'context_snapshot_response', { windowId, snapshot });
    } catch (error: any) {
      return this.createErrorResponse(message.id, error.message);
    }
  }

  /**
   * Create response message
   */
  private createResponse(requestId: string, type: MCPMessageType, payload: any): MCPMessage {
    return {
      type,
      id: requestId,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  /**
   * Create error response
   */
  private createErrorResponse(requestId: string, error: string): MCPMessage {
    return {
      type: 'error',
      id: requestId,
      timestamp: new Date().toISOString(),
      payload: { error },
    };
  }
}
