#!/usr/bin/env node
/**
 * NV-BENCH-COST-001 — the instrument behind the "70 % cost reduction" claim.
 *
 * Measures the JRX orchestrated path against a REAL direct provider call on a
 * frozen set under `docs/audit/eval/` (`--set`, default v1), reads spend from
 * the repaired metering (M1–M4), cross-checks the envelope's `cost.completions`
 * against an independent count from provider log lines, and reports per-class and
 * blended figures with the class weighting stated.
 *
 * It is an instrument, not a marketing artifact. If the measured figure is 40 %,
 * it prints 40 %. There are no hardcoded savings anywhere in this file
 * (NV-NO-STUB-001) — every number is derived from a live response, a provider log
 * line, or the deployed model catalog's own prices.
 *
 * Usage (jrx-prod, via SSM):
 *   source scripts/jrx-source-dev-deploy-env.sh
 *   node scripts/jrx-benchmark-cost.mjs --label before-leaf-budget-fix
 *   node scripts/jrx-benchmark-cost.mjs --only statute-faq,single-issue-advice --runs 2
 *   node scripts/jrx-benchmark-cost.mjs --offline .local/benchmarks/<run>/raw.json
 *
 * Flags:
 *   --label <s>     names the pass (use it to pair a before/after)
 *   --set <file>    benchmark set under docs/audit/eval, or an absolute path
 *                   (default jrx-cost-benchmark-set.v1.json). The v2 set adds
 *                   distinct topics per class, a per-run resolution signal and a
 *                   cold/warm split; see its `_meta` for what it can prove.
 *   --runs N        repetitions per prompt. NOTE: repeats of the SAME prompt hit
 *                   the semantic cache, so runs 2..N measure CACHE BENEFIT, not
 *                   sampling variance. The report uses cold (run 1) for headline
 *                   cost and reports the warm repeats separately. Independent
 *                   variance needs the distinct prompts per class that the v2 set
 *                   provides.
 *   --only a,b      restrict to class ids
 *   --skip a,b      exclude class ids
 *   --no-direct     skip the direct baseline (cost figures become JRX-only)
 *   --out <dir>     artifact dir (default .local/benchmarks/<label>-<ts>)
 *   --offline <p>   re-derive the report from a saved raw.json, spending nothing
 *   --dry-run       print the dispatch plan and exit
 */
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { aggregate } from './_nv-benchmark-cost-report.mjs';
import { renderReport } from './_nv-benchmark-cost-render.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const SET_DIR = path.join(ROOT, 'docs/audit/eval');
const DEFAULT_SET = 'jrx-cost-benchmark-set.v1.json';
const RUNNER = path.join(HERE, '_ec2-bench-cost-run.sh');
const EXTRACTOR = path.join(HERE, '_nv-provider-usage-extract.py');
const PRICES = path.join(HERE, '_nv-catalog-prices.py');
const HOST_WORK = '/tmp/jrx-bench';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const has = (name) => process.argv.includes(`--${name}`);
const die = (msg) => { console.error(`FATAL: ${msg}`); process.exit(2); };

const aws = (args, { timeout = 120_000 } = {}) =>
  execFileSync('aws', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });

/**
 * Send one script to the host and wait for it.
 *
 * Payload is base64 + a params FILE, never inline `commands=[...]`: SSM executes
 * the command list with `sh`, so a bash-only construct (or a quote in a legal
 * prompt) breaks in ways that look like a host failure. base64 sidesteps both.
 */
