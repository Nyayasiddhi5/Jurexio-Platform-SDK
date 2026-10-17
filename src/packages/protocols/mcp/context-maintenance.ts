/**
 * MCP Context Maintenance
 * Manages context windows, compression, and summarization for long-running conversations
 */

import { ContextProvider } from './types.js';

export interface ContextWindow {
  id: string;
  messages: ContextMessage[];
  tokenCount: number;
  maxTokens: number;
  compressionEnabled: boolean;
  summarizationThreshold: number; // Percentage of maxTokens to trigger summarization
}

export interface ContextMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  tokenCount: number;
  metadata?: Record<string, any>;
  compressed?: boolean;
  summarized?: boolean;
}

export interface ContextSummary {
  id: string;
  messages: string[]; // Message IDs included in summary
  content: string;
  tokenCount: number;
  createdAt: Date;
  messageRange: {
    start: number;
    end: number;
  };
}

export interface ContextCompressionResult {
  original: string;
  compressed: string;
  tokenReduction: number;
  technique: 'whitespace' | 'abbreviation' | 'semantic' | 'hybrid';
}

/**
 * MCP Context Maintenance System
 * Production-ready context window management
 */
export class MCPContextMaintenance {
  private windows = new Map<string, ContextWindow>();
  private summaries = new Map<string, ContextSummary[]>(); // window_id -> summaries
  private compressionThreshold = 0.8; // 80% of max tokens
  
  /**
   * Create a new context window
   */
  createWindow(
    id: string,
    maxTokens: number = 128000,
    compressionEnabled: boolean = true,
    summarizationThreshold: number = 0.7
  ): ContextWindow {
    const window: ContextWindow = {
      id,
      messages: [],
      tokenCount: 0,
      maxTokens,
      compressionEnabled,
      summarizationThreshold,
    };
    
    this.windows.set(id, window);
    return window;
  }
  
  /**
   * Add message to context window
   */
  addMessage(
    windowId: string,
    message: Omit<ContextMessage, 'id' | 'timestamp' | 'tokenCount'>
  ): ContextMessage {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    // Create message
    const contextMessage: ContextMessage = {
      id: `msg_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`,
      ...message,
      timestamp: new Date(),
      tokenCount: this.estimateTokens(message.content),
    };
    
    // Add to window
    window.messages.push(contextMessage);
    window.tokenCount += contextMessage.tokenCount;
    
    // Check if maintenance is needed
    this.checkMaintenance(windowId);
    
    return contextMessage;
  }
  
  /**
   * Get context window
   */
  getWindow(id: string): ContextWindow | undefined {
    return this.windows.get(id);
  }
  
  /**
   * Get recent messages from window
   */
  getRecentMessages(windowId: string, count: number = 10): ContextMessage[] {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    return window.messages.slice(-count);
  }
  
  /**
   * List all context windows
   */
  listWindows(): ContextWindow[] {
    return Array.from(this.windows.values());
  }
  
  /**
   * Update an existing message in a context window
   * Re-calculates token counts and triggers maintenance if needed
   */
  async updateMessage(
    windowId: string,
    messageId: string,
    updates: Partial<Omit<ContextMessage, 'id'>>
  ): Promise<ContextMessage> {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    const message = window.messages.find(m => m.id === messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }
    
    // Store old token count for delta calculation
    const oldTokenCount = message.tokenCount;
    
    // Apply updates
    Object.assign(message, updates);
    
    // Recalculate token count if content changed
    if (updates.content !== undefined) {
      message.tokenCount = this.estimateTokens(message.content);
      window.tokenCount = window.tokenCount - oldTokenCount + message.tokenCount;
    }
    
    // Re-evaluate maintenance thresholds after update
    await this.checkMaintenance(windowId);
    
    return message;
  }
  
  /**
   * Compress context window
   */
  async compressWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    // Compress older messages (keep recent 20%)
    const recentCount = Math.ceil(window.messages.length * 0.2);
    const toCompress = window.messages.slice(0, -recentCount);
    
    for (const message of toCompress) {
      if (!message.compressed) {
        const result = this.compressMessage(message.content);
        message.content = result.compressed;
        message.tokenCount = this.estimateTokens(result.compressed);
        message.compressed = true;
      }
    }
    
