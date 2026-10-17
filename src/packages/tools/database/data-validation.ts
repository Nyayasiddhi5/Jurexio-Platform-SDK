/**
 * Data Validation Tool
 * Schema validation, type checking, and data sanitization
 */

import { z } from 'zod';
import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Data Validation Tool Definition
 */
export const dataValidationTool: Tool = {
  id: 'data_validation',
  name: 'Data Validation',
  description: 'Validate data against schemas, check types, and sanitize inputs',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Validation operation',
      required: true,
      enum: ['validate', 'type_check', 'sanitize', 'email', 'url', 'phone', 'credit_card'],
    },
    {
      name: 'data',
      type: 'object',
      description: 'Data to validate',
      required: true,
    },
    {
      name: 'schema',
      type: 'object',
      description: 'Validation schema (Zod-like format)',
      required: false,
    },
    {
      name: 'expectedType',
      type: 'string',
      description: 'Expected data type',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Validation result with errors if any',
  },
  examples: [
    {
      input: {
        operation: 'email',
        data: 'user@example.com',
      },
      output: { success: true, valid: true },
    },
    {
      input: {
        operation: 'validate',
        data: { name: 'John', age: 30 },
        schema: { name: 'string', age: 'number' },
      },
      output: { success: true, valid: true },
    },
  ],
};

/**
 * Data Validation Executor
 */
export const dataValidationExecutor: ToolExecutor = async (params) => {
  const { operation, data, schema, expectedType } = params;

  try {
    switch (operation) {
      case 'validate': {
        if (!schema) {
          throw new Error('Schema is required for validate operation');
        }
        const zodSchema = buildZodSchema(schema);
        const result = zodSchema.safeParse(data);
        return {
          success: true,
          valid: result.success,
          errors: result.success ? undefined : result.error.issues,
          data: result.success ? result.data : undefined,
        };
      }

      case 'type_check': {
        if (!expectedType) {
          throw new Error('ExpectedType is required for type_check operation');
        }
        const actualType = Array.isArray(data) ? 'array' : typeof data;
        const valid = actualType === expectedType;
        return {
          success: true,
          valid,
          actualType,
          expectedType,
        };
      }

      case 'sanitize': {
        const sanitized = sanitizeData(data);
        return {
          success: true,
          result: sanitized,
          original: data,
        };
      }

      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const valid = typeof data === 'string' && emailRegex.test(data);
        return {
          success: true,
          valid,
          email: valid ? data : undefined,
        };
      }

      case 'url': {
        try {
          const url = new URL(data as string);
          return {
            success: true,
            valid: true,
            url: url.href,
            protocol: url.protocol,
            host: url.host,
          };
        } catch {
          return {
            success: true,
            valid: false,
          };
        }
      }

      case 'phone': {
        // Basic international phone validation
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        const cleaned = String(data).replace(/[\s\-()]/g, '');
        const valid = phoneRegex.test(cleaned);
        return {
          success: true,
          valid,
          cleaned: valid ? cleaned : undefined,
        };
      }

      case 'credit_card': {
        const cleaned = String(data).replace(/[\s\-]/g, '');
        const valid = luhnCheck(cleaned);
        return {
          success: true,
          valid,
          masked: valid ? maskCreditCard(cleaned) : undefined,
        };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error: any) {
    throw new Error(`Data validation failed: ${error.message}`);
  }
};

/**
 * Build Zod schema from simple object definition
 */
function buildZodSchema(schemaObj: any): z.ZodSchema {
  if (typeof schemaObj === 'string') {
    switch (schemaObj) {
      case 'string': return z.string();
      case 'number': return z.number();
      case 'boolean': return z.boolean();
      case 'array': return z.array(z.any());
      case 'object': return z.object({});
      default: return z.any();
    }
  }

  if (typeof schemaObj === 'object' && !Array.isArray(schemaObj)) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const key in schemaObj) {
      shape[key] = buildZodSchema(schemaObj[key]);
    }
    return z.object(shape);
  }

  return z.any();
}

/**
 * Sanitize data by removing dangerous characters
 */
function sanitizeData(data: any): any {
  if (typeof data === 'string') {
    return data
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  if (typeof data === 'object' && data !== null) {
    const sanitized: any = {};
    for (const key in data) {
      sanitized[key] = sanitizeData(data[key]);
    }
    return sanitized;
  }

  return data;
}

/**
 * Luhn algorithm for credit card validation
 */
function luhnCheck(cardNumber: string): boolean {
  if (!/^\d+$/.test(cardNumber)) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Mask credit card number
 */
function maskCreditCard(cardNumber: string): string {
  if (cardNumber.length < 4) {
    return cardNumber;
  }
  const lastFour = cardNumber.slice(-4);
  const masked = '*'.repeat(cardNumber.length - 4);
  return masked + lastFour;
}
