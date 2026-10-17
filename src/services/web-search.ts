export class WebSearchService {
  async search(options: { query: string; providers?: string[]; maxResults?: number }) {
    return {
      query: options.query,
      results: [],
      providers: options.providers || ['perplexity'],
      timestamp: new Date().toISOString()
    };
  }
}
