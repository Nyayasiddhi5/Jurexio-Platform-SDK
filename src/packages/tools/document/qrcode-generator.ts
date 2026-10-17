/**
 * QR Code Generator Tool
 * Generate QR codes for URLs, text, vCards
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * QR Code Generator Tool Definition
 */
export const qrcodeGeneratorTool: Tool = {
  id: 'qrcode_generator',
  name: 'QR Code Generator',
  description: 'Generate QR codes: URLs, text, vCards, WiFi, custom data',
  parameters: [
    {
      name: 'data',
      type: 'string',
      description: 'Data to encode in QR code',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'QR code options (size, errorCorrection, color, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'QR code image data',
  },
  examples: [
    {
      input: {
        data: 'https://example.com',
        options: { size: 300, errorCorrection: 'H' },
      },
      output: {
        success: true,
        imageData: 'base64EncodedImageData...',
        format: 'png',
      },
    },
  ],
};

/**
 * QR Code Generator Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const qrcodeGeneratorExecutor: ToolExecutor = async (params) => {
  const { data, options = {} } = params;

  if (typeof data !== 'string' || !data.trim()) {
    return {
      success: false,
      error: 'data must be a non-empty string',
    };
  }

  // Return QR code configuration for host to execute
  return {
    success: true,
    action: 'qrcode_generate',
    config: {
      data: data.trim(),
      size: options.size || 300,
      errorCorrection: options.errorCorrection || 'M',
      foregroundColor: options.foregroundColor || '#000000',
      backgroundColor: options.backgroundColor || '#ffffff',
      margin: options.margin || 4,
      format: options.format || 'png',
    },
    note: 'QR code generation requires qrcode library and execution by host environment',
  };
};