function ssmRun(instanceId, files, env, script, { timeoutSec = 900, pollMs = 15_000 }) {
  const cmds = [`mkdir -p ${HOST_WORK}`];
  for (const [name, content] of Object.entries(files)) {
    const b64 = Buffer.from(content).toString('base64');
    cmds.push(`printf %s '${b64}' | base64 -d > ${HOST_WORK}/${name}`);
  }
  const exports = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(' ');
  cmds.push(`${exports} bash ${HOST_WORK}/${script}`);

  const paramsFile = path.join(os.tmpdir(), `nvb-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(paramsFile, JSON.stringify({ commands: cmds }));
  let commandId;
  try {
    commandId = aws([
      'ssm', 'send-command',
      '--instance-ids', instanceId,
      '--document-name', 'AWS-RunShellScript',
      '--timeout-seconds', String(timeoutSec),
      '--parameters', `file://${paramsFile}`,
      '--query', 'Command.CommandId', '--output', 'text',
    ]).trim();
  } finally {
    fs.rmSync(paramsFile, { force: true });
  }

  const deadline = Date.now() + (timeoutSec + 120) * 1000;
  for (;;) {
    if (Date.now() > deadline) return { commandId, status: 'DriverTimeout', output: '' };
    const sleep = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sleep, 0, 0, pollMs);
    const status = aws([
      'ssm', 'list-command-invocations', '--command-id', commandId, '--details',
      '--query', 'CommandInvocations[0].Status', '--output', 'text',
    ]).trim();
    if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(status)) {
      /* Read the output with `get-command-invocation`, NOT with
       * `list-command-invocations --query CommandPlugins[0].Output`.
       * list-* returns a ~2,500-character preview and appends
       * `---Output truncated---`; measured here, it dropped the tail chunk of
       * every payload larger than that, which the driver could only see as a
       * missing chunk. get-command-invocation returns up to 24,000 characters. */
      const output = aws([
        'ssm', 'get-command-invocation', '--command-id', commandId,
        '--instance-id', instanceId, '--query', 'StandardOutputContent', '--output', 'text',
      ]);
      const stderrTail = aws([
        'ssm', 'get-command-invocation', '--command-id', commandId,
        '--instance-id', instanceId, '--query', 'StandardErrorContent', '--output', 'text',
      ]);
      return { commandId, status, output, stderrTail };
    }
    process.stderr.write(`    …${status}\n`);
  }
}

function sentinel(output, tag) {
  const out = [];
  for (const line of String(output).split('\n')) {
    const t = line.trim();
    if (t.startsWith(`${tag} `)) out.push(t.slice(tag.length + 1));
  }
  return out;
}

/*
 * Every payload travels gzip + indexed fixed-width base64 chunks.
 *
 * Long single lines do not survive the trip intact — `aws ssm
 * list-command-invocations ... --output text` reflowed a ~1.5 KB base64 blob and
 * a ~9 KB price table, and the driver reported the damage as a JSON syntax error
 * rather than as transport corruption. Chunks carry `index total`, so a missing
 * or reordered chunk is detected and named instead of silently producing a
 * "no result" row that looks like a host failure.
 */
function gz(output, tag) {
  const parts = new Map();
  let total = null;
  for (const line of String(output).split('\n')) {
    const t = line.trim();
    if (!t.startsWith(`${tag} `)) continue;
    const m = /^\S+\s+(\d+)\s+(\d+)\s+(\S*)$/.exec(t);
    if (!m) continue;
    total = Number(m[2]);
    parts.set(Number(m[1]), m[3]);
  }
  if (total == null) return { value: null, error: null };
  const missing = [];
  let blob = '';
  for (let k = 0; k < total; k += 1) {
    if (!parts.has(k)) missing.push(k);
    else blob += parts.get(k);
  }
  if (missing.length) return { value: null, error: `${tag}: chunk(s) ${missing.join(',')} of ${total} missing` };
  try {
    return { value: JSON.parse(gunzipSync(Buffer.from(blob, 'base64')).toString('utf8')), error: null };
  } catch (err) {
    return { value: null, error: `${tag}: decode failed (${err.message})` };
  }
}

/**
 * Splice each `runAfter` prompt directly behind its predecessor.
 *
 * In v1 the repeat happened to carry the next id, so plain id order satisfied
 * "immediately after". v2's repeat sits at the end of the file, and any prompt
 * dispatched between the two would be free to evict or overwrite the entry the
 * repeat is supposed to hit.
 */
function orderWithRepeatsAdjacent(items) {
  const repeats = items.filter((p) => p.runAfter);
  if (repeats.length === 0) return items;
  const out = items.filter((p) => !p.runAfter);
  for (const r of repeats) {
    const at = out.findIndex((p) => p.id === r.runAfter);
    if (at < 0) out.push(r);
    else out.splice(at + 1, 0, r);
  }
  return out;
}

