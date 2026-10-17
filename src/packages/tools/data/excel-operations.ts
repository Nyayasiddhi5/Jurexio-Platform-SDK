// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Excel Operations Tool
 * Read, write, and manipulate Excel files using ExcelJS (replaces xlsx@0.18.5 — CVE-2026-39279 / GHSA-4r6h-8v6p-xvw6)
 */

import ExcelJS from 'exceljs';
import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Excel Operations Tool Definition
 */
export const excelOperationsTool: Tool = {
  id: 'excel_operations',
  name: 'Excel Operations',
  description: 'Read Excel files to JSON, write JSON to Excel, manipulate worksheets, and analyze Excel data',
  parameters: [
    {
      name: 'operation',
      type: 'string',
      description: 'Operation to perform',
      required: true,
      enum: ['read', 'write', 'getSheets', 'readSheet', 'createWorkbook', 'analyze'],
    },
    {
      name: 'data',
      type: 'string',
      description: 'Base64-encoded Excel file data or JSON data',
      required: false,
    },
    {
      name: 'sheetName',
      type: 'string',
      description: 'Worksheet name (for readSheet operation)',
      required: false,
    },
    {
      name: 'sheets',
      type: 'object',
      description: 'Worksheets data for createWorkbook (format: { sheetName: data[] })',
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
    description: 'Operation result with Excel data or metadata',
  },
  examples: [
    {
      input: {
        operation: 'read',
        data: '<base64-excel-data>',
      },
      output: {
        success: true,
        sheets: ['Sheet1'],
        data: {
          Sheet1: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
          ],
        },
      },
    },
    {
      input: {
        operation: 'write',
        sheets: {
          Sheet1: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
          ],
        },
      },
      output: {
        success: true,
        base64: '<base64-excel-data>',
      },
    },
  ],
};

function sheetToJson(worksheet: ExcelJS.Worksheet): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  const headers: string[] = [];
  let headerRowFound = false;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!headerRowFound) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        headers.push(String(cell.value ?? ''));
      });
      headerRowFound = true;
    } else {
      const rowObj: Record<string, any> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1] ?? `col${colNumber}`;
        rowObj[header] = cell.value;
      });
      rows.push(rowObj);
    }
  });
  return rows;
}

/**
 * Excel Operations Executor
 */
export const excelOperationsExecutor: ToolExecutor = async (params) => {
  const { operation, data, sheetName, sheets } = params;

  try {
    switch (operation) {
      case 'read': {
        if (!data) {
          throw new Error('Data parameter is required for read operation');
        }

        const buffer = Buffer.from(data, 'base64');
        const workbook = new ExcelJS.Workbook();
        // ExcelJS typings expect Node Buffer; TS 5.9 Buffer generic differs — runtime-safe.
        await workbook.xlsx.load(buffer as any);

        const result: Record<string, any[]> = {};
        const sheetNames: string[] = [];
        workbook.eachSheet((worksheet) => {
          sheetNames.push(worksheet.name);
          result[worksheet.name] = sheetToJson(worksheet);
        });

        return {
          success: true,
          sheets: sheetNames,
          data: result,
          sheetCount: sheetNames.length,
        };
      }

      case 'write': {
        if (!sheets) {
          throw new Error('Sheets parameter is required for write operation');
        }

        const workbook = new ExcelJS.Workbook();

        for (const [name, sheetData] of Object.entries(sheets)) {
          const worksheet = workbook.addWorksheet(name);
          const rows = sheetData as any[];
          if (Array.isArray(rows) && rows.length > 0) {
            const headers = Object.keys(rows[0] as object);
            worksheet.addRow(headers);
            for (const rowData of rows) {
              worksheet.addRow(headers.map((h) => (rowData as any)[h]));
            }
          }
        }

        const buf = await workbook.xlsx.writeBuffer();
        const base64 = Buffer.from(buf).toString('base64');

        return {
          success: true,
          base64,
          size: buf.byteLength,
          sheets: Object.keys(sheets),
        };
      }

      case 'getSheets': {
        if (!data) {
          throw new Error('Data parameter is required for getSheets operation');
        }

        const buffer = Buffer.from(data, 'base64');
        const workbook = new ExcelJS.Workbook();
        // ExcelJS typings expect Node Buffer; TS 5.9 Buffer generic differs — runtime-safe.
        await workbook.xlsx.load(buffer as any);

        const sheetNames: string[] = [];
        workbook.eachSheet((worksheet) => { sheetNames.push(worksheet.name); });

        return {
          success: true,
          sheets: sheetNames,
          count: sheetNames.length,
        };
      }

      case 'readSheet': {
        if (!data || !sheetName) {
          throw new Error('Data and sheetName parameters are required for readSheet operation');
        }

        const buffer = Buffer.from(data, 'base64');
        const workbook = new ExcelJS.Workbook();
        // ExcelJS typings expect Node Buffer; TS 5.9 Buffer generic differs — runtime-safe.
        await workbook.xlsx.load(buffer as any);

        const worksheet = workbook.getWorksheet(sheetName);
        if (!worksheet) {
          const names: string[] = [];
          workbook.eachSheet((ws) => { names.push(ws.name); });
          throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${names.join(', ')}`);
        }

        const jsonData = sheetToJson(worksheet);

        return {
          success: true,
          sheetName,
          data: jsonData,
          rowCount: jsonData.length,
        };
      }

      case 'createWorkbook': {
        if (!sheets) {
          throw new Error('Sheets parameter is required for createWorkbook operation');
        }

        const workbook = new ExcelJS.Workbook();
        const sheetNames: string[] = [];

        for (const [name, sheetData] of Object.entries(sheets)) {
          const worksheet = workbook.addWorksheet(name);
          const rows = sheetData as any[];
          if (Array.isArray(rows) && rows.length > 0) {
            const headers = Object.keys(rows[0] as object);
            worksheet.addRow(headers);
            for (const rowData of rows) {
              worksheet.addRow(headers.map((h) => (rowData as any)[h]));
            }
          }
          sheetNames.push(name);
        }

        const buf = await workbook.xlsx.writeBuffer();
        const base64 = Buffer.from(buf).toString('base64');

        return {
          success: true,
          base64,
          sheets: sheetNames,
          size: buf.byteLength,
        };
      }

      case 'analyze': {
        if (!data) {
          throw new Error('Data parameter is required for analyze operation');
        }

        const buffer = Buffer.from(data, 'base64');
        const workbook = new ExcelJS.Workbook();
        // ExcelJS typings expect Node Buffer; TS 5.9 Buffer generic differs — runtime-safe.
        await workbook.xlsx.load(buffer as any);

        const analysis: Record<string, any> = {};
        const sheetNames: string[] = [];

        workbook.eachSheet((worksheet) => {
          sheetNames.push(worksheet.name);
          const jsonData = sheetToJson(worksheet);
          analysis[worksheet.name] = {
            rowCount: jsonData.length,
            columnCount: worksheet.columnCount,
            columns: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
            hasData: jsonData.length > 0,
          };
        });

        return {
          success: true,
          sheetCount: sheetNames.length,
          sheets: sheetNames,
          analysis,
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
