/**
 * MCP Resource Manager
 * Manages resources (files, APIs, databases, memory) accessible to agents
 */

import { EventEmitter } from 'events';
import { Resource, ResourceType } from './types.js';

/**
 * Resource reader function
 */
export type ResourceReader = (uri: string, params?: any) => Promise<any>;

/**
 * Resource writer function
 */
export type ResourceWriter = (uri: string, data: any, params?: any) => Promise<void>;

/**
 * Resource registration options
 */
export interface ResourceRegistrationOptions {
  readable?: boolean;
  writable?: boolean;
  cacheable?: boolean;
  cacheTTL?: number;
}

/**
 * MCP Resource Manager
 * Provides unified access to various resource types
 */
export class MCPResourceManager extends EventEmitter {
  private resources = new Map<string, {
    definition: Resource;
    reader?: ResourceReader;
    writer?: ResourceWriter;
    options: ResourceRegistrationOptions;
  }>();
  private cache = new Map<string, { data: any; timestamp: number }>();

  constructor() {
    super();
  }

  /**
   * Generate cache key including parameters
   */
  private getCacheKey(resourceId: string, params?: any): string {
    if (!params || Object.keys(params).length === 0) {
      return resourceId;
    }
    // Stable hash of params (sorted keys)
    const sortedKeys = Object.keys(params).sort();
    const paramsHash = sortedKeys.map(k => `${k}=${JSON.stringify(params[k])}`).join('&');
    return `${resourceId}:${paramsHash}`;
  }

  /**
   * Register a resource
   */
  registerResource(
    definition: Resource,
    reader?: ResourceReader,
    writer?: ResourceWriter,
    options: ResourceRegistrationOptions = {}
  ): void {
    if (this.resources.has(definition.id)) {
      throw new Error(`Resource ${definition.id} is already registered`);
    }

    this.resources.set(definition.id, {
      definition,
      reader,
      writer,
      options: {
        readable: true,
        writable: false,
        cacheable: false,
        cacheTTL: 60000, // 1 minute default
        ...options,
      },
    });

    this.emit('resource_registered', { resourceId: definition.id, type: definition.type });
  }

  /**
   * Unregister a resource
   */
  unregisterResource(resourceId: string): boolean {
    const deleted = this.resources.delete(resourceId);
    if (deleted) {
      this.cache.delete(resourceId);
      this.emit('resource_unregistered', { resourceId });
    }
    return deleted;
  }

  /**
   * Get resource definition
   */
  getResource(resourceId: string): Resource | undefined {
    return this.resources.get(resourceId)?.definition;
  }

  /**
   * List all registered resources
   */
  listResources(type?: ResourceType): Resource[] {
    const resources = Array.from(this.resources.values()).map(r => r.definition);
    return type ? resources.filter(r => r.type === type) : resources;
  }

  /**
   * Read a resource
   */
  async readResource(resourceId: string, params?: any): Promise<any> {
    const resource = this.resources.get(resourceId);

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    if (!resource.options.readable || !resource.reader) {
      throw new Error(`Resource ${resourceId} is not readable`);
    }

    // Check cache with params-aware key
    const cacheKey = this.getCacheKey(resourceId, params);
    if (resource.options.cacheable) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < resource.options.cacheTTL!) {
          this.emit('resource_cache_hit', { resourceId, cacheKey });
          return cached.data;
        }
      }
    }

    this.emit('resource_read_started', { resourceId, params });

    try {
      const data = await resource.reader(resource.definition.uri, params);

      // Update cache with params-aware key
      if (resource.options.cacheable) {
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
      }

      this.emit('resource_read_completed', { resourceId });
      return data;
    } catch (error: any) {
      this.emit('resource_read_failed', { resourceId, error: error.message });
      throw error;
    }
  }

  /**
   * Write to a resource
   */
  async writeResource(resourceId: string, data: any, params?: any): Promise<void> {
    const resource = this.resources.get(resourceId);

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    if (!resource.options.writable || !resource.writer) {
      throw new Error(`Resource ${resourceId} is not writable`);
    }

    this.emit('resource_write_started', { resourceId, params });

    try {
      await resource.writer(resource.definition.uri, data, params);

      // Invalidate cache
      this.cache.delete(resourceId);

      this.emit('resource_write_completed', { resourceId });
    } catch (error: any) {
      this.emit('resource_write_failed', { resourceId, error: error.message });
      throw error;
    }
  }

  /**
   * Clear resource cache
   */
  clearCache(resourceId?: string): void {
    if (resourceId) {
      this.cache.delete(resourceId);
    } else {
      this.cache.clear();
    }
    this.emit('cache_cleared', { resourceId });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): any {
    return {
      totalEntries: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([id, entry]) => ({
        resourceId: id,
        age: Date.now() - entry.timestamp,
        size: JSON.stringify(entry.data).length,
      })),
    };
  }
}
