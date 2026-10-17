/**
 * NV-ROUTER-LOG-WIDTH-001 — the decision-log writer must not be stalled by a row
 * that can never be written.
 *
 * Live defect this locks: `request_id` is `varchar(64)`, but
 * NV-REQID-CORRELATION-001 made Queen dispatch ids parent-scoped
 * (`<uuid>::leaf-swarm-agent-0-1786963251079` = 76+ chars). Every batch holding a
 * Queen leaf failed `22001` and was re-prepended forever, so the whole decision
 * history froze behind it — observed on jrx-prod at `attempt: 22` with the table
 * stuck at 11,394 rows while traffic continued.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/intelligent-router/router-stats.ts'),
  'utf8',
);

describe('NV-ROUTER-LOG-WIDTH-001 — values are fitted to column widths', () => {
  it('no column value is inserted raw; each goes through fit()/correlationParent()', () => {
    expect(SRC).toContain('correlationParent(r.requestId)');
    expect(SRC).toContain('fit(r.agentId, COL_WIDTHS.agentId)');
    expect(SRC).toContain('fit(r.primaryModelId, COL_WIDTHS.modelId)');
    expect(SRC).toContain('fit(r.pickedModelId, COL_WIDTHS.modelId)');
    expect(SRC).toContain('fit(r.jurisdiction, COL_WIDTHS.jurisdiction)');
  });

  it('the mirrored widths match the live table (request_id 64 is the one that broke)', () => {
    expect(SRC).toMatch(/requestId:\s*64/);
    expect(SRC).toMatch(/taskKind:\s*64/);
    expect(SRC).toMatch(/agentId:\s*96/);
    expect(SRC).toMatch(/modelId:\s*96/);
    expect(SRC).toMatch(/jurisdiction:\s*16/);
  });

  it('a scoped dispatch id is reduced to the correlatable parent, not blind-truncated', () => {
    // The parent UUID is the join key partners and provider logs share, so it must
    // survive intact; only the leaf suffix is cut.
    expect(SRC).toContain("const sep = raw.indexOf('::')");
    expect(SRC).toContain('raw.slice(0, sep)');
    // And the stage is not simply thrown away.
    expect(SRC).toContain('dispatchStage(r.requestId)');
  });
});

describe('NV-ROUTER-LOG-WIDTH-001 — poison batches cannot block the queue', () => {
  it('classifies permanently-unwritable SQLSTATEs, including 22001', () => {
    expect(SRC).toContain("'22001'");
    expect(SRC).toContain('UNWRITABLE_SQLSTATES');
    expect(SRC).toContain('function isUnwritable');
  });

  it('drops an unwritable batch instead of re-prepending it forever', () => {
    const catchStart = SRC.indexOf('} catch (err) {');
    const catchSlice = SRC.slice(catchStart, catchStart + 2_500);
    // The unwritable branch must return BEFORE the lossless requeue runs.
    const dropIdx = catchSlice.indexOf('if (isUnwritable(err))');
    const requeueIdx = catchSlice.indexOf('persistBuffer.unshift(...batch)');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(requeueIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(requeueIdx);
  });

  it('the drop is loud and auditable, never silent', () => {
    expect(SRC).toContain('JRX-ROUTER-LOG-001');
    expect(SRC).toContain('permanently unwritable');
    expect(SRC).toContain('sqlstate:');
  });

  it('resets the failure counter and keeps draining so later records still land', () => {
    const catchStart = SRC.indexOf('if (isUnwritable(err))');
    const slice = SRC.slice(catchStart, catchStart + 1_200);
    expect(slice).toContain('consecutiveFailures = 0');
    expect(slice).toContain('scheduleFlush(0)');
  });

  it('a transient error (not in the unwritable set) still retries losslessly', () => {
    // Guard against over-correcting into "drop everything on any DB error".
    expect(SRC).not.toContain("'08006'"); // connection_failure must NOT be unwritable
    expect(SRC).not.toContain("'57P01'"); // admin_shutdown must NOT be unwritable
    expect(SRC).toContain('persistBuffer.unshift(...batch)');
  });

  it('exposes the unwritable-drop count for ops', () => {
    expect(SRC).toContain('droppedAsUnwritable');
  });
});
