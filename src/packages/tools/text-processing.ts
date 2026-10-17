// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Text Processing Tool
 * Search, replace, format, sanitize, and extract text data
 */

import { Tool, ToolExecutor } from '../protocols/mcp/index.js';

/**
 * Text Processing Tool Definition
 */
export const textProcessingTool: Tool = {
  id: 'text_processing',
  name: 'Text Processing',
  description: 'Search, replace, format, sanitize, extract, and manipulate text data',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Operation to perform',
      required: true,
      enum: ['search', 'replace', 'format', 'sanitize', 'extract', 'split', 'join', 'case', 'trim'],
    },
    {
      name: 'text',
      type: 'string',
      description: 'Input text',
      required: true,
    },
    {
      name: 'pattern',
      type: 'string',
      description: 'Search/replace pattern (regex supported)',
      required: false,
    },
    {
      name: 'replacement',
      type: 'string',
      description: 'Replacement text (for replace operation)',
      required: false,
    },
    {
      name: 'separator',
      type: 'string',
      description: 'Separator for split/join operations',
      required: false,
    },
    {
      name: 'caseType',
      type: 'string',
      description: 'Case transformation type',
      required: false,
      enum: ['upper', 'lower', 'title', 'camel', 'snake', 'kebab'],
    },
    {
      name: 'flags',
      type: 'string',
      description: 'Regex flags (e.g., "gi" for global, case-insensitive)',
      required: false,
      default: 'g',
    },
  ],
  returns: {
    type: 'object',
    description: 'Processing result',
  },
  examples: [
    {
      input: { operation: 'replace', text: 'Hello World', pattern: 'World', replacement: 'Universe' },
      output: { success: true, result: 'Hello Universe' },
    },
    {
      input: { operation: 'case', text: 'hello world', caseType: 'title' },
      output: { success: true, result: 'Hello World' },
    },
  ],
};

/**
 * Text Processing Executor
 */
export const textProcessingExecutor: ToolExecutor = async (params) => {
  const { operation, text, pattern, replacement, separator, caseType, flags = 'g' } = params;

  try {
    switch (operation) {
      case 'search': {
        if (!pattern) {
          throw new Error('Pattern is required for search operation');
        }
        const regex = new RegExp(pattern, flags);
        const matches = text.match(regex) || [];
        return {
          success: true,
          matches,
          count: matches.length,
          found: matches.length > 0,
        };
      }

      case 'replace': {
        if (!pattern) {
          throw new Error('Pattern is required for replace operation');
        }
        const regex = new RegExp(pattern, flags);
        const result = text.replace(regex, replacement || '');
        return {
          success: true,
          result,
          original: text,
        };
      }

      case 'format': {
        // Basic formatting: normalize whitespace, trim
        const result = text.replace(/\s+/g, ' ').trim();
        return {
          success: true,
          result,
        };
      }

      case 'sanitize': {
        // Remove HTML tags and dangerous characters
        const result = text
          .replace(/<[^>]*>/g, '')
          .replace(/[<>'"]/g, '')
          .trim();
        return {
          success: true,
          result,
          original: text,
        };
      }

      case 'extract': {
        if (!pattern) {
          throw new Error('Pattern is required for extract operation');
        }
        const regex = new RegExp(pattern, flags);
        const matches = [...text.matchAll(regex)];
        const extracted = matches.map(m => ({
          match: m[0],
          groups: m.slice(1),
          index: m.index,
        }));
        return {
          success: true,
          extracted,
          count: extracted.length,
        };
      }

      case 'split': {
        const sep = separator || ' ';
        const result = text.split(sep);
        return {
          success: true,
          result,
          count: result.length,
        };
      }

      case 'join': {
        if (!Array.isArray(text)) {
          throw new Error('Text must be an array for join operation');
        }
        const sep = separator || ' ';
        const result = text.join(sep);
        return {
          success: true,
          result,
        };
      }

      case 'case': {
        if (!caseType) {
          throw new Error('CaseType is required for case operation');
        }
        let result: string;
        switch (caseType) {
          case 'upper':
            result = text.toUpperCase();
            break;
          case 'lower':
            result = text.toLowerCase();
            break;
          case 'title':
            result = text.replace(/\b\w/g, (l: string) => l.toUpperCase());
            break;
          case 'camel':
            result = text.replace(/[-_\s]+(.)?/g, (_: string, c?: string) => c ? c.toUpperCase() : '');
            break;
          case 'snake':
            result = text.replace(/\s+/g, '_').toLowerCase();
            break;
          case 'kebab':
            result = text.replace(/\s+/g, '-').toLowerCase();
            break;
          default:
            throw new Error(`Unknown case type: ${caseType}`);
        }
        return {
          success: true,
          result,
          original: text,
        };
      }

      case 'trim': {
        const result = text.trim();
        return {
          success: true,
          result,
          removed: text.length - result.length,
        };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error: any) {
    throw new Error(`Text processing failed: ${error.message}`);
  }
};
