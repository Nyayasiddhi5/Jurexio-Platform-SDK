// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Data Cleaning Tool
 * Clean, normalize, deduplicate, and transform data
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Data Cleaning Tool Definition
 */
export const dataCleaningTool: Tool = {
  id: 'data_cleaning',
  name: 'Data Cleaning',
  description: 'Clean, normalize, deduplicate, filter, and transform data with validation',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Cleaning operation to perform',
      required: true,
      enum: ['removeNulls', 'removeDuplicates', 'trimWhitespace', 'normalizeCase', 'fillMissing', 'filterRows', 'removeOutliers', 'validateSchema'],
    },
    {
      name: 'data',
      type: 'array',
      description: 'Array of objects to clean',
      required: true,
    },
    {
      name: 'fields',
      type: 'array',
      description: 'Fields to apply operation to (optional, applies to all if not specified)',
      required: false,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Operation-specific options',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Cleaned data with statistics',
  },
  examples: [
    {
      input: {
        operation: 'removeNulls',
        data: [
          { name: 'Alice', age: 30 },
          { name: null, age: 25 },
          { name: 'Bob', age: null },
        ],
      },
      output: {
        success: true,
        data: [{ name: 'Alice', age: 30 }],
        removed: 2,
      },
    },
    {
      input: {
        operation: 'removeDuplicates',
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
        fields: ['name'],
      },
      output: {
        success: true,
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
        removed: 1,
      },
    },
  ],
};

/**
 * Data Cleaning Executor
 */
export const dataCleaningExecutor: ToolExecutor = async (params) => {
  const { operation, data, fields, options = {} } = params;

  if (!Array.isArray(data)) {
    return {
      success: false,
      error: 'Data must be an array of objects',
    };
  }

  try {
    switch (operation) {
      case 'removeNulls': {
        const cleaned = data.filter((row) => {
          const fieldsToCheck = fields || Object.keys(row);
          return fieldsToCheck.every((field: string) => row[field] !== null && row[field] !== undefined);
        });

        return {
          success: true,
          data: cleaned,
          original: data.length,
          cleaned: cleaned.length,
          removed: data.length - cleaned.length,
        };
      }

      case 'removeDuplicates': {
        const seen = new Set<string>();
        const cleaned = data.filter((row) => {
          const fieldsToCheck = fields || Object.keys(row);
          const key = fieldsToCheck.map((f: string) => row[f]).join('|');
          
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });

        return {
          success: true,
          data: cleaned,
          original: data.length,
          cleaned: cleaned.length,
          removed: data.length - cleaned.length,
        };
      }

      case 'trimWhitespace': {
        const cleaned = data.map((row) => {
          const newRow = { ...row };
          const fieldsToTrim = fields || Object.keys(row);
          
          for (const field of fieldsToTrim) {
            if (typeof newRow[field] === 'string') {
              newRow[field] = newRow[field].trim();
            }
          }
          
          return newRow;
        });

        return {
          success: true,
          data: cleaned,
          rowCount: cleaned.length,
        };
      }

      case 'normalizeCase': {
        const caseType = options.case || 'lower'; // 'lower', 'upper', 'title'
        const cleaned = data.map((row) => {
          const newRow = { ...row };
          const fieldsToNormalize = fields || Object.keys(row);
          
          for (const field of fieldsToNormalize) {
            if (typeof newRow[field] === 'string') {
              if (caseType === 'lower') {
                newRow[field] = newRow[field].toLowerCase();
              } else if (caseType === 'upper') {
                newRow[field] = newRow[field].toUpperCase();
              } else if (caseType === 'title') {
                newRow[field] = newRow[field]
                  .toLowerCase()
                  .split(' ')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ');
              }
            }
          }
          
          return newRow;
        });

        return {
          success: true,
          data: cleaned,
          rowCount: cleaned.length,
          caseType,
        };
      }

      case 'fillMissing': {
        const fillValue = options.fillValue !== undefined ? options.fillValue : '';
        const cleaned = data.map((row) => {
          const newRow = { ...row };
          const fieldsToFill = fields || Object.keys(row);
          
          for (const field of fieldsToFill) {
            if (newRow[field] === null || newRow[field] === undefined || newRow[field] === '') {
              newRow[field] = fillValue;
            }
          }
          
          return newRow;
        });

        return {
          success: true,
          data: cleaned,
          rowCount: cleaned.length,
          fillValue,
        };
      }

      case 'filterRows': {
        const condition = options.condition;
        if (!condition || typeof condition !== 'function') {
          throw new Error('Condition function is required for filterRows operation');
        }

        const cleaned = data.filter(condition);

        return {
          success: true,
          data: cleaned,
          original: data.length,
          filtered: cleaned.length,
          removed: data.length - cleaned.length,
        };
      }

      case 'removeOutliers': {
        const field = options.field;
        if (!field) {
          throw new Error('Field is required for removeOutliers operation');
        }

        const values = data.map((row) => row[field]).filter((v) => typeof v === 'number');
        
        if (values.length === 0) {
          throw new Error('No numeric values found for outlier detection');
        }

        const sorted = values.sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        const cleaned = data.filter((row) => {
          const value = row[field];
          return typeof value === 'number' && value >= lowerBound && value <= upperBound;
        });

        return {
          success: true,
          data: cleaned,
          original: data.length,
          cleaned: cleaned.length,
          removed: data.length - cleaned.length,
          bounds: { lower: lowerBound, upper: upperBound },
        };
      }

      case 'validateSchema': {
        const schema = options.schema;
        if (!schema) {
          throw new Error('Schema is required for validateSchema operation');
        }

        const errors: any[] = [];
        const valid = data.filter((row, index) => {
          const rowErrors: any[] = [];
          
          for (const [field, rules] of Object.entries(schema)) {
            const value = row[field];
            
            if ((rules as any).required && (value === null || value === undefined)) {
              rowErrors.push({ row: index, field, error: 'Required field is missing' });
            }
            
            if ((rules as any).type && value !== null && value !== undefined) {
              const actualType = typeof value;
              if (actualType !== (rules as any).type) {
                rowErrors.push({ row: index, field, error: `Expected type ${(rules as any).type}, got ${actualType}` });
              }
            }
          }
          
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            return false;
          }
          return true;
        });

        return {
          success: true,
          data: valid,
          original: data.length,
          valid: valid.length,
          invalid: data.length - valid.length,
          errors: errors.length > 0 ? errors : undefined,
        };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
