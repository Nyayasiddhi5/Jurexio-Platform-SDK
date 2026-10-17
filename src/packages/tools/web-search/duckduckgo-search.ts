/**
 * DuckDuckGo Search Tool
 * Privacy-focused web search
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * DuckDuckGo Search Tool Definition
 */
export const duckduckgoSearchTool: Tool = {
  id: 'duckduckgo_search',
  name: 'DuckDuckGo Search',
  description: 'Privacy-focused web search: instant answers, web results, images, no tracking',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Search options (maxResults, region, safeSearch, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Search results with instant answers and web results',
  },
  examples: [
    {
      input: {
        query: 'weather in New York',
        options: { maxResults: 10 },
      },
      output: {
        success: true,
        instantAnswer: 'Weather in New York: 72°F, Partly Cloudy',
        results: [
          {
            title: 'New York Weather',
            url: 'https://example.com/weather',
            snippet: 'Current weather in New York...',
          },
        ],
      },
    },
  ],
};

/**
 * DuckDuckGo Search Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const duckduckgoSearchExecutor: ToolExecutor = async (params) => {
  const { query, options = {} } = params;

  if (typeof query !== 'string' || !query.trim()) {
    return {
      success: false,
      error: 'query must be a non-empty string',
    };
  }

  // Return search configuration for host to execute
  return {
    success: true,
    action: 'duckduckgo_search',
    config: {
      query: query.trim(),
      maxResults: options.maxResults || 10,
      region: options.region || 'wt-wt', // worldwide
      safeSearch: options.safeSearch || 'moderate',
      timeRange: options.timeRange, // 'd' (day), 'w' (week), 'm' (month), 'y' (year)
      backend: options.backend || 'api', // 'api', 'html', 'lite'
    },
    note: 'DuckDuckGo search requires execution by host environment (no API key needed)',
  };
};
