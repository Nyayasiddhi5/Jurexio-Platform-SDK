/**
 * NV-HEAP-PRESSURE-DENOM-001 / NV-HEAP-LIMIT-CONTRADICTION-001
 *
 * Two compounding config/measurement defects found while RCA-ing an HTTP 500 on
 * live nysdev, where the gateway logged "CRITICAL heap pressure heapPct=92" while
 * holding 499 MB of a 2 GB container limit with 13.8 GB free on the host.
 *
 * These are asserted structurally (source + arithmetic) rather than by forcing a
 * real OOM, because reproducing genuine heap exhaustion in a unit test is both
 * slow and flaky, and the defects are about the FORMULA and the CONFIG, not about
 * behaviour under real pressure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import v8 from 'v8';

const ROOT = join(__dirname, '..', '..');
const managerSrc = readFileSync(join(ROOT, 'src/services/jrx-memory-manager.ts'), 'utf8');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const compose = readFileSync(join(ROOT, 'docker-compose.aws-dev.yml'), 'utf8');

describe('NV-HEAP-PRESSURE-DENOM-001 — pressure must measure headroom, not V8 sizing', () => {
  it('divides heapUsed by the heap LIMIT, not heapTotal', () => {
    // heapTotal is the currently-committed heap, which V8 sizes to fit live data.
    // heapUsed/heapTotal therefore sits at 85-95% in ANY healthy process and is
    // not a headroom signal at all.
    expect(managerSrc).toContain('heap_size_limit');
    expect(managerSrc).toMatch(/heapPct\s*=\s*heapLimitMb\s*>\s*0/);
    expect(managerSrc).not.toMatch(/heapPct\s*=\s*heapTotalMb\s*>\s*0/);
  });

  it('the OLD formula would report critical pressure on a HEALTHY process', () => {
    // Demonstrates the defect arithmetically using this very process, which is not
    // under memory pressure. If the old formula flags it, the formula is wrong.
    const { heapUsed, heapTotal } = process.memoryUsage();
    const oldPct = Math.round((heapUsed / heapTotal) * 100);
    const limit = v8.getHeapStatistics().heap_size_limit;
    const newPct = Math.round((heapUsed / limit) * 100);

    // The elevated threshold is 90 and critical is 98.
    expect(newPct).toBeLessThan(90);
    // The old ratio is materially higher than the true utilisation — that gap IS
    // the defect. (Not asserted as >=90 because it varies with GC timing; the
    // invariant that matters is that it systematically overstates.)
    expect(oldPct).toBeGreaterThan(newPct);
  });

  it('does not hardcode a 512 MB RSS ceiling below the container limit', () => {
    expect(managerSrc).not.toMatch(/rssLimitMb\s*=\s*512\s*;/);
    expect(managerSrc).toContain('NYV_RSS_LIMIT_MB');
  });

  it('derives the RSS ceiling from the heap limit with non-heap headroom', () => {
    // RSS legitimately exceeds the heap (native buffers, code, stacks), so a
    // ceiling AT the heap limit would false-positive just like 512 MB did.
    expect(managerSrc).toMatch(/heap_size_limit[\s\S]{0,120}1\.5/);
  });
});

describe('NV-HEAP-LIMIT-CONTRADICTION-001 — the heap ceiling is declared exactly once', () => {
  it('Dockerfile CMD does not pin max-old-space-size', () => {
    // An explicit CLI flag overrides NODE_OPTIONS, which silently defeated the
    // compose file's deliberate 1536 sizing for the life of the container.
    const cmdLine = dockerfile.split('\n').find((l) => l.startsWith('CMD [')) ?? '';
    expect(cmdLine).not.toContain('max-old-space-size');
    expect(cmdLine).toContain('tsx');
    expect(cmdLine).toContain('src/index.ts');
  });

  it('compose still declares the ceiling, and it fits inside mem_limit', () => {
    const heap = compose.match(/--max-old-space-size=(\d+)/);
    expect(heap, 'compose must still declare a heap ceiling').not.toBeNull();
    const heapMb = Number(heap![1]);

    const limit = compose.match(/mem_limit:\s*(\d+)g/i);
    expect(limit, 'gateway must still declare mem_limit').not.toBeNull();
    const limitMb = Number(limit![1]) * 1024;

    // The whole point: V8 must GC before the kernel OOM-kills the container.
    expect(heapMb).toBeLessThan(limitMb);
  });
});
