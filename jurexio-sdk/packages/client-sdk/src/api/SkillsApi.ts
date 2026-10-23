/**
 * SkillsApi — SkillShop™ marketplace client for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/skills/*
 */

import type {
  JrxSkill,
  JrxSkillExecution,
  JrxListResponse,
  JrxPaginationOptions,
  JrxJurisdiction,
  JrxAgentPattern,
} from '../types/index.js';
import type { JrxHttpClient } from '../JrxClient.js';

export interface SkillSearchOptions extends JrxPaginationOptions {
  query?: string;
  category?: string;
  jurisdiction?: JrxJurisdiction;
  agentPattern?: JrxAgentPattern;
  pricingModel?: 'free' | 'subscription' | 'usage';
  minRating?: number;
  tags?: string[];
}

export interface SkillPublishRequest {
  name: string;
  description: string;
  category: string;
  agentPattern?: JrxAgentPattern;
  jurisdiction?: JrxJurisdiction[];
  version: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  implementation: string;
  pricingModel?: 'free' | 'subscription' | 'usage';
  pricePerUse?: number;
  tags?: string[];
}

export class SkillsApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** List all published skills */
  list(options: SkillSearchOptions = {}): Promise<JrxListResponse<JrxSkill>> {
    return this.http.post('/api/jrx/skills/list', options);
  }

  /** Search skills by query */
  search(query: string, options: Omit<SkillSearchOptions, 'query'> = {}): Promise<JrxListResponse<JrxSkill>> {
    return this.http.post('/api/jrx/skills/search', { query, ...options });
  }

  /** Get a specific skill by ID */
  get(skillId: string): Promise<JrxSkill> {
    return this.http.get(`/api/jrx/skills/${skillId}`);
  }

  /** Install a skill for the current org */
  install(skillId: string, configuration?: Record<string, unknown>): Promise<{ success: boolean; message: string; skillId: string }> {
    return this.http.post(`/api/jrx/skills/${skillId}/install`, { configuration });
  }

  /** Uninstall a skill */
  uninstall(skillId: string): Promise<{ success: boolean }> {
    return this.http.delete(`/api/jrx/skills/${skillId}/install`);
  }

  /** Run a skill with input */
  run(
    skillId: string,
    input: Record<string, unknown>
  ): Promise<JrxSkillExecution> {
    return this.http.post(`/api/jrx/skills/${skillId}/run`, { input });
  }

  /** Publish a new skill to the marketplace */
  publish(req: SkillPublishRequest): Promise<{ success: boolean; skillId: string; reviewStatus: string }> {
    return this.http.post('/api/jrx/skills/publish', req);
  }

  /** Update an existing skill (only own skills) */
  update(skillId: string, updates: Partial<SkillPublishRequest>): Promise<{ success: boolean; skill: JrxSkill }> {
    return this.http.patch(`/api/jrx/skills/${skillId}`, updates);
  }

  /** Unpublish a skill from the marketplace */
  unpublish(skillId: string): Promise<{ success: boolean }> {
    return this.http.delete(`/api/jrx/skills/${skillId}`);
  }

  /** Get skill execution history */
  getExecutionHistory(skillId: string, pagination: JrxPaginationOptions = {}): Promise<JrxListResponse<JrxSkillExecution>> {
    const params = new URLSearchParams();
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/skills/${skillId}/executions?${params}`);
  }

  /** Get marketplace stats (total skills, categories, featured) */
  getMarketplaceStats(): Promise<{
    totalSkills: number;
    categories: Array<{ name: string; count: number }>;
    featured: JrxSkill[];
    trending: JrxSkill[];
  }> {
    return this.http.get('/api/jrx/skills/marketplace/stats');
  }

  /** Rate a skill (1-5 stars) */
  rate(skillId: string, rating: 1 | 2 | 3 | 4 | 5, review?: string): Promise<{ success: boolean }> {
    return this.http.post(`/api/jrx/skills/${skillId}/rate`, { rating, review });
  }
}
