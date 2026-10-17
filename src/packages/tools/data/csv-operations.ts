// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * CSV Operations Tool
 * Parse, generate, and manipulate CSV data using Papa Parse
 */

import Papa from 'papaparse';
import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * CSV Operations Tool Definition
 */
export const csvOperationsTool: Tool = {
  id: 'csv_operations',
  name: 'CSV Operations',
  description: 'Parse CSV to JSON, generate CSV from JSON, validate CSV, and transform CSV data',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Operation to perform',
      required: true,
      enum: ['parse', 'generate', 'validate', 'transform', 'analyze'],
    },
    {
      name: 'data',
      type: 'string',
      description: 'CSV string data (for parse/validate operations) or JSON data (for generate)',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Parsing/generation options',
      required: false,
    },
    {
      name: 'delimiter',
      type: 'string',
      description: 'Field delimiter (default: ",")',
      required: false,
      default: ',',
    },
    {
      name: 'header',
      type: 'boolean',
      description: 'Whether first row is header (default: true)',
      required: false,
      default: true,
    },
  ],
  returns: {
    type: 'object',
    description: 'Operation result with parsed/generated data',
  },
  examples: [
    {
      input: {
        operation: 'parse',
        data: 'name,age\nAlice,30\nBob,25',
        header: true,
      },
      output: {
        success: true,
        data: [
          { name: 'Alice', age: '30' },
          { name: 'Bob', age: '25' },
        ],
        meta: { fields: ['name', 'age'], rowCount: 2 },
      },
    },
    {
      input: {
        operation: 'generate',
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      },
      output: {
        success: true,
        csv: 'name,age\nAlice,30\nBob,25\n',
      },
    },
  ],
};

/**
 * CSV Operations Executor
 */
export const csvOperationsExecutor: ToolExecutor = async (params) => {
  const { operation, data, options = {}, delimiter = ',', header = true } = params;

  try {
    switch (operation) {
      case 'parse': {
        const parseOptions = {
          header,
          delimiter,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim(),
          ...options,
        };

        const result = Papa.parse(data, parseOptions);

        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        if (result.errors.length > 0) {
          return {
            success: false,
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            errors: result.errors,
            message: 'CSV parsing encountered errors',
          };
        }

        return {
          success: true,
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          data: result.data,
          meta: {
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            fields: result.meta.fields,
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            rowCount: result.data.length,
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            delimiter: result.meta.delimiter,
          },
        };
      }

      case 'generate': {
        let parsedData = data;
        if (typeof data === 'string') {
          try {
            parsedData = JSON.parse(data);
          } catch (e: any) {
            throw new Error('Invalid JSON data for CSV generation');
          }
        }

        const csv = Papa.unparse(parsedData, {
          delimiter,
          header,
          ...options,
        });

        return {
          success: true,
          csv,
          size: csv.length,
          rows: Array.isArray(parsedData) ? parsedData.length : 1,
        };
      }

      case 'validate': {
        const parseResult = Papa.parse(data, {
          header,
          delimiter,
          skipEmptyLines: true,
        });

        const isValid = parseResult.errors.length === 0;
        const warnings: string[] = [];

        if (parseResult.data.length === 0) {
          warnings.push('CSV file is empty');
        }

        return {
          success: true,
          valid: isValid,
          errors: parseResult.errors,
          warnings,
          meta: {
            fields: parseResult.meta.fields,
            rowCount: parseResult.data.length,
          },
        };
      }

      case 'transform': {
        const parseResult = Papa.parse(data, {
          header,
          delimiter,
          skipEmptyLines: true,
        });

        if (parseResult.errors.length > 0) {
          throw new Error('Invalid CSV data for transformation');
        }

        const transformedData = parseResult.data;
        const transformedCsv = Papa.unparse(transformedData, {
          delimiter,
          header,
        });

        return {
          success: true,
          data: transformedData,
          csv: transformedCsv,
          rowCount: transformedData.length,
        };
      }

      case 'analyze': {
        const parseResult = Papa.parse(data, {
          header,
          delimiter,
          skipEmptyLines: true,
          ...options,
        });

        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        if (parseResult.errors.length > 0) {
          throw new Error('Invalid CSV data for analysis');
        }

        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        const rows = parseResult.data;
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        const fields = parseResult.meta.fields || [];
        const stats: Record<string, any> = {};

        for (const field of fields) {
          // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
          const values = rows.map((row: any) => row[field]).filter(v => v !== undefined && v !== '');
          // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
          const numericValues = values.map(Number).filter(n => !isNaN(n));
          
          stats[field] = {
            totalValues: values.length,
            uniqueValues: new Set(values).size,
            nullCount: rows.length - values.length,
            isNumeric: numericValues.length === values.length && numericValues.length > 0,
          };

          if (stats[field].isNumeric) {
            stats[field].min = Math.min(...numericValues);
            stats[field].max = Math.max(...numericValues);
            // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
            stats[field].avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
          }
        }

        return {
          success: true,
          rowCount: rows.length,
          columnCount: fields.length,
          fields,
          statistics: stats,
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