    // Recalculate total token count
    window.tokenCount = window.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
  }
  
  /**
   * Summarize old messages
   */
  async summarizeOldMessages(windowId: string): Promise<ContextSummary> {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    // Summarize oldest 50% of messages
    const midpoint = Math.floor(window.messages.length / 2);
    const toSummarize = window.messages.slice(0, midpoint);
    
    // Create summary
    const summaryContent = this.createSummary(toSummarize);
    
    const summary: ContextSummary = {
      id: `summary_${Date.now()}`,
      messages: toSummarize.map(m => m.id),
      content: summaryContent,
      tokenCount: this.estimateTokens(summaryContent),
      createdAt: new Date(),
      messageRange: {
        start: 0,
        end: midpoint,
      },
    };
    
    // Store summary
    const existingSummaries = this.summaries.get(windowId) || [];
    existingSummaries.push(summary);
    this.summaries.set(windowId, existingSummaries);
    
    // Remove summarized messages, keep summary as first message
    window.messages = [
      {
        id: summary.id,
        role: 'system',
        content: `[SUMMARY OF PREVIOUS CONVERSATION]\n${summary.content}`,
        timestamp: summary.createdAt,
        tokenCount: summary.tokenCount,
        summarized: true,
      },
      ...window.messages.slice(midpoint),
    ];
    
    // Recalculate token count
    window.tokenCount = window.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
    
    return summary;
  }
  
  /**
   * Clear old messages (emergency cleanup)
   */
  clearOldMessages(windowId: string, keepCount: number = 50): void {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    // Keep only recent N messages
    window.messages = window.messages.slice(-keepCount);
    window.tokenCount = window.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
  }
  
  /**
   * Get context summary
   */
  getSummaries(windowId: string): ContextSummary[] {
    return this.summaries.get(windowId) || [];
  }
  
  /**
   * Get context statistics
   */
  getStatistics(windowId: string): {
    totalMessages: number;
    tokenCount: number;
    utilization: number;
    compressed: number;
    summarized: number;
  } {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }
    
    return {
      totalMessages: window.messages.length,
      tokenCount: window.tokenCount,
      utilization: (window.tokenCount / window.maxTokens) * 100,
      compressed: window.messages.filter(m => m.compressed).length,
      summarized: window.messages.filter(m => m.summarized).length,
    };
  }
  
  /**
   * Compress a single message
   */
  private compressMessage(content: string): ContextCompressionResult {
    let compressed = content;
    const originalLength = content.length;
    
    // Technique 1: Remove excessive whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();
    
    // Technique 2: Common abbreviations
    const abbreviations: Record<string, string> = {
      'information': 'info',
      'application': 'app',
      'configuration': 'config',
      'environment': 'env',
      'parameter': 'param',
      'function': 'func',
      'variable': 'var',
      'document': 'doc',
      'reference': 'ref',
      'implementation': 'impl',
      'development': 'dev',
      'production': 'prod',
      'repository': 'repo',
    };
    
    for (const [full, abbrev] of Object.entries(abbreviations)) {
      compressed = compressed.replace(new RegExp(`\\b${full}\\b`, 'gi'), abbrev);
    }
    
    // Technique 3: Remove filler words
    const fillerWords = [
      'actually', 'basically', 'essentially', 'literally',
      'just', 'really', 'very', 'quite', 'pretty',
    ];
    
    for (const filler of fillerWords) {
      compressed = compressed.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
    }
    
    // Clean up double spaces
    compressed = compressed.replace(/\s+/g, ' ').trim();
    
    // Calculate reduction
    const compressedLength = compressed.length;
    const tokenReduction = ((originalLength - compressedLength) / originalLength) * 100;
    
    return {
      original: content,
      compressed,
      tokenReduction: Math.round(tokenReduction),
      technique: 'hybrid',
    };
  }
  
  /**
   * Create summary from messages
   */
  private createSummary(messages: ContextMessage[]): string {
    const topics: string[] = [];
    const keyPoints: string[] = [];
    
    // Group messages by role
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    
    // Extract key points from user messages
    if (userMessages.length > 0) {
      keyPoints.push('User queries and requests:');
      userMessages.forEach(msg => {
        const preview = msg.content.substring(0, 100);
        keyPoints.push(`- ${preview}${msg.content.length > 100 ? '...' : ''}`);
      });
    }
    
    // Extract key points from assistant messages
    if (assistantMessages.length > 0) {
      keyPoints.push('Assistant responses:');
      assistantMessages.forEach(msg => {
        const preview = msg.content.substring(0, 100);
        keyPoints.push(`- ${preview}${msg.content.length > 100 ? '...' : ''}`);
      });
    }
    
    // Build summary
    const summary = [
      `Summary of ${messages.length} messages`,
      `Time range: ${messages[0].timestamp.toISOString()} to ${messages[messages.length - 1].timestamp.toISOString()}`,
      '',
      ...keyPoints,
    ].join('\n');
    
    return summary;
  }
  
  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Check if maintenance is needed and perform it
   */
  private async checkMaintenance(windowId: string): Promise<void> {
    const window = this.windows.get(windowId);
    if (!window) return;
    
    const utilization = window.tokenCount / window.maxTokens;
    
    // If approaching limit and compression enabled, compress
    if (utilization > this.compressionThreshold && window.compressionEnabled) {
      await this.compressWindow(windowId);
    }
    
    // If still over threshold, summarize
    const updatedWindow = this.windows.get(windowId);
    if (updatedWindow) {
      const updatedUtilization = updatedWindow.tokenCount / updatedWindow.maxTokens;
      if (updatedUtilization > window.summarizationThreshold) {
        await this.summarizeOldMessages(windowId);
      }
    }
  }
}

/**
 * Context Provider implementation for MCP
 * Note: ContextProvider is a function type, so we don't implement it directly
 */
export class DefaultContextProvider {
  private maintenance: MCPContextMaintenance;
  
  constructor() {
    this.maintenance = new MCPContextMaintenance();
  }
  
  async provideContext(query: string, options?: Record<string, any>): Promise<string> {
    const windowId = options?.windowId || 'default';
    
    // Get or create window
    let window = this.maintenance.getWindow(windowId);
    if (!window) {
      window = this.maintenance.createWindow(windowId);
    }
    
    // Get recent messages as context
    const recentMessages = this.maintenance.getRecentMessages(windowId, 20);
    
    // Build context string
    const contextParts = recentMessages.map(
      msg => `[${msg.role}] ${msg.content}`
    );
    
    return contextParts.join('\n\n');
  }
}
