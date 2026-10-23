/**
 * Puppeteer Automation Tool
 * Browser automation for complex scraping, form filling, screenshots
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Puppeteer Automation Tool Definition
 */
export const puppeteerAutomationTool: Tool = {
  id: 'puppeteer_automation',
  name: 'Puppeteer Automation',
  description: 'Automate browser actions: navigate, click, fill forms, take screenshots, extract data',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'Automation action',
      required: true,
      enum: ['navigate', 'screenshot', 'pdf', 'click', 'type', 'extract', 'script'],
    },
    {
      name: 'url',
      type: 'string',
      description: 'URL to navigate to (for navigate, screenshot, pdf actions)',
      required: false,
    },
    {
      name: 'selector',
      type: 'string',
      description: 'CSS selector for click, type, extract actions',
      required: false,
    },
    {
      name: 'value',
      type: 'string',
      description: 'Value to type (for type action)',
      required: false,
    },
    {
      name: 'script',
      type: 'string',
      description: 'JavaScript code to execute (for script action)',
      required: false,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Action-specific options',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Automation result (screenshot, extracted data, etc.)',
  },
  examples: [
    {
      input: {
        action: 'screenshot',
        url: 'https://example.com',
        options: { fullPage: true },
      },
      output: {
        success: true,
        action: 'screenshot',
        screenshotPath: '/tmp/screenshot-123.png',
      },
    },
  ],
};

/**
 * Puppeteer Automation Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const puppeteerAutomationExecutor: ToolExecutor = async (params) => {
  const { action, url, selector, value, script, options = {} } = params;

  if (!action) {
    return {
      success: false,
      error: 'action is required',
    };
  }

  // Validate action-specific requirements
  if (['navigate', 'screenshot', 'pdf'].includes(action) && !url) {
    return {
      success: false,
      error: `url is required for ${action} action`,
    };
  }

  if (['click', 'type', 'extract'].includes(action) && !selector) {
    return {
      success: false,
      error: `selector is required for ${action} action`,
    };
  }

  if (action === 'type' && !value) {
    return {
      success: false,
      error: 'value is required for type action',
    };
  }

  if (action === 'script' && !script) {
    return {
      success: false,
      error: 'script is required for script action',
    };
  }

  // Return automation configuration for host to execute
  return {
    success: true,
    action: 'puppeteer_automation',
    config: {
      action,
      url,
      selector,
      value,
      script,
      options: {
        headless: options.headless !== false,
        waitUntil: options.waitUntil || 'networkidle2',
        timeout: options.timeout || 30000,
        fullPage: options.fullPage,
        ...options,
      },
    },
    note: 'Puppeteer automation requires host environment with Chromium browser',
  };
};
