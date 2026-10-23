/**
 * NV-TEXTRACT-STRUCTURE-001 — parse TABLES/FORMS blocks from Textract AnalyzeDocument.
 * Text flattening stays in jrx-textract-ocr-service; this module preserves structure for merge (T3).
 */
export type TextractBlockRef = {
  BlockType?: string;
  Id?: string;
  Text?: string;
  Confidence?: number;
  EntityTypes?: string[];
  Relationships?: Array<{ Type?: string; Ids?: string[] }>;
};

export interface TextractFormFieldV1 {
  key: string;
  value: string;
  confidence: number;
}

export interface TextractTableCellV1 {
  row: number;
  col: number;
  text: string;
}

export interface TextractTableV1 {
  rowCount: number;
  colCount: number;
  cells: TextractTableCellV1[];
}

export interface TextractStructureV1 {
  formFields: TextractFormFieldV1[];
  tables: TextractTableV1[];
  keyValueSetCount: number;
  tableBlockCount: number;
}

function blockMap(blocks: TextractBlockRef[]): Map<string, TextractBlockRef> {
  const m = new Map<string, TextractBlockRef>();
  for (const b of blocks) {
    if (b.Id) m.set(b.Id, b);
  }
  return m;
}

function childIds(block: TextractBlockRef, relType: string): string[] {
  const rel = block.Relationships?.find((r) => r.Type === relType);
  return rel?.Ids ?? [];
}

function gatherText(blockId: string, byId: Map<string, TextractBlockRef>): string {
  const block = byId.get(blockId);
  if (!block) return '';
  if (block.BlockType === 'WORD' || block.BlockType === 'LINE') {
    return block.Text?.trim() ?? '';
  }
  const parts: string[] = [];
  for (const cid of childIds(block, 'CHILD')) {
    const t = gatherText(cid, byId);
    if (t) parts.push(t);
  }
  return parts.join(' ').trim();
}

function parseKeyValueSets(blocks: TextractBlockRef[]): TextractFormFieldV1[] {
  const byId = blockMap(blocks);
  const out: TextractFormFieldV1[] = [];
  for (const b of blocks) {
    if (b.BlockType !== 'KEY_VALUE_SET') continue;
    const types = b.EntityTypes ?? [];
    if (!types.includes('KEY')) continue;
    const valueIds = childIds(b, 'VALUE');
    let value = '';
    for (const vid of valueIds) {
      value = gatherText(vid, byId);
      if (value) break;
    }
    const key = gatherText(b.Id ?? '', byId);
    if (!key && !value) continue;
    const conf = typeof b.Confidence === 'number' ? b.Confidence / 100 : 0;
    out.push({ key, value, confidence: conf });
  }
  return out;
}

function parseTables(blocks: TextractBlockRef[]): TextractTableV1[] {
  const byId = blockMap(blocks);
  const tables: TextractTableV1[] = [];
  for (const b of blocks) {
    if (b.BlockType !== 'TABLE') continue;
    const cells: TextractTableCellV1[] = [];
    let maxRow = 0;
    let maxCol = 0;
    for (const cid of childIds(b, 'CHILD')) {
      const cell = byId.get(cid);
      if (!cell || cell.BlockType !== 'CELL') continue;
      const row = Number((cell as TextractBlockRef & { RowIndex?: number }).RowIndex ?? 0);
      const col = Number((cell as TextractBlockRef & { ColumnIndex?: number }).ColumnIndex ?? 0);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
      const text = gatherText(cid, byId);
      cells.push({ row, col, text });
    }
    tables.push({ rowCount: maxRow, colCount: maxCol, cells });
  }
  return tables;
}

export function parseTextractStructureV1(blocks: TextractBlockRef[]): TextractStructureV1 {
  const formFields = parseKeyValueSets(blocks);
  const tables = parseTables(blocks);
  return {
    formFields,
    tables,
    keyValueSetCount: blocks.filter((b) => b.BlockType === 'KEY_VALUE_SET').length,
    tableBlockCount: blocks.filter((b) => b.BlockType === 'TABLE').length,
  };
}
