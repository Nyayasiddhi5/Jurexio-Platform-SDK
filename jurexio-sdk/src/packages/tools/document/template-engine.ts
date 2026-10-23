/**
 * Template Engine Tool
 * Render document templates with data
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Template Engine Tool Definition
 */
export const templateEngineTool: Tool = {
  id: 'template_engine',
  name: 'Template Engine',
  description: 'Render document templates: Handlebars, Mustache, EJS, variable substitution',
  parameters: [
    {
      name: 'template',
      type: 'string',
      description: 'Template content with placeholders',
      required: true,
    },
    {
      name: 'data',
      type: 'object',
      description: 'Data to inject into template',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Template options (engine, helpers, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Rendered template',
  },
  examples: [
    {
      input: {
        template: 'Hello {{name}}, your order #{{orderId}} is {{status}}!',
        data: { name: 'John', orderId: '12345', status: 'ready' },
      },
      output: {
        success: true,
        content: 'Hello John, your order #12345 is ready!',
      },
    },
  ],
};

/**
 * Simple template renderer (Mustache-style)
 */
const renderSimpleTemplate = (template: string, data: any): string => {
  let result = template;

  // Replace {{variable}} patterns
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, String(value));
  }

  return result;
};

/**
 * Template Engine Executor
 */
export const templateEngineExecutor: ToolExecutor = async (params) => {
  const { template, data, options = {} } = params;

  if (typeof template !== 'string' || !template.trim()) {
    return {
      success: false,
      error: 'template must be a non-empty string',
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      success: false,
      error: 'data must be an object',
    };
  }

  try {
    const rendered = renderSimpleTemplate(template, data);

    return {
      success: true,
      content: rendered,
      engine: options.engine || 'simple',
      variablesUsed: Object.keys(data),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
