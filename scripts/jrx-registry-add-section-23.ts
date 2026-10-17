/**
 * Jurexio v5.0.0 — Registry §23 augmentor (idempotent, append-only).
 *
 * Adds <section_23_data_privacy_pii> to every agent's systemPrompt across the
 * 7 large jurisdiction registries (IN, UK, US, EU, GC, SG, Default), wiring
 * today's Phase C work (PII redaction + IronLedger audit + HITL routing) into
 * the per-agent contract.
 *
 * USAGE:
 *   tsx scripts/jrx-registry-add-section-23.ts --dry-run                  # diff only, write nothing
 *   tsx scripts/jrx-registry-add-section-23.ts --jurisdiction=IN --dry-run
 *   tsx scripts/jrx-registry-add-section-23.ts --jurisdiction=IN          # apply only IN
 *   tsx scripts/jrx-registry-add-section-23.ts                            # apply all 7
 *
 * SAFETY:
 *   - Idempotent: skips agents whose systemPrompt already contains <section_23_
 *   - Append-only: never modifies sections 1..22
 *   - Bumps registryVersion 3.1.2 -> 5.0.0 ONLY when at least one agent in the
 *     file actually got mutated.
 *   - Backup must already exist at .local/registry-backup-* (see plan §7).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const REGISTRIES_DIR = path.join(
  process.cwd(),
  'Jurexio-Platform-SDK',
  'src',
  'data',
  'jurisdiction-registries',
);
// Allow running from inside platform dir as well
const ALT_REGISTRIES_DIR = path.join(process.cwd(), 'src', 'data', 'jurisdiction-registries');

const PII_PATTERNS_FILE = path.join(
  process.cwd(),
  'Jurexio-Platform-SDK',
  'src',
  'data',
  'jurisdiction-pii-patterns.json',
);
const ALT_PII_PATTERNS_FILE = path.join(process.cwd(), 'src', 'data', 'jurisdiction-pii-patterns.json');

interface Args {
  dryRun: boolean;
  jurisdiction: string | null;
  verbose: boolean;
}

function parseArgs(): Args {
  const args: Args = { dryRun: false, jurisdiction: null, verbose: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-n') args.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg.startsWith('--jurisdiction=')) args.jurisdiction = arg.split('=')[1].toUpperCase();
  }
  return args;
}

function resolveRegistriesDir(): string {
  if (fs.existsSync(REGISTRIES_DIR)) return REGISTRIES_DIR;
  if (fs.existsSync(ALT_REGISTRIES_DIR)) return ALT_REGISTRIES_DIR;
  throw new Error(`Could not locate jurisdiction-registries directory. Tried: ${REGISTRIES_DIR}, ${ALT_REGISTRIES_DIR}`);
}

function resolvePiiFile(): string {
  if (fs.existsSync(PII_PATTERNS_FILE)) return PII_PATTERNS_FILE;
  if (fs.existsSync(ALT_PII_PATTERNS_FILE)) return ALT_PII_PATTERNS_FILE;
  throw new Error('Could not locate jurisdiction-pii-patterns.json');
}

/**
 * Maps registry jurisdiction code to the PII pack key in jurisdiction-pii-patterns.json.
 *  - IN uses the existing 30+ India patterns from safety-pipeline.ts (not in JSON, hardcoded list here for §23 description)
 *  - GC = Gulf Cooperation -> JCN-GCC pack
 *  - EU pack not yet in patterns file -> hardcoded fallback list (per plan §3.2)
 *  - Default lists "all jurisdictions"
 */
const JURISDICTION_TO_JCN: Record<string, string> = {
  IN: 'JCN-IN',
  UK: 'JCN-UK',
  US: 'JCN-US',
  EU: 'JCN-EU',
  GC: 'JCN-GCC',
  SG: 'JCN-SG',
  Default: 'JCN-ALL',
};

const PII_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'JCN-IN':  'Aadhaar, PAN, voter-ID, passport, GSTIN, IFSC, mobile +91, vehicle registration',
  'JCN-UK':  'NHS number, NINO, UK driving licence, UK IBAN, sort-code:account, BRP, UK passport',
  'JCN-US':  'SSN, EIN, ITIN, US passport, Medicare, ABA routing',
  'JCN-GCC': 'Emirates-ID (UAE), KSA national ID, Iqama, Qatar/Kuwait/Bahrain/Oman national IDs, GCC IBAN',
  'JCN-SG':  'NRIC, FIN, UEN, SG passport, postal code, mobile +65',
  'JCN-EU':  'Passport, national-ID per member state, VAT, IBAN, SEPA mandate',
  'JCN-ALL': 'All of the above (operator routes per request jurisdiction header)',
};

