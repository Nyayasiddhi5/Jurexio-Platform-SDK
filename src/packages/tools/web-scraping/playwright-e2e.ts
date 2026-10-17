/**
 * Playwright E2E Tool
 * End-to-end testing and scraping with cross-browser support
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Playwright E2E Tool Definition
 */
export const playwrightE2ETool: Tool = {
  id: 'playwright_e2e',
  name: 'Playwright E2E',
  description: 'Run end-to-end tests and automation with Playwright: multi-browser, network interception, mobile emulation',
  parameters: [
    {
      name: 'test',
      type: 'object',
      description: 'Test configuration with steps',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Test options (browser, device, network, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Test results with screenshots and traces',
  },
  examples: [
    {
      input: {
        test: {
          name: 'Login flow',
          steps: [
            { action: 'goto', url: 'https://example.com/login' },
            { action: 'fill', selector: '#email', value: 'user@example.com' },
            { action: 'fill', selector: '#password', value: 'password' },
            { action: 'click', selector: '#submit' },
            { action: 'waitForURL', url: 'https://example.com/dashboard' },
          ],
        },
        options: { browser: 'chromium' },
      },
      output: {
        success: true,
        testName: 'Login flow',
        passed: true,
        duration: 1234,
      },
    },
  ],
};

/**
 * Playwright E2E Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const playwrightE2EExecutor: ToolExecutor = async (params) => {
  const { test, options = {} } = params;

  if (!test || !test.steps || !Array.isArray(test.steps)) {
    return {
      success: false,
      error: 'test must have a steps array',
    };
  }

  if (test.steps.length === 0) {
    return {
      success: false,
      error: 'test must have at least one step',
    };
  }

  // Validate steps
  for (const step of test.steps) {
    if (!step.action) {
      return {
        success: false,
        error: 'Each step must have an action',
      };
    }
  }

  // Return test configuration for host to execute
  return {
    success: true,
    action: 'playwright_e2e',
    config: {
      test: {
        name: test.name || 'Unnamed test',
        steps: test.steps,
        assertions: test.assertions || [],
      },
      options: {
        browser: options.browser || 'chromium',
        headless: options.headless !== false,
        device: options.device,
        viewport: options.viewport,
        geolocation: options.geolocation,
        permissions: options.permissions,
        timeout: options.timeout || 30000,
        screenshot: options.screenshot !== false,
        trace: options.trace,
        video: options.video,
      },
    },
    note: 'Playwright E2E requires host environment with browser binaries',
  };
};
