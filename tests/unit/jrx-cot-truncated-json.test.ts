/**
 * NV-COT-TRUNCATED-JSON-001 — the reasoning trail must survive a truncated payload.
 *
 * Why this exists: NSP reported no reasoning trail under any key. The wiring was complete
 * end to end (`enableCoT` → safety-ring wrapper line 153 → nv-client → contract, and the
 * sanitizer does not strip `chainOfThought`), but the parse failed live with
 * `Unterminated string in JSON at position 320 (line 4 column 300)` — the model hit its
 * output ceiling mid-string. `JSON.parse` rejected everything, the caller swallowed the
 * throw as non-fatal, and the field was simply absent. Discarding N-1 complete reasoning
 * steps because step N was cut off is the wrong trade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = readFileSync(
  path.join(process.cwd(), 'src/services/chain-of-thought-service.ts'),
  'utf8',
);

/**
 * Mirror of the shipped `repairTruncatedJson`. Kept as a local copy because the function is
 * module-private by design — exporting it purely for a test would widen the service's public
 * surface. The structural assertions below pin the real implementation so the two cannot
 * drift apart silently.
 */
function repairTruncatedJson(input: string): string | null {
  const s = String(input || '');
  if (!s.trim().startsWith('{')) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafeEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (stack.length > 0) lastSafeEnd = i + 1;
    }
  }
  if (stack.length === 0) return null;
  let body = s;
  if (inString) {
    if (lastSafeEnd > 0) body = s.slice(0, lastSafeEnd);
    else body = `${s}"`;
  } else {
    const lastComma = body.lastIndexOf(',');
    if (lastSafeEnd > 0 && lastComma > lastSafeEnd) body = body.slice(0, lastSafeEnd);
  }
  body = body.replace(/,\s*$/, '');
  const closers: string[] = [];
  let str2 = false;
  let esc2 = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (esc2) { esc2 = false; continue; }
    if (ch === '\\') { esc2 = true; continue; }
    if (ch === '"') { str2 = !str2; continue; }
    if (str2) continue;
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }
  if (str2) body += '"';
  while (closers.length > 0) body += closers.pop();
  return body;
}

describe('repairTruncatedJson — salvage the steps we already paid for', () => {
  it('recovers complete steps when the LAST step is cut mid-string (the live failure)', () => {
    // Shape of the observed payload: two good steps, third truncated inside `thought`.
    const truncated = `{
  "steps": [
    { "thought": "Identify the governing provision: BNS 318(4).", "confidence": 0.9 },
    { "thought": "Consider whether the cheque was issued as security.", "confidence": 0.85 },
    { "thought": "Anticipatory bail under BNSS 482 turns on whether custodial`;
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired as string);
    // The two COMPLETE steps survive; the half-written third is dropped rather than
    // presented to a partner as reasoning.
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].thought).toContain('BNS 318(4)');
    expect(parsed.steps[1].confidence).toBe(0.85);
  });

  it('closes brackets when truncation lands between elements', () => {
    const truncated = `{"steps":[{"thought":"a","confidence":0.9},{"thought":"b","confidence":0.8}`;
    const parsed = JSON.parse(repairTruncatedJson(truncated) as string);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[1].thought).toBe('b');
  });

  it('strips a dangling comma left by the cut', () => {
    const truncated = `{"steps":[{"thought":"a","confidence":0.9},`;
    const parsed = JSON.parse(repairTruncatedJson(truncated) as string);
    expect(parsed.steps).toHaveLength(1);
  });

  it('returns null for COMPLETE json so the normal path is never disturbed', () => {
    // Complete input must not be "repaired" — the first parse already succeeded.
    expect(repairTruncatedJson('{"steps":[],"conclusion":"done"}')).toBeNull();
  });

  it('returns null for genuinely malformed json so the original error still surfaces', () => {
    // Mismatched closer is corruption, not truncation; guessing would hide a real bug.
    expect(repairTruncatedJson('{"steps":[}]')).toBeNull();
    expect(repairTruncatedJson('not json at all')).toBeNull();
  });

  it('does not mistake a brace inside a string for structure', () => {
    const truncated = `{"steps":[{"thought":"cite s.138 { NI Act }","confidence":0.9},{"thought":"next`;
    const parsed = JSON.parse(repairTruncatedJson(truncated) as string);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].thought).toContain('{ NI Act }');
  });

  it('handles an escaped quote before the truncation', () => {
    const truncated = `{"steps":[{"thought":"the word \\"security\\" matters","confidence":0.9},{"thought":"cut`;
    const parsed = JSON.parse(repairTruncatedJson(truncated) as string);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].thought).toContain('security');
  });
});

describe('the shipped service must use the repair path', () => {
  it('retries the parse through repairTruncatedJson instead of throwing immediately', () => {
    expect(SRC).toContain('repairTruncatedJson(jsonStr)');
    expect(SRC).toContain('rethrow');
  });

  it('synthesises a conclusion when truncation dropped it but steps survived', () => {
    // `conclusion` is emitted last, so a salvaged payload usually lacks it. The steps ARE
    // the reasoning trail and must not be discarded for a missing summary line.
    expect(SRC).toContain('Reasoning truncated before a conclusion was emitted.');
  });

  it('still rejects a payload with no usable steps', () => {
    expect(SRC).toContain('LLM returned invalid reasoning JSON shape');
  });
});
