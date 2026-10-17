/**
 * Google Sheets Tool
 * Prepare Google Sheets API requests for host execution
 * NOTE: This is a thin client that returns request metadata.
 * Actual API calls should be executed by the host application.
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Google Sheets Tool Definition
 */
export const googleSheetsTool: Tool = {
  id: 'google_sheets',
  name: 'Google Sheets (Request Builder)',
  description: 'Build Google Sheets API requests for host execution (read, write, update operations)',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Operation to perform',
      required: true,
      enum: ['read', 'write', 'append', 'update', 'clear', 'getInfo', 'createSheet'],
    },
    {
      name: 'spreadsheetId',
      type: 'string',
      description: 'Google Sheets spreadsheet ID',
      required: true,
    },
    {
      name: 'range',
      type: 'string',
      description: 'A1 notation range (e.g., "Sheet1!A1:D10")',
      required: false,
    },
    {
      name: 'data',
      type: 'array',
      description: 'Data to write (array of arrays or array of objects)',
      required: false,
    },
    {
      name: 'credentials',
      type: 'object',
      description: 'Google API credentials (service account JSON)',
      required: true,
    },
    {
      name: 'sheetName',
      type: 'string',
      description: 'Sheet name for operations',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Operation result with data or status',
  },
  examples: [
    {
      input: {
        operation: 'read',
        spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        range: 'Sheet1!A1:D10',
        credentials: { type: 'service_account', project_id: '...' },
      },
      output: {
        success: true,
        data: [
          ['Name', 'Age', 'City', 'Email'],
          ['Alice', '30', 'NYC', 'alice@example.com'],
        ],
        rowCount: 2,
      },
    },
    {
      input: {
        operation: 'write',
        spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        range: 'Sheet1!A1',
        data: [
          ['Name', 'Age'],
          ['Bob', '25'],
        ],
        credentials: { type: 'service_account', project_id: '...' },
      },
      output: {
        success: true,
        updatedRows: 2,
        updatedColumns: 2,
      },
    },
  ],
};

/**
 * Google Sheets Executor (Thin Client)
 * Returns request metadata for host execution instead of making live API calls
 */
export const googleSheetsExecutor: ToolExecutor = async (params) => {
  const { operation, spreadsheetId, range, data, sheetName } = params;

  try {
    switch (operation) {
      case 'read': {
        if (!range) {
          throw new Error('Range is required for read operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'GET',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
          scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
          description: `Read data from ${range}`,
        };
      }

      case 'write': {
        if (!range || !data) {
          throw new Error('Range and data are required for write operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'PUT',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          body: {
            valueInputOption: 'RAW',
            values: data,
          },
          description: `Write data to ${range}`,
        };
      }

      case 'append': {
        if (!range || !data) {
          throw new Error('Range and data are required for append operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'POST',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append`,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          body: {
            valueInputOption: 'RAW',
            values: data,
          },
          description: `Append data to ${range}`,
        };
      }

      case 'update': {
        if (!range || !data) {
          throw new Error('Range and data are required for update operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'PUT',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          body: {
            valueInputOption: 'USER_ENTERED',
            values: data,
          },
          description: `Update data in ${range}`,
        };
      }

      case 'clear': {
        if (!range) {
          throw new Error('Range is required for clear operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'POST',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          description: `Clear data from ${range}`,
        };
      }

      case 'getInfo': {
        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'GET',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
          scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
          description: `Get spreadsheet metadata`,
        };
      }

      case 'createSheet': {
        if (!sheetName) {
          throw new Error('Sheet name is required for createSheet operation');
        }

        return {
          success: true,
          requestType: 'google_sheets_api',
          method: 'POST',
          endpoint: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          body: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: sheetName,
                  },
                },
              },
            ],
          },
          description: `Create new sheet "${sheetName}"`,
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