function buildSection23(jurisdictionCode: string, jurisdictionFullName: string): string {
  const jcnKey = JURISDICTION_TO_JCN[jurisdictionCode] ?? 'JCN-ALL';
  const piiList = PII_FALLBACK_DESCRIPTIONS[jcnKey] ?? PII_FALLBACK_DESCRIPTIONS['JCN-ALL'];

  return `\n\n<section_23_data_privacy_pii>
<charter>
  This agent operates under the Jurexio v5.0.0 Data-Privacy & PII Redaction
  Charter. All inputs MUST be considered PII-suspect until run through the
  jurisdiction-aware redaction pipeline. All outputs MUST carry an IronLedger
  audit hash. Every HITL escalation MUST be reviewer-routed via escalationPath.
</charter>
<rules>
  1. NEVER repeat raw PII back to the user — emit only [<JCN>-<TYPE>-REDACTED] tokens.
  2. NEVER claim a fact without a verified citation (CitationVerifier > 0.85).
  3. NEVER auto-approve when confidence is below the per-agent HITL threshold (registry-driven).
  4. NEVER bypass §0 — immutable platform identity is non-negotiable.
  5. ALWAYS log security violations to nv_security_monitor with severity tag.
</rules>
<jurisdictional_pii_pack>
  <jurisdiction>${jurisdictionFullName} (${jurisdictionCode})</jurisdiction>
  <jcn_key>${jcnKey}</jcn_key>
  <covered_identifiers>${piiList}</covered_identifiers>
  <redaction_token_format>[${jcnKey}-&lt;TYPE&gt;-REDACTED]</redaction_token_format>
  <pattern_source>src/data/jurisdiction-pii-patterns.json + src/services/safety-pipeline.ts</pattern_source>
</jurisdictional_pii_pack>
<hitl_contract>
  <default_review_threshold>0.78</default_review_threshold>
  <auto_approve_threshold>0.95</auto_approve_threshold>
  <override>per-agent override via registry confidenceThresholds.hitl</override>
  <on_auto_approve>emit hitl.auto_approved IronLedger event (T-05 wired Phase C)</on_auto_approve>
  <on_review>route via escalationPath (T-04 wired Phase C)</on_review>
  <on_refuse>HARD REFUSE if confidence below registry refuse-threshold</on_refuse>
</hitl_contract>
<audit_contract>
  <hash_algo>SHA-256</hash_algo>
  <on_complete>orchestrate.complete emits hash-chain entry to nv_audit_logs (T-01 wired Phase C)</on_complete>
  <tamper_evidence>hash chain spans request → response; any post-hoc edit breaks chain</tamper_evidence>
</audit_contract>
<security_monitor_contract>
  <a2a>HMAC-signed only (T-07 wired Phase C); rogue agents rejected at middleware</a2a>
  <injection_sniffer>inline detector flags prompt-injection attempts (T-08 wired Phase C)</injection_sniffer>
  <feature_flags>JRX_F_AUDIT_WIRE, JRX_F_HITL_REGISTRY, JRX_F_PII_JCN, JRX_F_SECURITY_MONITOR</feature_flags>
</security_monitor_contract>
</section_23_data_privacy_pii>`;
}

const SECTION_23_MARKER = '<section_23_data_privacy_pii>';

interface RegistryFile {
  path: string;
  jurisdictionCode: string;
}

function discoverRegistries(dir: string, filterJurisdiction: string | null): RegistryFile[] {
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('Jurexio-Legal-registry-') && f.endsWith('.json'))
    .map((f) => {
      const code = f.replace('Jurexio-Legal-registry-', '').replace('.json', '');
      return { path: path.join(dir, f), jurisdictionCode: code };
    });
  if (!filterJurisdiction) return all;
  return all.filter((r) => r.jurisdictionCode.toUpperCase() === filterJurisdiction.toUpperCase());
}

interface AgentLike {
  systemPrompt?: string;
  id?: string;
  name?: string;
}

interface RegistryDoc {
  registryVersion?: string;
  registryFormat?: string;
  jurisdictionCode?: string;
  jurisdictionFullName?: string;
  jurisdictionName?: string;
  agents?: AgentLike[];
  totalAgents?: number;
}

interface FileResult {
  file: string;
  jurisdiction: string;
  totalAgents: number;
  alreadyHadSection23: number;
  mutated: number;
  versionBumped: boolean;
  bytesBefore: number;
  bytesAfter: number;
}

