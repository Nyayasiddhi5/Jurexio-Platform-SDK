/**
 * Tool Registry
 * Central registry for all Jurexio Enterprise Platform SDK tools with MCP integration
 */

import type { Tool } from '../../protocols/mcp/types.js';
import type { ToolExecutor } from '../../protocols/mcp/tool-protocol.js';
import { createLogger } from '../../../utils/logger.js';


const logger = createLogger('tool-registry');

const createStubTool = (id: string, name: string, desc: string): Tool => ({
  id, name, description: desc, parameters: []
});
const createStubExecutor = (): ToolExecutor => async () => ({ success: true });

export interface ToolRegistryConfig {
  enabledTools?: string[];
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
  timeout?: number;
}

export class ToolRegistry {
  private registeredTools = new Set<string>();

  constructor(private config: ToolRegistryConfig = {}) {}

  registerAllTools(): void {
    const toolDefs = [
      'file_operations', 'web_requests', 'api_calling', 'code_execution',
      'json_operations', 'text_processing', 'math_calculations', 'datetime_operations',
      'random_generation', 'data_validation', 'voice_synthesis', 'get_voices',
      'speech_to_text', 'speech_translation', 'video_generation', 'get_video_status',
      'music_generation', 'get_music_status', 'dalle_image_generation', 'stable_diffusion',
      'image_resize', 'image_crop', 'image_filter', 'image_watermark', 'image_convert',
      'csv_operations', 'excel_operations', 'data_cleaning', 'pivot_table', 'google_sheets',
      'chart_config', 'table_formatter', 'dashboard_config', 'data_viz_config', 'real_time_widget',
      'descriptive_stats', 'correlation', 'regression', 'time_series', 'ab_testing',
      'kpi_tracker', 'trend_analyzer', 'forecaster', 'cohort_analyzer', 'funnel_analyzer',
      'firecrawl_scraper', 'puppeteer_automation', 'playwright_e2e', 'cheerio_parser',
      'exa_search', 'sitemap_generator', 'perplexity_search', 'google_search',
      'bing_search', 'duckduckgo_search', 'seo_analyzer', 'keyword_research',
      'backlink_checker', 'meta_tag_generator', 'google_analytics',
      'email_sender', 'email_parser', 'email_template', 'bulk_email', 'email_validation',
      'sms_sender', 'slack_messenger', 'discord_messenger', 'telegram_bot', 'whatsapp_business',
      'calendar_event', 'timezone_converter', 'event_reminder', 'task_manager', 'note_taker',
      'pdf_generator', 'markdown_converter', 'template_engine', 'doc_merger', 'qrcode_generator',
      'github_api', 'stripe_payments', 'twilio_sms', 'sendgrid_email', 'aws_s3'
    ];

    for (const id of toolDefs) {
      if (this.config.enabledTools && !this.config.enabledTools.includes(id)) {
        continue;
      }
      this.registeredTools.add(id);
    }

    logger.info(`✅ Registered ${this.registeredTools.size} tools`);
  }

  getRegisteredTools(): string[] {
    return Array.from(this.registeredTools);
  }

  isToolRegistered(toolId: string): boolean {
    return this.registeredTools.has(toolId);
  }

  getStats(): any {
    return {
      totalTools: this.registeredTools.size,
      tools: this.getRegisteredTools()
    };
  }
}

export function createToolRegistry(config?: ToolRegistryConfig): ToolRegistry {
  const registry = new ToolRegistry(config);
  registry.registerAllTools();
  return registry;
}
