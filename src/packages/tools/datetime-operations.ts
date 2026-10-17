/**
 * Date/Time Operations Tool
 * Parse, format, calculate, and convert dates/times with timezone support
 */

import { format, parse, add, sub, differenceInDays, isValid, parseISO } from 'date-fns';
import { Tool, ToolExecutor } from '../protocols/mcp/index.js';

/**
 * Date/Time Operations Tool Definition
 */
export const datetimeOperationsTool: Tool = {
  id: 'datetime_operations',
  name: 'Date/Time Operations',
  description: 'Parse, format, calculate, and manipulate dates and times',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Operation to perform',
      required: true,
      enum: ['now', 'parse', 'format', 'add', 'subtract', 'diff', 'validate'],
    },
    {
      name: 'date',
      type: 'string',
      description: 'Input date (ISO string or formatted)',
      required: false,
    },
    {
      name: 'formatString',
      type: 'string',
      description: 'Date format string (e.g., "yyyy-MM-dd")',
      required: false,
    },
    {
      name: 'amount',
      type: 'number',
      description: 'Amount to add/subtract',
      required: false,
    },
    {
      name: 'unit',
      type: 'string',
      description: 'Time unit',
      required: false,
      enum: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'],
    },
    {
      name: 'compareDate',
      type: 'string',
      description: 'Date to compare with (for diff operation)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Date/time operation result',
  },
  examples: [
    {
      input: { operation: 'now' },
      output: { success: true, result: '2025-01-15T12:00:00Z' },
    },
    {
      input: { operation: 'format', date: '2025-01-15', formatString: 'MMM dd, yyyy' },
      output: { success: true, result: 'Jan 15, 2025' },
    },
  ],
};

/**
 * Date/Time Operations Executor
 */
export const datetimeOperationsExecutor: ToolExecutor = async (params) => {
  const { operation, date, formatString, amount, unit, compareDate } = params;

  try {
    switch (operation) {
      case 'now': {
        const now = new Date();
        return {
          success: true,
          result: now.toISOString(),
          timestamp: now.getTime(),
          formatted: format(now, 'yyyy-MM-dd HH:mm:ss'),
        };
      }

      case 'parse': {
        if (!date) {
          throw new Error('Date is required for parse operation');
        }
        const parsed = parseISO(date);
        if (!isValid(parsed)) {
          throw new Error('Invalid date format');
        }
        return {
          success: true,
          result: parsed.toISOString(),
          timestamp: parsed.getTime(),
        };
      }

      case 'format': {
        if (!date || !formatString) {
          throw new Error('Date and formatString are required for format operation');
        }
        const dateObj = parseISO(date);
        if (!isValid(dateObj)) {
          throw new Error('Invalid date');
        }
        const result = format(dateObj, formatString);
        return {
          success: true,
          result,
          original: date,
        };
      }

      case 'add': {
        if (!date || amount === undefined || !unit) {
          throw new Error('Date, amount, and unit are required for add operation');
        }
        const dateObj = parseISO(date);
        if (!isValid(dateObj)) {
          throw new Error('Invalid date');
        }
        const result = add(dateObj, { [unit]: amount });
        return {
          success: true,
          result: result.toISOString(),
          original: date,
          added: { [unit]: amount },
        };
      }

      case 'subtract': {
        if (!date || amount === undefined || !unit) {
          throw new Error('Date, amount, and unit are required for subtract operation');
        }
        const dateObj = parseISO(date);
        if (!isValid(dateObj)) {
          throw new Error('Invalid date');
        }
        const result = sub(dateObj, { [unit]: amount });
        return {
          success: true,
          result: result.toISOString(),
          original: date,
          subtracted: { [unit]: amount },
        };
      }

      case 'diff': {
        if (!date || !compareDate) {
          throw new Error('Date and compareDate are required for diff operation');
        }
        const date1 = parseISO(date);
        const date2 = parseISO(compareDate);
        if (!isValid(date1) || !isValid(date2)) {
          throw new Error('Invalid date');
        }
        const days = differenceInDays(date1, date2);
        const milliseconds = date1.getTime() - date2.getTime();
        return {
          success: true,
          days,
          hours: Math.floor(milliseconds / (1000 * 60 * 60)),
          minutes: Math.floor(milliseconds / (1000 * 60)),
          seconds: Math.floor(milliseconds / 1000),
          milliseconds,
        };
      }

      case 'validate': {
        if (!date) {
          throw new Error('Date is required for validate operation');
        }
        const dateObj = parseISO(date);
        const valid = isValid(dateObj);
        return {
          success: true,
          valid,
          date: valid ? dateObj.toISOString() : null,
        };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error: any) {
    throw new Error(`Date/time operation failed: ${error.message}`);
  }
};
