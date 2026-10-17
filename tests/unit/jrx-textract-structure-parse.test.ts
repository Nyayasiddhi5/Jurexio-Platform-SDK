import { describe, it, expect } from 'vitest';
import { parseTextractStructureV1 } from '../../src/services/document-pipeline/jrx-textract-structure-parse.js';

describe('parseTextractStructureV1', () => {
  it('parses KEY_VALUE_SET pairs from synthetic blocks', () => {
    const blocks = [
      { BlockType: 'KEY_VALUE_SET', Id: 'k1', EntityTypes: ['KEY'], Confidence: 90, Relationships: [{ Type: 'VALUE', Ids: ['v1'] }] },
      { BlockType: 'KEY_VALUE_SET', Id: 'v1', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w1'] }] },
      { BlockType: 'WORD', Id: 'w1', Text: 'CNR123' },
      { BlockType: 'KEY_VALUE_SET', Id: 'k2', EntityTypes: ['KEY'], Confidence: 88, Relationships: [{ Type: 'CHILD', Ids: ['w2'] }, { Type: 'VALUE', Ids: ['v2'] }] },
      { BlockType: 'WORD', Id: 'w2', Text: 'CNR' },
      { BlockType: 'KEY_VALUE_SET', Id: 'v2', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w3'] }] },
      { BlockType: 'WORD', Id: 'w3', Text: 'CNR123' },
    ];
    const parsed = parseTextractStructureV1(blocks);
    expect(parsed.formFields.length).toBeGreaterThan(0);
    expect(parsed.keyValueSetCount).toBe(4);
  });
});