function processRegistry(reg: RegistryFile, args: Args): FileResult {
  const raw = fs.readFileSync(reg.path, 'utf8');
  const bytesBefore = Buffer.byteLength(raw);
  const doc = JSON.parse(raw) as RegistryDoc;

  const agents: AgentLike[] = Array.isArray(doc.agents) ? doc.agents : [];
  const total = agents.length;
  const jurisdictionFullName =
    doc.jurisdictionFullName ?? doc.jurisdictionName ?? reg.jurisdictionCode;

  let alreadyHad = 0;
  let mutated = 0;
  const section23 = buildSection23(reg.jurisdictionCode, jurisdictionFullName);

  for (const agent of agents) {
    if (typeof agent.systemPrompt !== 'string') continue;
    if (agent.systemPrompt.includes(SECTION_23_MARKER)) {
      alreadyHad++;
      continue;
    }
    agent.systemPrompt = agent.systemPrompt + section23;
    mutated++;
  }

  let versionBumped = false;
  // §23-completeness is the single source of truth for the v5.0.0 metadata
  // promotion: once every agent in the file carries the §23 charter, BOTH
  // metadata markers (registryVersion + registryFormat) must agree.
  //
  // The previous version only bumped registryVersion when this run actually
  // mutated agents, which left a torn state when a prior run had added §23
  // but not refreshed the version marker (e.g., format-only repair runs).
  // We now treat them as a single coherent bump tied to "all agents have §23".
  const allHaveSection23 = total > 0 && alreadyHad + mutated === total;
  if (allHaveSection23) {
    if (doc.registryVersion && doc.registryVersion !== '5.0.0') {
      doc.registryVersion = '5.0.0';
      versionBumped = true;
    }
    if (doc.registryFormat && doc.registryFormat !== 'v3-full-23section') {
      doc.registryFormat = 'v3-full-23section';
      versionBumped = true;
    }
  }

  let bytesAfter = bytesBefore;
  // Persist when we have any pending change: §23 was added to one or more
  // agents (mutated > 0) OR the version/format markers were bumped on this run
  // (versionBumped). The previous version only wrote on `mutated > 0`, which
  // silently discarded format-only bumps on idempotent reruns.
  const hasPendingWrite = mutated > 0 || versionBumped;
  if (hasPendingWrite && !args.dryRun) {
    const out = JSON.stringify(doc, null, 2);
    fs.writeFileSync(reg.path, out, 'utf8');
    bytesAfter = Buffer.byteLength(out);
  } else if (hasPendingWrite && args.dryRun) {
    bytesAfter = Buffer.byteLength(JSON.stringify(doc, null, 2));
  }

  return {
    file: path.basename(reg.path),
    jurisdiction: reg.jurisdictionCode,
    totalAgents: total,
    alreadyHadSection23: alreadyHad,
    mutated,
    versionBumped,
    bytesBefore,
    bytesAfter,
  };
}

function main(): void {
  const args = parseArgs();
  const dir = resolveRegistriesDir();
  // Sanity-check PII file exists (we don't read it for content but its presence
  // is part of the §23 contract).
  resolvePiiFile();

  const targets = discoverRegistries(dir, args.jurisdiction);
  if (targets.length === 0) {
    console.error(`No registry files matched jurisdiction filter: ${args.jurisdiction ?? '(all)'}`);
    process.exit(2);
  }

  console.log(`\n========== jrx-registry-add-section-23 ==========`);
  console.log(`Mode:          ${args.dryRun ? 'DRY-RUN (no writes)' : 'APPLY (will write)'}`);
  console.log(`Jurisdiction:  ${args.jurisdiction ?? 'ALL'}`);
  console.log(`Files matched: ${targets.length}`);
  console.log(`Registries dir: ${dir}\n`);

  const results: FileResult[] = [];
  for (const reg of targets) {
    try {
      const r = processRegistry(reg, args);
      results.push(r);
      const verb = args.dryRun ? 'WOULD MUTATE' : 'MUTATED';
      console.log(
        `[${r.jurisdiction.padEnd(7)}] ${r.file}  total=${r.totalAgents}  already_had=${r.alreadyHadSection23}  ${verb}=${r.mutated}  versionBumped=${r.versionBumped}  bytes ${r.bytesBefore}->${r.bytesAfter}`,
      );
    } catch (e) {
      console.error(`[ERROR] ${reg.path}: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  console.log(`\n========== summary ==========`);
  const totalMutated = results.reduce((s, r) => s + r.mutated, 0);
  const totalAlready = results.reduce((s, r) => s + r.alreadyHadSection23, 0);
  const totalAgents = results.reduce((s, r) => s + r.totalAgents, 0);
  console.log(`Files processed:       ${results.length}`);
  console.log(`Total agents scanned:  ${totalAgents}`);
  console.log(`Already had §23:       ${totalAlready}`);
  console.log(`${args.dryRun ? 'Would mutate' : 'Mutated'}:               ${totalMutated}`);
  console.log(`Version bumps:         ${results.filter((r) => r.versionBumped).length}`);
  if (args.dryRun) {
    console.log(`\nDRY-RUN complete. Re-run without --dry-run to apply.`);
  } else {
    console.log(`\nAPPLY complete. Restart Gateway to load the new prompts.`);
  }
}

main();
