/**
 * NV-NYAYA-TOOLS-BINDING-001 — runtime probe.
 *
 * Invokes every `jrx-legal-tools.*` capability through the real manifest and
 * reports which ones resolve to a callable method. Inference from grep is
 * not enough here: `pickModuleService` silently falls back to the module
 * namespace on an export-name miss, so a binding defect is only observable
 * at invocation time.
 *
 * Usage: npx tsx scripts/jrx-probe-jrx-legal-tools-binding.ts
 */
import { capabilityManifest } from '../src/orchestration/capability-manifest.js';

type Row = {
  id: string;
  outcome: 'callable' | 'missing-method' | 'other-error';
  detail: string;
};

async function main(): Promise<void> {
  const all = capabilityManifest.list();
  const only = process.argv.includes('--all')
    ? all
    : all.filter((c) => c.id.startsWith('jrx-legal-tools.'));
  const tools = only;

  console.log(`Probing ${tools.length} jrx-legal-tools capabilities via the real manifest\n`);

  const rows: Row[] = [];

  for (const cap of tools) {
    const ctx = {
      tenantId: 'probe-tenant',
      userId: 'probe-user',
      jurisdiction: 'IN',
      tier: 'enterprise',
    } as never;

    try {
      const instance = await cap.factory();
      await instance.invoke({ probe: true } as never, ctx);
      rows.push({ id: cap.id, outcome: 'callable', detail: 'resolved and returned' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The signature of a binding defect: pickServiceMethod exhausted every
      // declared name. Any other throw means the method WAS found and failed
      // for an unrelated reason (bad probe input, DB, network) — which still
      // proves the binding itself is intact.
      const isBindingDefect = /service missing methods/.test(msg);
      rows.push({
        id: cap.id,
        outcome: isBindingDefect ? 'missing-method' : 'other-error',
        detail: msg.slice(0, 160),
      });
    }
  }

  const broken = rows.filter((r) => r.outcome === 'missing-method');

  for (const r of rows) {
    const mark =
      r.outcome === 'missing-method' ? 'BROKEN ' : r.outcome === 'callable' ? 'BOUND  ' : 'BOUND* ';
    console.log(`${mark} ${r.id.padEnd(26)} ${r.detail}`);
  }

  console.log(
    `\nBOUND* = method resolved but threw for an unrelated reason (binding is intact).`,
  );
  console.log(`\n${broken.length} of ${rows.length} jrx-legal-tools capabilities cannot be invoked.`);

  if (broken.length > 0) {
    console.log(`\nUnreachable capability ids:`);
    for (const b of broken) console.log(`  - ${b.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
