/**
 * Random Data Generation Tool
 * Generate UUIDs, random strings, numbers, dates, and mock data
 */

import { randomBytes } from 'crypto';
import { secureRandom, secureRandomChoice } from '../../utils/jrx-secure-random.js';
import { Tool, ToolExecutor } from '../protocols/mcp/index.js';

/**
 * Random Generation Tool Definition
 */
export const randomGenerationTool: Tool = {
  id: 'random_generation',
  name: 'Random Data Generation',
  description: 'Generate random UUIDs, strings, numbers, dates, and mock data',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'Type of random data to generate',
      required: true,
      enum: ['uuid', 'string', 'number', 'date', 'boolean', 'array', 'color', 'email', 'name'],
    },
    {
      name: 'length',
      type: 'number',
      description: 'Length for string/array generation',
      required: false,
      default: 10,
    },
    {
      name: 'min',
      type: 'number',
      description: 'Minimum value for number/date range',
      required: false,
    },
    {
      name: 'max',
      type: 'number',
      description: 'Maximum value for number/date range',
      required: false,
    },
    {
      name: 'charset',
      type: 'string',
      description: 'Character set for string generation',
      required: false,
      enum: ['alphanumeric', 'alpha', 'numeric', 'hex', 'base64'],
      default: 'alphanumeric',
    },
    {
      name: 'count',
      type: 'number',
      description: 'Number of items to generate',
      required: false,
      default: 1,
    },
  ],
  returns: {
    type: 'object',
    description: 'Generated random data',
  },
  examples: [
    {
      input: { type: 'uuid' },
      output: { success: true, result: '550e8400-e29b-41d4-a716-446655440000' },
    },
    {
      input: { type: 'string', length: 16, charset: 'alphanumeric' },
      output: { success: true, result: 'A7fG9kL2mN4pQ8rT' },
    },
  ],
};

/**
 * Random Generation Executor
 */
export const randomGenerationExecutor: ToolExecutor = async (params) => {
  const { type, length = 10, min, max, charset = 'alphanumeric', count = 1 } = params;

  try {
    const results: any[] = [];

    for (let i = 0; i < count; i++) {
      let result: any;

      switch (type) {
        case 'uuid': {
          result = generateUUID();
          break;
        }

        case 'string': {
          result = generateRandomString(length, charset);
          break;
        }

        case 'number': {
          const minVal = min ?? 0;
          const maxVal = max ?? 100;
          result = secureRandom() * (maxVal - minVal) + minVal;
          break;
        }

        case 'date': {
          const minTime = min ?? Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
          const maxTime = max ?? Date.now();
          const randomTime = secureRandom() * (maxTime - minTime) + minTime;
          result = new Date(randomTime).toISOString();
          break;
        }

        case 'boolean': {
          result = secureRandom() < 0.5;
          break;
        }

        case 'array': {
          result = Array.from({ length }, () => secureRandom());
          break;
        }

        case 'color': {
          result = `#${Math.floor(secureRandom() * 16777215).toString(16).padStart(6, '0')}`;
          break;
        }

        case 'email': {
          const name = generateRandomString(8, 'alpha').toLowerCase();
          const domain = generateRandomString(6, 'alpha').toLowerCase();
          result = `${name}@${domain}.com`;
          break;
        }

        case 'name': {
          const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
          const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
          const firstName = secureRandomChoice(firstNames);
          const lastName = secureRandomChoice(lastNames);
          result = `${firstName} ${lastName}`;
          break;
        }

        default:
          throw new Error(`Unknown type: ${type}`);
      }

      results.push(result);
    }

    return {
      success: true,
      result: count === 1 ? results[0] : results,
      type,
      count,
    };
  } catch (error: any) {
    throw new Error(`Random generation failed: ${error.message}`);
  }
};

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant

  const hex = bytes.toString('hex');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Generate random string with specified charset
 */
function generateRandomString(length: number, charset: string): string {
  const charsets: Record<string, string> = {
    alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    numeric: '0123456789',
    hex: '0123456789abcdef',
    base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  };

  const chars = charsets[charset] || charsets.alphanumeric;
  const bytes = randomBytes(length);
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }

  return result;
}
