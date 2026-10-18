// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Pivot Table Tool
 * Create pivot tables and aggregations from data
 * 
 * CURRENT LIMITATION: Multi-column dimensions are flattened (e.g., "North|Q1")
 * instead of hierarchical nesting. Full hierarchical support planned for Phase 2.
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Pivot Table Tool Definition
 */
export const pivotTableTool: Tool = {
  id: 'pivot_table',
  name: 'Pivot Table',
  description: 'Create pivot tables with grouping, aggregation, and cross-tabulation. Note: Multi-column dimensions are currently flattened.',
  parameters: [
    {
      name: 'data',
      type: 'array',
      description: 'Array of objects to pivot',
      required: true,
    },
    {
      name: 'rows',
      type: 'array',
      description: 'Fields to use as row dimensions',
      required: true,
    },
    {
      name: 'columns',
      type: 'array',
      description: 'Fields to use as column dimensions',
      required: false,
    },
    {
      name: 'values',
      type: 'array',
      description: 'Fields to aggregate',
      required: true,
    },
    {
      name: 'aggregation',
      type: 'string',
      description: 'Aggregation function',
      required: false,
      enum: ['sum', 'avg', 'count', 'min', 'max', 'first', 'last'],
      default: 'sum',
    },
    {
      name: 'fillValue',
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      type: 'any',
      description: 'Value to use for missing data',
      required: false,
      default: 0,
    },
  ],
  returns: {
    type: 'object',
    description: 'Pivot table result with aggregated data',
  },
  examples: [
    {
      input: {
        data: [
          { region: 'East', product: 'A', sales: 100 },
          { region: 'East', product: 'B', sales: 150 },
          { region: 'West', product: 'A', sales: 200 },
        ],
        rows: ['region'],
        columns: ['product'],
        values: ['sales'],
        aggregation: 'sum',
      },
      output: {
        success: true,
        pivot: {
          East: { A: 100, B: 150 },
          West: { A: 200, B: 0 },
        },
      },
    },
  ],
};

/**
 * Aggregation functions
 */
const aggregators: Record<string, (values: number[]) => number> = {
  sum: (values) => values.reduce((a, b) => a + b, 0),
  avg: (values) => values.reduce((a, b) => a + b, 0) / values.length,
  count: (values) => values.length,
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  first: (values) => values[0],
  last: (values) => values[values.length - 1],
};

/**
 * Pivot Table Executor
 */
export const pivotTableExecutor: ToolExecutor = async (params) => {
  const { data, rows, columns, values, aggregation = 'sum', fillValue = 0 } = params;

  if (!Array.isArray(data)) {
    return {
      success: false,
      error: 'Data must be an array of objects',
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      success: false,
      error: 'Rows parameter must be a non-empty array',
    };
  }

  if (!Array.isArray(values) || values.length === 0) {
    return {
      success: false,
      error: 'Values parameter must be a non-empty array',
    };
  }

  try {
    const aggregatorFn = aggregators[aggregation];
    if (!aggregatorFn) {
      throw new Error(`Unknown aggregation function: ${aggregation}`);
    }

    if (!columns || columns.length === 0) {
      // Simple grouping without columns
      const result: Record<string, any> = {};

      for (const row of data) {
        const key = rows.map((r) => row[r]).join('|');
        
        if (!result[key]) {
          result[key] = {};
          for (const r of rows) {
            result[key][r] = row[r];
          }
          for (const v of values) {
            result[key][v] = [];
          }
        }

        for (const v of values) {
          if (row[v] !== null && row[v] !== undefined) {
            result[key][v].push(row[v]);
          }
        }
      }

      // Apply aggregation
      const aggregated: any[] = [];
      for (const entry of Object.values(result)) {
        const aggregatedEntry: Record<string, any> = {};
        
        for (const r of rows) {
          aggregatedEntry[r] = entry[r];
        }
        
        for (const v of values) {
          const vals = entry[v] || [];
          aggregatedEntry[v] = vals.length > 0 ? aggregatorFn(vals) : fillValue;
        }
        
        aggregated.push(aggregatedEntry);
      }

      return {
        success: true,
        data: aggregated,
        rowCount: aggregated.length,
        aggregation,
      };
    }

    // Full pivot table with rows and columns
    const pivot: Record<string, Record<string, any>> = {};
    const columnValues = new Set<string>();

    // Collect all column values
    for (const row of data) {
      const colKey = columns.map((c) => row[c]).join('|');
      columnValues.add(colKey);
    }

    // Build pivot structure
    for (const row of data) {
      const rowKey = rows.map((r) => row[r]).join('|');
      const colKey = columns.map((c) => row[c]).join('|');

      if (!pivot[rowKey]) {
        pivot[rowKey] = {};
        for (const r of rows) {
          pivot[rowKey][`_${r}`] = row[r];
        }
      }

      if (!pivot[rowKey][colKey]) {
        pivot[rowKey][colKey] = {};
        for (const v of values) {
          pivot[rowKey][colKey][v] = [];
        }
      }

      for (const v of values) {
        if (row[v] !== null && row[v] !== undefined) {
          if (!pivot[rowKey][colKey][v]) {
            pivot[rowKey][colKey][v] = [];
          }
          pivot[rowKey][colKey][v].push(row[v]);
        }
      }
    }

    // Apply aggregation and fill missing values
    const result: Record<string, Record<string, any>> = {};
    
    for (const [rowKey, rowData] of Object.entries(pivot)) {
      result[rowKey] = {};
      
      // Aggregate column values (do NOT copy row metadata to avoid duplication)
      for (const colKey of columnValues) {
        if (values.length === 1) {
          // Single value: use column name directly
          const v = values[0];
          if (rowData[colKey] && rowData[colKey][v]) {
            const vals = rowData[colKey][v];
            result[rowKey][colKey] = vals.length > 0 ? aggregatorFn(vals) : fillValue;
          } else {
            result[rowKey][colKey] = fillValue;
          }
        } else {
          // Multiple values: nest under column name
          result[rowKey][colKey] = {};
          if (rowData[colKey]) {
            for (const v of values) {
              const vals = rowData[colKey][v] || [];
              result[rowKey][colKey][v] = vals.length > 0 ? aggregatorFn(vals) : fillValue;
            }
          } else {
            for (const v of values) {
              result[rowKey][colKey][v] = fillValue;
            }
          }
        }
      }
    }

    return {
      success: true,
      pivot: result,
      rowCount: Object.keys(result).length,
      columnCount: columnValues.size,
      aggregation,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