function main() {
  const setArg = String(arg('set', DEFAULT_SET));
  const setPath = path.isAbsolute(setArg) ? setArg : path.join(SET_DIR, setArg);
  if (!fs.existsSync(setPath)) die(`benchmark set not found: ${setPath}`);
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  const label = String(arg('label', 'unlabelled'));
  const runsPerPrompt = Number(arg('runs', 1));
  const only = arg('only') ? String(arg('only')).split(',').map((s) => s.trim()) : null;
  const skip = arg('skip') ? String(arg('skip')).split(',').map((s) => s.trim()) : [];
  const wantDirect = !has('no-direct');
  const offline = arg('offline');

  let raw;
  if (offline) {
    raw = JSON.parse(fs.readFileSync(String(offline), 'utf8'));
  } else {
    const instanceId = process.env.JRX_EC2_INSTANCE_ID;
    if (!instanceId) die('JRX_EC2_INSTANCE_ID unset — run `source scripts/jrx-source-dev-deploy-env.sh` first');

    let items = set.prompts.filter((p) => (!only || only.includes(p.classId)) && !skip.includes(p.classId));
    // A `runAfter` prompt measures a cache hit on its predecessor; running it out
    // of order or without that predecessor measures nothing.
    items = items.filter((p) => !p.runAfter || items.some((q) => q.id === p.runAfter));
    items.sort((a, b) => a.id - b.id);
    if (items.length === 0) die('no prompts selected');
    items = orderWithRepeatsAdjacent(items);

    const plan = [];
    // All cold runs before any warm run, so a cold run can only be contaminated
    // by a DIFFERENT prompt (which the set's own separation self-test catches)
    // and never by its own earlier repeat.
    for (let run = 1; run <= runsPerPrompt; run += 1) for (const item of items) plan.push({ item, run });

    if (has('dry-run')) {
      console.log(`plan: ${plan.length} invocations (${items.length} prompts x ${runsPerPrompt} run(s)), direct=${wantDirect}`);
      for (const { item, run } of plan) console.log(`  #${item.id} ${item.classId} run${run}`);
      return;
    }

    const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
    const extractorSrc = fs.readFileSync(EXTRACTOR, 'utf8');
    const pricesSrc = fs.readFileSync(PRICES, 'utf8');

    raw = {
      guardrail: 'NV-BENCH-COST-001',
      label,
      startedAt: new Date().toISOString(),
      setId: set.id,
      setVersion: set.version,
      setFrozenAt: set.frozenAt,
      setPath: path.relative(ROOT, setPath),
      runsPerPrompt,
      directEnabled: wantDirect,
      instanceId,
      baseline: set.baseline,
      build: null,
      prices: null,
      runs: [],
      answers: {},
      dispatch: [],
    };

    let n = 0;
    for (const { item, run } of plan) {
      n += 1;
      process.stderr.write(`[${n}/${plan.length}] #${item.id} ${item.classId} run${run} …\n`);
      const res = ssmRun(
        instanceId,
        {
          '_ec2-bench-cost-run.sh': runnerSrc,
          '_nv-provider-usage-extract.py': extractorSrc,
          '_nv-catalog-prices.py': pricesSrc,
          'item.json': JSON.stringify(item),
        },
        {
          NVB_RUN: run,
          NVB_DIRECT: wantDirect ? '1' : '0',
          NVB_DIRECT_MODEL: set.baseline.providerModelName,
          NVB_MAX_OUT: set.baseline.maxOutputTokens,
          NVB_EMIT_PRICES: raw.prices ? '0' : '1',
          NVB_EMIT_BUILD: '1',
        },
        '_ec2-bench-cost-run.sh',
        { timeoutSec: 900 },
      );

      raw.dispatch.push({ itemId: item.id, run, commandId: res.commandId, status: res.status });
      for (const note of sentinel(res.output, 'NVBENCH_NOTE')) console.error(`  note: ${note}`);
      const fatal = sentinel(res.output, 'NVBENCH_FATAL');
      if (fatal.length) {
        console.error(`  host fatal: ${fatal.join('; ')}`);
        // Recorded as a row, not dropped. A silently absent item shrinks the
        // blend's covered weight without saying why.
        raw.runs.push({
          itemId: item.id, classId: item.classId, run,
          nyv: { http: 'host-fatal' }, truth: {}, truthCalls: [], direct: {},
          hostStatus: res.status, hostFatal: fatal.join('; '),
        });
        continue;
      }
      const prices = gz(res.output, 'NVBENCH_PRICES_GZB64');
      if (prices.error) console.error(`  ${prices.error}`);
      if (prices.value && !raw.prices) raw.prices = prices.value;
      const build = gz(res.output, 'NVBENCH_BUILD_GZB64');
      if (build.error) console.error(`  ${build.error}`);
      if (build.value) {
        if (!raw.build) raw.build = build.value;
        // A redeploy mid-pass invalidates the pass: half the rows would describe
        // a different build than the other half.
        else if (raw.build.imageSha !== build.value.imageSha) {
          raw.buildChangedMidRun = { from: raw.build, to: build.value, atItem: item.id, atRun: run };
        }
      }
      const decoded = gz(res.output, 'NVBENCH_RESULT_GZB64');
      if (!decoded.value) {
        console.error(`  no usable result (status=${res.status})${decoded.error ? `: ${decoded.error}` : ''}`);
        raw.runs.push({
          itemId: item.id, classId: item.classId, run,
          nyv: { http: 'no-result' }, truth: {}, truthCalls: [], direct: {},
          hostStatus: res.status, transportError: decoded.error,
          hostOutputTail: String(res.output).slice(-1500),
        });
        continue;
      }
      const rec = decoded.value;
      raw.runs.push(rec);
      const ans = gz(res.output, 'NVBENCH_ANSWERS_GZB64');
      if (ans.error) console.error(`  ${ans.error}`);
      if (ans.value) raw.answers[`${rec.itemId}:${rec.run}`] = ans.value;
      const t = rec.truth || {};
      process.stderr.write(
        `    http=${rec.nyv?.http} wall=${rec.nyv?.wallSec}s billed=${t.billedCompletions} ` +
        `envelope=${rec.nyv?.envelopeCompletions} scope=${t.scopeMode} tok=${rec.nyv?.envelopePromptTokens}/${rec.nyv?.envelopeCompletionTokens}\n`,
      );
    }
    raw.finishedAt = new Date().toISOString();
  }

  if (!raw.prices?.models) die('no price table captured from the deployed catalog — cannot cost anything (refusing to guess prices)');

  const agg = aggregate({ set, runs: raw.runs, prices: raw.prices.models, answers: raw.answers || {} });

  const outDir = arg('out')
    ? String(arg('out'))
    : path.join(ROOT, '.local/benchmarks', `${raw.label || label}-${(raw.startedAt || new Date().toISOString()).replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.join(outDir, 'answers'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(raw, null, 2));
  fs.writeFileSync(path.join(outDir, 'aggregate.json'), JSON.stringify(
    { ...agg, classRows: agg.classRows.map(({ entries, ...r }) => r) }, null, 2,
  ));
  for (const [key, a] of Object.entries(raw.answers || {})) {
    const safe = key.replace(':', '-run');
    fs.writeFileSync(
      path.join(outDir, 'answers', `${safe}.md`),
      `# item ${a.itemId} (${a.classId}) run ${a.run}\n\n## prompt\n\n${a.prompt}\n\n` +
      `## JRX answer${a.nyvAnswerTruncated ? ' (TRUNCATED)' : ''}\n\n${a.nyvAnswer}\n\n` +
      `## direct baseline answer${a.directAnswerTruncated ? ' (TRUNCATED)' : ''}\n\n${a.directAnswer}\n`,
    );
  }

  const report = renderReport({ set, raw, agg });
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  console.log(report);
  console.error(`\nartifacts: ${outDir}`);

  // Exit non-zero when the envelope and the independent count disagree. A
  // benchmark that reports a cost figure on top of regressed metering is a
  // fiction, and it must not be possible to miss that in CI or in a shell loop.
  if (agg.meteringVerdict === 'METERING_REGRESSION') {
    console.error('\nEXIT 3: metering regression — envelope cost.completions disagreed with the independent provider-log count. Do not quote any % from this pass.');
    process.exit(3);
  }
  // A set whose prompts cross-hit each other's cached answers manufactures its
  // own savings. That is defect B in v1 and it went unnoticed for a whole pass,
  // so it exits non-zero rather than being left in the report body.
  if (agg.separation?.verdict === 'SEPARATION_VOID') {
    console.error(
      `\nEXIT 5: ${agg.separation.violations.length} prompt(s) declared expect-miss were served from the semantic cache on a COLD run. `
      + 'The set is not separated on this build — this pass is VOID and no figure from it may be quoted.',
    );
    process.exit(5);
  }
  if (agg.failures.length) {
    console.error(`\nEXIT 4: ${agg.failures.length} run(s) did not return HTTP 200 — the blend is incomplete.`);
    process.exit(4);
  }
}

main();
