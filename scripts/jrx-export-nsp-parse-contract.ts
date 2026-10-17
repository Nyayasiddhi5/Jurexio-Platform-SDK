/**
 * NV-NSP-PARSE-CONTRACT-001 — export the machine-readable resolve parse contract.
 *
 * Generates documents/working/NSP-RESOLVE-PARSE-CONTRACT.json from the single
 * source of truth in src/services/jrx-nsp-parse-contract.ts (field keys only — no
 * secrets, no values). Run: `npx tsx scripts/jrx-export-nsp-parse-contract.ts`.
 * Keep the JSON in sync with §21 of NSP-CASE-SEARCH-INTEGRATION-2026-09.md.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NSP_RESOLVE_PARSE_CONTRACT,
  NSP_PARSE_CONTRACT_NOTES,
} from '../src/services/jrx-nsp-parse-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'documents', 'working', 'NSP-RESOLVE-PARSE-CONTRACT.json');

const doc = {
  $schema: 'https://jurexio.dev/schemas/nsp-resolve-parse-contract.v1.json',
  contractId: NSP_PARSE_CONTRACT_NOTES.contractId,
  generatedFrom: 'src/services/jrx-nsp-parse-contract.ts (SSoT)',
  endpoint: 'POST /api/jrx/v1/sdk/cnr/resolve',
  claimEcourts: false,
  invariants: NSP_PARSE_CONTRACT_NOTES,
  absentWhenLegend: {
    null: 'Corpus row exists but this datum was not published.',
    not_in_corpus: 'This field is not sourced by any tier today (structural gap).',
    not_applicable: 'Field belongs to a different court tier (e.g. SC-only key on an HC row).',
    tier_mobile_depth_only: 'Only populated on the ~0.4% HC rows eCourts mobile-depth indexed.',
    tier3_required: 'Live eCourts (NIC Tier-3) only — never in judgment corpus.',
    manual_required: 'Partner/EDJ manual capture (e.g. party PII, witnesses).',
    search_surface_only: 'Not emitted on resolve — discovery card concern only.',
  },
  fieldCount: Object.keys(NSP_RESOLVE_PARSE_CONTRACT).length,
  fields: NSP_RESOLVE_PARSE_CONTRACT,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
// eslint-disable-next-line no-console
console.log(`[nsp-parse-contract] wrote ${doc.fieldCount} field entries → ${OUT}`);
