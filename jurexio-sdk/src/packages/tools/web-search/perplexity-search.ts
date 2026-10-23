/**
 * Perplexity Search Tool
 * AI-powered search with real-time web citations
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Perplexity Search Tool Definition
 */
export const perplexitySearchTool: Tool = {
  id: 'perplexity_search',
  name: 'Perplexity Search',
  description: 'AI-powered search with citations: get factual answers with sources, real-time web data',
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
      description: 'Search options (model, searchDomainFilter, returnCitations, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Search results with AI-generated answer and citations',
  },
  examples: [
    {
      input: {
        query: 'Latest developments in quantum computing 2024',
        options: { returnCitations: true },
      },
      output: {
        success: true,
        answer: 'Recent quantum computing developments include...',
        citations: [
          { url: 'https://example.com/quantum', title: 'Quantum Computing News' },
        ],
      },
    },
  ],
};

/**
 * Perplexity Search Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const perplexitySearchExecutor: ToolExecutor = async (params) => {
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
    action: 'perplexity_search',
    config: {
      query: query.trim(),
      model: options.model || 'llama-3.1-sonar-small-128k-online',
      searchDomainFilter: options.searchDomainFilter,
      returnImages: options.returnImages || false,
      returnRelatedQuestions: options.returnRelatedQuestions || false,
      returnCitations: options.returnCitations !== false,
      temperature: options.temperature || 0.2,
      topP: options.topP || 0.9,
      maxTokens: options.maxTokens,
    },
    note: 'Perplexity search requires PERPLEXITY_API_KEY and execution by host environment',
  };
};
