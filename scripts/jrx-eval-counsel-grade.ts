#!/usr/bin/env tsx
/**
 * NV-COUNSEL-GRADE-EVAL-001 — counsel-grade quality regression harness (runner).
 *
 * Converts "counsel-grade" from a claim into a number that can fail.
 *
 * WHY A NEW RUNNER AND NOT AN EXTENSION OF nv-eval-legal-accuracy.ts
 * -----------------------------------------------------------------
 * Audited first (NV-NO-DUPLICATE-001). What exists:
 *
 *   • `nv-eval-legal-accuracy.ts` — golden sets × 6 jurisdictions, scoring
 *     accuracy / citation-faithfulness / hallucination / adversarial-detection
 *     via the authority adapters. Single endpoint: `/api/jrx/legal-chat/send`
 *     (SSE). Single task shape: research-style chat.
 *   • `nv-quality-trend.ts` — reads `docs/audit/eval/scoreboard-*.json` and
 *     reports run-to-run deltas per jurisdiction.
 *   • `nv-benchmark-cost.mjs` — COST, on `/api/jrx/orchestrate` via SSM.
 *
 * The axis this harness measures is orthogonal to all three: per-TASK-FAMILY
 * counsel-grade properties on `/api/jrx/orchestrate` (research, chat-fast,
 * analysis, draft, analyzeDocument, statute transition, treatment), with the
 * envelope's self-report cross-checked against the body it describes. Bolting
 * that onto `nv-eval-legal-accuracy` would mean giving one script two request
 * shapes, two scoring models and two gate semantics, and would have forced
 * `scoreboard-*.json` — which `nv-quality-trend` parses — to carry a second,
 * incompatible schema. That would have broken the existing trend tool.
 *
 * So what is NOT duplicated is the important part:
 *   • the authority COUNT reuses the platform's own `countDeliveredAuthorities()`
 *     from `nv-orchestration-response-contract.ts` — the shipped expression, not
 *     a copy of it;
 *   • the artifact convention follows `nv-benchmark-cost.mjs`
 *     (`.local/benchmarks/<label>-<ts>/{raw,aggregate}.json` + `report.md`);
 *   • the regression semantics follow `nv-quality-trend.ts` (previous-vs-current,
 *     `--gate` exits non-zero);
 *   • the prompt set lives under `docs/audit/eval/` beside the existing sets.
 * Zero prompts, verifiers or scoring code are re-implemented.
 *
 * MODES
 * -----
 *   --self-test            Grade the RED/GREEN fixture corpus. No network, no
 *                          gateway, no keys. This is what proves the harness can
 *                          fail, and it is the only mode safe for hermetic CI.
 *   --gateway <url>        Live: POST each case and grade the real answer.
 *   --gate                 Exit non-zero on a REGRESSION vs the previous run.
 *   --absolute-gate        Exit non-zero on ANY failing assertion, history or not.
 *
 * Exit codes: 0 ok · 1 gate tripped · 2 instrument/usage error.
 *
 * A `blocked` case (timeout, 502, empty body) is NEVER a gate failure. A gateway
 * outage reading as a quality regression is the same lie a port-5000 health probe
 * told during a 51-minute outage, and a board that goes red on network weather
 * gets muted — after which the real defect ships unnoticed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessAnswer,
  diffRuns,
  readBody,
  type CounselGradeAssessment,
  type CounselGradeCaseConfig,
  type DeliveredAnswer,
  type RegressionReport,
} from './_nv-counsel-grade-assertions.js';
import { COUNSEL_GRADE_FIXTURES } from './_nv-counsel-grade-fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SET_DIR = path.join(ROOT, 'docs/audit/eval');
const DEFAULT_SET = './jrx-counsel-grade-set.v1.json';
const ARTIFACT_ROOT = path.join(ROOT, '.local/benchmarks');

/* ── CLI ──────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const has = (name: string): boolean => argv.includes(`--${name}`);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

const MODE_SELF_TEST = has('self-test');
const KEY_ENV = opt('key-env') || 'NYV_SDK_KEY_NSP';
const PLATFORM = opt('platform') || 'nsp';
const SET_FILE = opt('set') || DEFAULT_SET;
const LABEL = opt('label') || (MODE_SELF_TEST ? 'counsel-grade-selftest' : 'counsel-grade');
const ONLY = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const GATE_REGRESSION = has('gate');
const GATE_ABSOLUTE = has('absolute-gate');
const CASE_TIMEOUT_MS = Number(opt('timeout') || process.env.NYV_COUNSEL_GRADE_TIMEOUT_MS || 150_000);
const OUT_DIR = opt('out');
const COMPARE_TO = opt('compare-to');
/**
 * Grade responses captured earlier instead of calling the gateway.
 *
 * Same rationale as `bench:cost:report --offline`: a live orchestrate run costs
 * 55–65 s and real provider tokens per case, so re-grading must not require
 * re-spending them. It is also the only practical way to grade responses captured
 * on the EC2 host over SSM, where the reply has to be gzipped and chunked to fit
 * the 24,000-character invocation-output ceiling.
 *
 * Shape: `{ "<caseId>": { httpStatus, latencyMs, transportError?, response } }`
 */
