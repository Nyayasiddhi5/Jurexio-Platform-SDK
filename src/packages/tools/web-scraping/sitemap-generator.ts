// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Sitemap Generator Tool
 * Generate and parse XML sitemaps for SEO
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Sitemap Generator Tool Definition
 */
export const sitemapGeneratorTool: Tool = {
  id: 'sitemap_generator',
  name: 'Sitemap Generator',
  description: 'Generate or parse XML sitemaps: create from URLs, parse existing sitemaps, validate format',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'Sitemap action',
      required: true,
      enum: ['generate', 'parse', 'validate'],
    },
    {
      name: 'data',
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      type: 'any',
      description: 'URLs array (for generate) or XML string (for parse/validate)',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Generation/parsing options',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Generated sitemap XML or parsed URLs',
  },
  examples: [
    {
      input: {
        action: 'generate',
        data: [
          { url: 'https://example.com/', priority: 1.0, changefreq: 'daily' },
          { url: 'https://example.com/about', priority: 0.8, changefreq: 'weekly' },
        ],
      },
      output: {
        success: true,
        xml: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>...</urlset>',
      },
    },
  ],
};

/**
 * Generate sitemap XML
 */
const generateSitemap = (urls: any[], options: any = {}): string => {
  const xmlns = options.xmlns || 'http://www.sitemaps.org/schemas/sitemap/0.9';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<urlset xmlns="${xmlns}">\n`;

  for (const entry of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(entry.url)}</loc>\n`;

    if (entry.lastmod) {
      xml += `    <lastmod>${entry.lastmod}</lastmod>\n`;
    }

    if (entry.changefreq) {
      xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
    }

    if (entry.priority !== undefined) {
      xml += `    <priority>${entry.priority}</priority>\n`;
    }

    xml += '  </url>\n';
  }

  xml += '</urlset>';

  return xml;
};

/**
 * Parse sitemap XML
 */
const parseSitemap = (xml: string): any[] => {
  const urls: any[] = [];

  // Extract URL blocks
  const urlRegex = /<url>(.*?)<\/url>/gs;
  let urlMatch;

  while ((urlMatch = urlRegex.exec(xml)) !== null) {
    const urlBlock = urlMatch[1];

    const entry: any = {};

    // Extract loc
    const locMatch = urlBlock.match(/<loc>([^<]+)<\/loc>/);
    if (locMatch) entry.url = unescapeXml(locMatch[1].trim());

    // Extract lastmod
    const lastmodMatch = urlBlock.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (lastmodMatch) entry.lastmod = lastmodMatch[1].trim();

    // Extract changefreq
    const changefreqMatch = urlBlock.match(/<changefreq>([^<]+)<\/changefreq>/);
    if (changefreqMatch) entry.changefreq = changefreqMatch[1].trim();

    // Extract priority
    const priorityMatch = urlBlock.match(/<priority>([^<]+)<\/priority>/);
    if (priorityMatch) entry.priority = parseFloat(priorityMatch[1].trim());

    if (entry.url) {
      urls.push(entry);
    }
  }

  return urls;
};

/**
 * Validate sitemap XML
 */
const validateSitemap = (xml: string): any => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check XML declaration
  if (!xml.trim().startsWith('<?xml')) {
    errors.push('Missing XML declaration');
  }

  // Check urlset tag
  if (!xml.includes('<urlset')) {
    errors.push('Missing <urlset> tag');
  }

  // Check namespace
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    warnings.push('Missing or incorrect xmlns namespace');
  }

  // Parse URLs
  const urls = parseSitemap(xml);

  if (urls.length === 0) {
    errors.push('No valid URLs found in sitemap');
  }

  // Validate URLs
  for (const [index, entry] of urls.entries()) {
    if (!entry.url) {
      errors.push(`URL #${index + 1}: Missing <loc> tag`);
      continue;
    }

    // Validate URL format
    try {
      new URL(entry.url);
    } catch (error: any) {
      errors.push(`URL #${index + 1}: Invalid URL format: ${entry.url}`);
    }

    // Validate changefreq
    if (entry.changefreq) {
      const validFreqs = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
      if (!validFreqs.includes(entry.changefreq)) {
        warnings.push(`URL #${index + 1}: Invalid changefreq: ${entry.changefreq}`);
      }
    }

    // Validate priority
    if (entry.priority !== undefined) {
      if (entry.priority < 0 || entry.priority > 1) {
        warnings.push(`URL #${index + 1}: Priority should be between 0.0 and 1.0`);
      }
    }
  }

  // Check size limit (50,000 URLs)
  if (urls.length > 50000) {
    errors.push(`Sitemap exceeds 50,000 URL limit (found ${urls.length})`);
  }

  return {
    valid: errors.length === 0,
    urlCount: urls.length,
    errors,
    warnings,
  };
};

/**
 * Escape XML special characters
 */
const escapeXml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/**
 * Unescape XML special characters
 */
const unescapeXml = (str: string): string => {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

/**
 * Sitemap Generator Executor
 */
export const sitemapGeneratorExecutor: ToolExecutor = async (params) => {
  const { action, data, options = {} } = params;

  if (!data) {
    return {
      success: false,
      error: 'data is required',
    };
  }

  try {
    switch (action) {
      case 'generate': {
        if (!Array.isArray(data)) {
          return { success: false, error: 'data must be an array of URLs for generate action' };
        }

        const xml = generateSitemap(data, options);
        return {
          success: true,
          action: 'generate',
          xml,
          urlCount: data.length,
        };
      }

      case 'parse': {
        if (typeof data !== 'string') {
          return { success: false, error: 'data must be XML string for parse action' };
        }

        const urls = parseSitemap(data);
        return {
          success: true,
          action: 'parse',
          urls,
          urlCount: urls.length,
        };
      }

      case 'validate': {
        if (typeof data !== 'string') {
          return { success: false, error: 'data must be XML string for validate action' };
        }

        const validation = validateSitemap(data);
        return {
          success: true,
          action: 'validate',
          ...validation,
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
