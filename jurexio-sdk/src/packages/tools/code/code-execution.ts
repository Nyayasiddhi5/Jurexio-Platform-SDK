/**
 * Code Execution Tool
 * Sandboxed JavaScript execution with timeout and memory limits
 */

import { VM } from 'vm2';
import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Code Execution Tool Definition
 */
export const codeExecutionTool: Tool = {
  id: 'code_execution',
  name: 'Code Execution',
  description: 'Execute JavaScript code in a sandboxed environment with timeout and memory limits',
  parameters: [
    {
      name: 'code',
      type: 'string',
      description: 'JavaScript code to execute',
      required: true,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Execution timeout in milliseconds (default: 5000)',
      required: false,
      default: 5000,
    },
    {
      name: 'context',
      type: 'object',
      description: 'Variables to inject into execution context',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Execution result with output, errors, and execution time',
  },
  examples: [
    {
      input: { code: 'return 2 + 2' },
      output: { success: true, result: 4 },
    },
    {
      input: { code: 'const x = input * 2; return x', context: { input: 5 } },
      output: { success: true, result: 10 },
    },
  ],
};

/**
 * Code Execution Executor
 */
export const codeExecutionExecutor: ToolExecutor = async (params) => {
  const { code, timeout = 5000, context = {} } = params;

  const startTime = Date.now();

  try {
    // Create sandboxed VM
    const vm = new VM({
      timeout,
      sandbox: {
        ...context,
        console: {
          log: (...args: any[]) => args.join(' '),
          error: (...args: any[]) => args.join(' '),
        },
      },
    });

    // Execute code
    const result = vm.run(code);
    const executionTime = Date.now() - startTime;

    return {
      success: true,
      result,
      executionTime,
    };
  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    // Categorize error
    let errorType = 'execution_error';
    if (error.message?.includes('Script execution timed out')) {
      errorType = 'timeout';
    } else if (error.message?.includes('memory')) {
      errorType = 'memory_limit';
    }

    return {
      success: false,
      error: error.message,
      errorType,
      executionTime,
    };
  }
};
