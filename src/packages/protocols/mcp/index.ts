// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * MCP (Model Context Protocol) Package
 * Unified protocol for agent-tool-resource interactions
 */

export * from './types.js';
// @ts-expect-error NV-TS230 legacy typing gap (TS2459)
export type { ToolExecutor, ToolExecutionContext, ToolRegistrationOptions } from './tool-protocol.js';
export * as ToolProtocol from './tool-protocol.js';
export * as ResourceManager from './resource-manager.js';
export * as Server from './server.js';
export * as PromptServer from './prompt-server.js';
export * as ContextMaintenance from './context-maintenance.js';
export * as Utils from './utils.js';

export { MCPServer as default } from './server.js';