const RESPONSES_FILE = opt('responses');
const GATEWAY = opt('gateway');

/* ── set loading ──────────────────────────────────────────────── */

interface SetCase extends CounselGradeCaseConfig {
  endpoint: 'orchestrate' | 'knowledge';
  request: Record<string, unknown>;
  notes?: string;
}

interface PromptSet {
  _meta?: Record<string, unknown>;
  cases: SetCase[];
}

function loadSet(): PromptSet {
  const file = path.isAbsolute(SET_FILE) ? SET_FILE : path.join(SET_DIR, SET_FILE);
  if (!fs.existsSync(file)) {
    fail(`prompt set not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PromptSet;
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    fail(`prompt set ${file} has no cases — refusing to report a green run over an empty set`);
  }
  return parsed;
}

function fail(msg: string): never {
  process.stderr.write(`\nINSTRUMENT ERROR: ${msg}\n`);
  process.exit(2);
}

/* ── live probing ─────────────────────────────────────────────── */

/**
 * Fetch one case from a live gateway.
 *
 * Timing reality, measured: a `legal_research` or draft orchestrate takes
 * **55–65 s**. Cases run sequentially with a per-case budget (default 150 s), so
 * one slow family cannot consume the whole run's clock — an earlier hand probe
 * failed spuriously at a 170 s timeout spread across three sequential calls, and
 * then looked like a platform failure.
 *
 * A transport failure is returned as `transportError`, which the checker turns
 * into `blocked`, never `fail`.
 */
async function fetchLive(c: SetCase, gateway: string, apiKey: string): Promise<DeliveredAnswer> {
  const base = gateway.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CASE_TIMEOUT_MS);
  const startedAt = Date.now();

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'x-nyv-platform': PLATFORM,
    'x-nyv-consent': 'granted',
    'content-type': 'application/json',
    accept: 'application/json',
  };

  try {
    const isGet = c.endpoint === 'knowledge';
    const url = isGet
      ? `${base}${String(c.request.path)}`
      : `${base}/api/jrx/orchestrate`;
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(c.request) }),
    });

    const text = await res.text();
    const latencyMs = Date.now() - startedAt;

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* Not JSON. Almost certainly an nginx error page, i.e. an instrument
       * problem rather than a model problem — say so instead of grading HTML. */
      return {
        body: '',
        envelope: null,
        httpStatus: res.status,
        latencyMs,
        transportError:
          `non-JSON response (${text.length} chars, content-type=`
          + `${res.headers.get('content-type') ?? '?'}) — likely an ingress hop, not the gateway`,
      };
    }

    if (!res.ok) {
      return {
        body: '',
        envelope: parsed,
        httpStatus: res.status,
        latencyMs,
        transportError: `http ${res.status}: ${String(
          (parsed as Record<string, unknown>)?.error
          ?? (parsed as Record<string, unknown>)?.message
          ?? text.slice(0, 200),
        )}`,
      };
    }

    /* The knowledge routes return structured JSON with no prose `content`. Grading
     * the serialised JSON is deliberate and correct for the deterministic
     * families: `mustContain: ["318"]` is asking whether the mapping is in the
     * payload at all, which is exactly the claim under test. */
    const body = c.endpoint === 'knowledge'
      ? (readBody(parsed) || JSON.stringify(parsed))
      : readBody(parsed);

    return { body, envelope: parsed, httpStatus: res.status, latencyMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      body: '',
      envelope: null,
      latencyMs: Date.now() - startedAt,
      transportError: controller.signal.aborted
        ? `client timeout after ${CASE_TIMEOUT_MS} ms (research/draft measured 55–65 s; `
          + 'raise --timeout before reading this as a platform fault)'
        : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── captured-response grading (offline) ──────────────────────── */

interface CapturedResponse {
  httpStatus?: number;
  latencyMs?: number;
  transportError?: string;
  response?: unknown;
}

/**
 * Turn a captured response into the same `DeliveredAnswer` the live path produces,
 * so the checker cannot behave differently between the two transports. One
 * grader, two ways of getting the bytes.
 */
function fromCaptured(c: SetCase, cap: CapturedResponse | undefined): DeliveredAnswer {
  if (!cap) {
    return {
      body: '',
      envelope: null,
      transportError: 'no captured response for this case id — not measured',
    };
  }
  if (cap.transportError || (cap.httpStatus !== undefined && cap.httpStatus !== 200)) {
    return {
      body: '',
      envelope: (cap.response as Record<string, unknown>) ?? null,
      httpStatus: cap.httpStatus,
      latencyMs: cap.latencyMs,
      transportError: cap.transportError ?? `http ${cap.httpStatus}`,
    };
  }
  const parsed = (cap.response ?? null) as Record<string, unknown> | null;
  const body = c.endpoint === 'knowledge'
    ? (readBody(parsed) || (parsed ? JSON.stringify(parsed) : ''))
    : readBody(parsed);
  return { body, envelope: parsed, httpStatus: cap.httpStatus ?? 200, latencyMs: cap.latencyMs };
}

/* ── artifacts ────────────────────────────────────────────────── */

interface RunArtifact {
  ruleId: 'NV-COUNSEL-GRADE-EVAL-001';
  generatedAt: string;
  mode: 'self-test' | 'live';
  label: string;
  set: string;
  /** Gateway HOST only. Never the key, never a query string (NV-SECRETS-001). */
  gatewayHost?: string;
  keyEnvName?: string;
  totals: {
    cases: number;
    ok: number;
    withFailures: number;
    blocked: number;
    assertionsPassed: number;
    assertionsFailed: number;
    assertionsBlocked: number;
    assertionsNa: number;
  };
  cases: CounselGradeAssessment[];
}

/** Latest previous run artifact for the same mode, so a trend is like-for-like. */
function findPreviousRun(mode: string): { file: string; artifact: RunArtifact } | null {
  if (COMPARE_TO) {
    const file = path.isAbsolute(COMPARE_TO) ? COMPARE_TO : path.join(ROOT, COMPARE_TO);
    if (!fs.existsSync(file)) fail(`--compare-to not found: ${file}`);
    return { file, artifact: JSON.parse(fs.readFileSync(file, 'utf8')) as RunArtifact };
  }
  if (!fs.existsSync(ARTIFACT_ROOT)) return null;

  const candidates: Array<{ file: string; artifact: RunArtifact }> = [];
  for (const dir of fs.readdirSync(ARTIFACT_ROOT)) {
    const file = path.join(ARTIFACT_ROOT, dir, 'counsel-grade.json');
    if (!fs.existsSync(file)) continue;
    try {
      const artifact = JSON.parse(fs.readFileSync(file, 'utf8')) as RunArtifact;
      // Comparing a self-test against a live run would report every live
      // difference as a regression. `nv-quality-trend.ts` learned this the same
      // way and exposes `--live-only`; here it is enforced rather than optional.
      if (artifact.ruleId !== 'NV-COUNSEL-GRADE-EVAL-001' || artifact.mode !== mode) continue;
      candidates.push({ file, artifact });
    } catch {
      process.stderr.write(`  (skipped unreadable artifact: ${file})\n`);
    }
  }
  candidates.sort((a, b) => a.artifact.generatedAt.localeCompare(b.artifact.generatedAt));
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function buildArtifact(
  mode: 'self-test' | 'live',
  setName: string,
  cases: CounselGradeAssessment[],
): RunArtifact {
  const flat = cases.flatMap((c) => c.assertions);
  return {
    ruleId: 'NV-COUNSEL-GRADE-EVAL-001',
    generatedAt: new Date().toISOString(),
    mode,
    label: LABEL,
    set: setName,
    // Host only — a full URL can carry a token in a query string, and this file
    // is committed to artifact storage.
    ...(GATEWAY ? { gatewayHost: safeHost(GATEWAY) } : {}),
    ...(mode === 'live' ? { keyEnvName: KEY_ENV } : {}),
    totals: {
      cases: cases.length,
      ok: cases.filter((c) => c.ok).length,
      withFailures: cases.filter((c) => c.failed > 0).length,
      blocked: cases.filter((c) => c.blocked).length,
      assertionsPassed: flat.filter((a) => a.status === 'pass').length,
      assertionsFailed: flat.filter((a) => a.status === 'fail').length,
      assertionsBlocked: flat.filter((a) => a.status === 'blocked').length,
      assertionsNa: flat.filter((a) => a.status === 'na').length,
    },
    cases,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

const STATUS_MARK: Record<string, string> = { pass: '✓', fail: '✗', blocked: '~', na: '·' };

function renderMarkdown(a: RunArtifact, diff: RegressionReport): string {
  const L: string[] = [];
  L.push('# NYV counsel-grade quality — regression report');
  L.push('');
  L.push(`- **Rule:** ${a.ruleId}`);
  L.push(`- **Generated:** ${a.generatedAt}`);
  L.push(`- **Mode:** ${a.mode}${a.gatewayHost ? ` against \`${a.gatewayHost}\`` : ''}`);
  L.push(`- **Set:** ${a.set}`);
  L.push(
    `- **Cases:** ${a.totals.cases} — ${a.totals.ok} clean, `
    + `${a.totals.withFailures} with failures, ${a.totals.blocked} blocked (unmeasured)`,
  );
  L.push(
    `- **Assertions:** ${a.totals.assertionsPassed} pass · ${a.totals.assertionsFailed} FAIL · `
    + `${a.totals.assertionsBlocked} blocked · ${a.totals.assertionsNa} n/a`,
  );
  L.push('');
  L.push('> `blocked` means the answer never arrived (timeout / non-200 / empty body). It is NOT');
  L.push('> a quality result and never trips the regression gate — check the platform is up first.');
  L.push('');
  L.push('| Case | Family | Chars | Authorities (body) | Envelope claim | Failing assertions |');
  L.push('|---|---|--:|--:|--:|---|');
  for (const c of a.cases) {
    const failing = c.assertions.filter((x) => x.status === 'fail').map((x) => x.id);
    const blocked = c.blockedCount > 0 && failing.length === 0;
    L.push(
      `| \`${c.caseId}\` | ${c.family} | ${c.bodyChars} | ${c.metrics.caseAuthorities ?? '—'} `
      + `| ${c.metrics.envelopeAuthoritiesDelivered ?? '—'} `
      + `| ${blocked ? '_blocked — not measured_' : failing.length ? failing.join(', ') : 'none'} |`,
    );
  }
  L.push('');

  const failing = a.cases.filter((c) => c.failed > 0);
  if (failing.length > 0) {
    L.push('## Failures');
    L.push('');
    for (const c of failing) {
      L.push(`### \`${c.caseId}\` (${c.family})`);
      for (const x of c.assertions.filter((y) => y.status === 'fail')) {
        L.push(`- **${x.id}** — measured \`${x.measured}\` vs expected \`${x.expected}\`: ${x.detail}`);
      }
      L.push('');
    }
  }

  L.push('## Regression vs previous run');
  L.push('');
  if (!diff.comparable) {
    L.push('_No comparable previous run of this mode. This report becomes a regression check from the second run onward._');
  } else {
    L.push(`- Regressions: **${diff.regressions.length}**`);
    L.push(`- Improvements: **${diff.improvements.length}**`);
    if (diff.droppedCases.length) L.push(`- Cases that disappeared from the set: ${diff.droppedCases.join(', ')}`);
    if (diff.newCases.length) L.push(`- New cases: ${diff.newCases.join(', ')}`);
    L.push('');
    for (const r of diff.regressions) {
      L.push(`- ❌ \`${r.caseId}\` **${r.assertionId}** ${r.from} → ${r.to}: ${r.detail}`);
    }
    for (const r of diff.improvements) {
      L.push(`- ✅ \`${r.caseId}\` **${r.assertionId}** ${r.from} → ${r.to}`);
    }
  }
  L.push('');
  return L.join('\n');
}

function printConsole(a: RunArtifact, diff: RegressionReport): void {
  console.log('');
  console.log(`NV-COUNSEL-GRADE-EVAL-001 — mode=${a.mode} set=${a.set}${a.gatewayHost ? ` host=${a.gatewayHost}` : ''}`);
  console.log('='.repeat(100));
  for (const c of a.cases) {
    const marks = c.assertions.map((x) => `${STATUS_MARK[x.status]}${x.id}`).join(' ');
    const verdict = c.failed > 0 ? 'FAIL' : c.blockedCount > 0 ? 'BLOCKED' : 'ok';
    console.log(`${verdict.padEnd(8)} ${c.caseId.padEnd(38)} ${String(c.bodyChars).padStart(6)}ch  ${marks}`);
    for (const x of c.assertions.filter((y) => y.status === 'fail')) {
      console.log(`         ↳ ${x.id}: ${x.detail}`);
    }
    if (c.blockedCount > 0) {
      const t = c.assertions.find((y) => y.id === 'transport');
      if (t && t.status === 'blocked') console.log(`         ↳ ${t.detail}`);
    }
  }
  console.log('-'.repeat(100));
  console.log(
    `cases: ${a.totals.ok} ok / ${a.totals.withFailures} failing / ${a.totals.blocked} blocked`
    + `    assertions: ${a.totals.assertionsPassed} pass / ${a.totals.assertionsFailed} fail`
    + ` / ${a.totals.assertionsBlocked} blocked / ${a.totals.assertionsNa} n/a`,
  );
  if (diff.comparable) {
    console.log(`trend: ${diff.regressions.length} regression(s), ${diff.improvements.length} improvement(s)`);
    for (const r of diff.regressions) console.log(`  ! ${r.caseId} ${r.assertionId}: ${r.from} → ${r.to}`);
  } else {
    console.log('trend: no comparable previous run (this becomes a regression check from run 2)');
  }
}

/* ── self-test ────────────────────────────────────────────────── */

/**
 * Grade the fixture corpus and verify the checker fails EXACTLY what each fixture
 * declares.
 *
 * This is the mode that answers "can your harness fail?". It exits non-zero when
 * the checker under-fires (missed a planted defect) OR over-fires (invented a
 * failure on a good answer) — both are instrument faults. It also enforces that
 * every assertion id has been seen red at least once, so a new assertion cannot
 * be added without a proof it can go red.
 */
function runSelfTest(): number {
  const cases: CounselGradeAssessment[] = [];
  const everFailed = new Set<string>();
  let anyGreen = false;
  const mismatches: string[] = [];

  console.log('');
  console.log('NV-COUNSEL-GRADE-EVAL-001 — self-test: does the checker fail what it should?');
  console.log('='.repeat(100));

  for (const f of COUNSEL_GRADE_FIXTURES) {
    if (ONLY && !ONLY.includes(f.config.id)) continue;
    const a = assessAnswer(
      { body: f.body, envelope: f.envelope, httpStatus: f.httpStatus, transportError: f.transportError },
      f.config,
    );
    cases.push(a);

    const gotFail = a.assertions.filter((x) => x.status === 'fail').map((x) => x.id).sort();
    const gotBlocked = a.assertions.filter((x) => x.status === 'blocked').map((x) => x.id).sort();
    const wantFail = [...f.expectFailing].sort();
    const wantBlocked = [...(f.expectBlocked ?? [])].sort();
    for (const id of gotFail) everFailed.add(id);
    if (gotFail.length === 0 && gotBlocked.length === 0) anyGreen = true;

    const okFail = JSON.stringify(gotFail) === JSON.stringify(wantFail);
    const okBlocked = JSON.stringify(gotBlocked) === JSON.stringify(wantBlocked);
    if (okFail && okBlocked) {
      console.log(
        `✓ ${f.config.id.padEnd(40)} red=[${gotFail.join(',') || '—'}] blocked=${gotBlocked.length}`,
      );
    } else {
      mismatches.push(f.config.id);
      console.log(`✗ ${f.config.id}`);
      if (!okFail) console.log(`    fail:    expected [${wantFail}] got [${gotFail}]`);
      if (!okBlocked) console.log(`    blocked: expected [${wantBlocked}] got [${gotBlocked}]`);
      for (const x of a.assertions.filter((y) => y.status === 'fail' || y.status === 'blocked')) {
        console.log(`      ${x.status} ${x.id}: ${x.detail}`);
      }
    }
  }

  /* NV-VALIDATE-THE-PROBE-001 controls. An "all green" self-test over a corpus of
   * planted defects means the CHECKER is broken, not that the fixtures are clean. */
  const qualityIds = [
    'length_floor', 'authority_density', 'envelope_honesty', 'draft_structure',
    'statute_currency', 'anti_fabrication', 'deterministic_fidelity', 'good_law_signal',
    'structured_fields',
  ];
  const neverRed = ONLY ? [] : qualityIds.filter((id) => !everFailed.has(id));

  console.log('-'.repeat(100));
  console.log(`fixtures graded: ${cases.length}`);
  console.log(`CONTROL some-fixture-fully-green = ${anyGreen}  (MUST be true — else the checker is a stuck red light)`);
  console.log(`CONTROL assertions-proven-red    = ${everFailed.size}/${qualityIds.length}`);
  console.log(`CONTROL never-proven-red         = [${neverRed.join(', ') || 'none'}]  (MUST be empty)`);
  console.log(`mismatches: ${mismatches.length}${mismatches.length ? ` → ${mismatches.join(', ')}` : ''}`);

  if (mismatches.length > 0) {
    console.error('\n✗ SELF-TEST FAILED — the checker does not grade the fixtures as declared.');
    console.error('  Under-firing means a planted defect went undetected.');
    console.error('  Over-firing means a correct answer was failed — a false failure, which is worse.');
    return 1;
  }
  if (!anyGreen || neverRed.length > 0) {
    console.error('\n✗ SELF-TEST FAILED — control violated; the harness is not falsifiable.');
    return 1;
  }
  console.log('\n✓ SELF-TEST PASSED — every assertion has been observed failing on a bad input');
  console.log('  and passing on a good one. The harness can fail.');
  return 0;
}

/* ── main ─────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!MODE_SELF_TEST && !GATEWAY && !RESPONSES_FILE) {
    console.error('');
    console.error('NV-COUNSEL-GRADE-EVAL-001 — counsel-grade quality regression harness');
    console.error('');
    console.error('  Hermetic (no network, proves the checker can fail):');
    console.error('    npm run eval:counsel-grade:self-test');
    console.error('');
    console.error('  Live against a running gateway:');
    console.error('    npm run eval:counsel-grade -- --gateway https://api.nyayasiddhi.online \\');
    console.error(`        --key-env ${KEY_ENV} --label after-p0-fix`);
    console.error('');
    console.error('  Grade responses captured earlier (e.g. on the EC2 host over SSM) — no spend:');
    console.error('    npm run eval:counsel-grade -- --responses .local/probes/captured.json --label ec2-capture');
    console.error('');
    console.error('  CI regression gate (needs a live gateway + a previous run):');
    console.error('    npm run eval:counsel-grade:gate -- --gateway <url>');
    console.error('');
    console.error('  Flags: --set <file> --only a,b --timeout <ms> --label <s> --out <dir>');
    console.error('         --gate (regression) --absolute-gate (any failure) --compare-to <artifact.json>');
    console.error('');
    process.exit(2);
  }

  const mode: 'self-test' | 'live' = MODE_SELF_TEST ? 'self-test' : 'live';
  const cases: CounselGradeAssessment[] = [];

  let setName = 'fixtures:_nv-counsel-grade-fixtures.ts';
  let selfTestExit = 0;

  if (mode === 'self-test') {
    selfTestExit = runSelfTest();
    cases.push(...COUNSEL_GRADE_FIXTURES
      .filter((f) => !ONLY || ONLY.includes(f.config.id))
      .map((f) => assessAnswer(
        { body: f.body, envelope: f.envelope, httpStatus: f.httpStatus, transportError: f.transportError },
        f.config,
      )));
  } else {
    const set = loadSet();
    setName = SET_FILE;
    const selected = set.cases.filter((c) => !ONLY || ONLY.includes(c.id));
    if (selected.length === 0) fail(`--only ${ONLY?.join(',')} selected zero cases`);

    if (RESPONSES_FILE) {
      const file = path.isAbsolute(RESPONSES_FILE) ? RESPONSES_FILE : path.join(ROOT, RESPONSES_FILE);
      if (!fs.existsSync(file)) fail(`--responses not found: ${file}`);
      const captured = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CapturedResponse>;
      const matched = selected.filter((c) => captured[c.id]).length;
      /* Validate the instrument: zero matches means the capture keys and the set
       * ids disagree, which would render every case `blocked` and read as a total
       * platform failure. Prefer the boring explanation. */
      if (matched === 0) {
        fail(
          `--responses ${path.basename(file)} matched 0 of ${selected.length} case ids. `
          + `Capture keys: [${Object.keys(captured).join(', ')}]. The capture and the set disagree — `
          + 'that is an instrument fault, not a quality result.',
        );
      }
      console.log('');
      console.log(`NV-COUNSEL-GRADE-EVAL-001 offline grade — ${matched}/${selected.length} `
        + `case(s) present in ${path.relative(ROOT, file)}`);
      console.log('');
      for (const c of selected) {
        cases.push(assessAnswer(fromCaptured(c, captured[c.id]), c));
      }
    } else {
      const apiKey = process.env[KEY_ENV] || '';
      /* Validate the instrument before blaming the platform: an empty key produces
       * 401s on every case, which would look like a total quality collapse. */
      if (!apiKey) {
        fail(
          `env var ${KEY_ENV} is empty (key_len=0). Every case would 401 and the report would `
          + 'read as a platform-wide quality failure. Export the key and rerun.',
        );
      }
      console.log('');
      console.log(`NV-COUNSEL-GRADE-EVAL-001 live run — host=${safeHost(GATEWAY!)} `
        + `key=${KEY_ENV}(len=${apiKey.length}) timeout=${CASE_TIMEOUT_MS}ms`);
      console.log('cases run SEQUENTIALLY — research/draft measured 55–65 s each');
      console.log('');

      for (const c of selected) {
        process.stdout.write(`  → ${c.id} (${c.family}) … `);
        const answer = await fetchLive(c, GATEWAY!, apiKey);
        const a = assessAnswer(answer, c);
        cases.push(a);
        process.stdout.write(
          `${answer.latencyMs ?? '?'}ms ${a.bodyChars}ch `
          + `${a.failed > 0 ? `FAIL(${a.assertions.filter((x) => x.status === 'fail').map((x) => x.id).join(',')})`
            : a.blockedCount > 0 ? 'BLOCKED' : 'ok'}\n`,
        );
      }
    }
  }

  const artifact = buildArtifact(mode, setName, cases);
  const previous = findPreviousRun(mode);
  const diff = diffRuns(previous ? { cases: previous.artifact.cases } : null, { cases });

  const stamp = artifact.generatedAt.replace(/[:.]/g, '-');
  const dir = OUT_DIR
    ? (path.isAbsolute(OUT_DIR) ? OUT_DIR : path.join(ROOT, OUT_DIR))
    : path.join(ARTIFACT_ROOT, `${LABEL}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'counsel-grade.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(artifact, diff));

  if (mode === 'live') printConsole(artifact, diff);
  else if (diff.comparable) {
    console.log('');
    console.log(`trend vs ${path.relative(ROOT, previous!.file)}: `
      + `${diff.regressions.length} regression(s), ${diff.improvements.length} improvement(s)`);
  }

  console.log('');
  console.log(`artifacts: ${path.relative(ROOT, dir)}/{counsel-grade.json,report.md}`);
  if (previous) console.log(`compared against: ${path.relative(ROOT, previous.file)}`);

  /* ── gates ──
   * `blocked` never trips a gate. Only a delivered-and-bad answer does. */
  if (selfTestExit !== 0) process.exit(selfTestExit);

  if (GATE_ABSOLUTE && artifact.totals.assertionsFailed > 0) {
    console.error(`\n✗ EXIT 1 (--absolute-gate): ${artifact.totals.assertionsFailed} failing assertion(s).`);
    process.exit(1);
  }
  if (GATE_REGRESSION) {
    if (!diff.comparable) {
      console.log('\n--gate: no comparable baseline yet, so nothing to regress against. Exiting 0');
      console.log('  and recording this run as the baseline. Re-run --gate after the next change.');
      process.exit(0);
    }
    if (diff.regressions.length > 0) {
      console.error(`\n✗ EXIT 1 (--gate): ${diff.regressions.length} quality regression(s) since the previous run.`);
      process.exit(1);
    }
    if (diff.droppedCases.length > 0) {
      console.error(`\n✗ EXIT 1 (--gate): case(s) vanished from the set: ${diff.droppedCases.join(', ')}.`);
      console.error('  A shrinking eval set is the quietest way to turn a board green.');
      process.exit(1);
    }
    console.log('\n✓ --gate: no regression since the previous run.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
