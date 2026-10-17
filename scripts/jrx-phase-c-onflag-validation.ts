/**
 * scripts/jrx-phase-c-onflag-validation.ts
 *
 * Phase C ON-flag validation harness — R-7 of the v5.0.0 plan
 * (WIP/Phase-D-to-J-Execution-Plan-v5.0.0.md §4.1).
 *
 * Validates that each of the 4 Phase-C feature flags is correctly plumbed:
 *
 *   NYV_F_AUDIT_WIRE       (T-01 IronLedger audit on /orchestrate completion)
 *   NYV_F_HITL_REGISTRY    (T-03/04/05 registry-driven HITL thresholds)
 *   NYV_F_PII_JCN          (T-06b jurisdiction-scoped PII regexes)
 *   NYV_F_SECURITY_MONITOR (T-08 nv-security-monitor middleware mount)
 *
 * For each flag we:
 *   (1) Spawn an isolated child process with NODE_ENV=development and the
 *       single flag set ON. The child imports the SAME compiled flag module
 *       the Gateway uses (src/config/jrx-feature-flags.ts) and reports the
 *       full resolved flag map back as JSON.
 *   (2) Verify only that flag is reported `true` (others remain `false`,
 *       proving no cross-talk).
 *   (3) Verify the gated code path exists by static grep and is reachable
 *       from at least one route or service entry point.
 *
 * Behavioural end-to-end (auth'd curl matrix against /orchestrate, HITL
 * endpoints, injection payloads) is the EC2-grade pass and is explicitly
 * out of scope for this in-Replit run — see plan §4.1 and Option A.
 *
 * Run:   npx tsx scripts/jrx-phase-c-onflag-validation.ts
 * Output: writes .local/phase-c-onflag-validation-<ts>.log
 */

import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface FlagSpec {
  envVar: string;
  flagKey: string;        // key in the FLAGS object exported by nv-feature-flags
  description: string;
  ticket: string;
  // grep patterns that, when found, prove the gated code path is wired in.
  // Each pattern is run against `src/` via `rg -l` — at least one file must
  // match per pattern.
  wiringEvidence: { pattern: string; whatItProves: string }[];
  // Per-flag reachability: each gated function/symbol must have at least one
  // CONSUMER outside its defining file, otherwise the flag's behavior is
  // wired but unreached at runtime — which the architect review explicitly
  // called out for `hitlRegistry` (T-03/T-04/T-05). When `requiredConsumers`
  // is empty the harness skips this audit.
  reachabilityProbes: { symbol: string; definedIn: string; mustBeCalledFromOutside: true }[];
}

const FLAGS: FlagSpec[] = [
  {
    envVar: 'NYV_F_AUDIT_WIRE',
    flagKey: 'auditWire',
    description: 'Append IronLedger audit row on /orchestrate completion',
    ticket: 'T-01',
    wiringEvidence: [
      {
        pattern: "isNyvFeatureOn\\('auditWire'\\)",
        whatItProves: 'auditWire flag is read at runtime',
      },
    ],
    reachabilityProbes: [
      // The auditWire check lives inside an inline post-/orchestrate hook in
      // src/routes/jrx-orchestration-routes.ts and runs whenever the route
      // handler resolves; the route itself is mounted in src/index.ts via
      // app.use('/api/jrx/orchestrate', ...). No external symbol audit needed
      // because the gated path is a top-level route handler, not a service
      // method anyone has to remember to call.
    ],
  },
  {
    envVar: 'NYV_F_HITL_REGISTRY',
    flagKey: 'hitlRegistry',
    description: 'Registry-driven HITL thresholds + reviewer routing + auto-approve audit',
    ticket: 'T-03/T-04/T-05',
    wiringEvidence: [
      {
        pattern: "isNyvFeatureOn\\('hitlRegistry'\\)",
        whatItProves: 'hitlRegistry flag is read at runtime',
      },
    ],
    reachabilityProbes: [
      // The hitlRegistry flag is checked inside HitlWorkflowService.startExecution.
      // For the flag to influence runtime, some HTTP handler / orchestration
      // hook must actually call hitlWorkflowService.startExecution(). The
      // architect review (R-7) flagged this as a wired-but-unreached path.
      {
        symbol: 'hitlWorkflowService.startExecution',
        definedIn: 'src/services/hitl-workflow-service.ts',
        mustBeCalledFromOutside: true,
      },
    ],
  },
  {
    envVar: 'NYV_F_PII_JCN',
    flagKey: 'piiJcn',
    description: 'Append jurisdiction-scoped PII regexes to safety pipeline Step 1',
    ticket: 'T-06b',
    wiringEvidence: [
      {
        pattern: "isNyvFeatureOn\\('piiJcn'\\)",
        whatItProves: 'piiJcn flag is read at runtime',
      },
    ],
    reachabilityProbes: [
      // The piiJcn check lives inside the safety pipeline's Step 1, which is
      // executed for every /orchestrate request. The pipeline is invoked by
      // the orchestrator on each call, so the gated path is reached without
      // needing an additional consumer audit.
    ],
  },
  {
    envVar: 'NYV_F_SECURITY_MONITOR',
    flagKey: 'securityMonitor',
    description: 'Mount nv-security-monitor middleware on /api/jrx/*',
    ticket: 'T-08',
    wiringEvidence: [
      // index.ts uses a locally-aliased _flagOn(), not isNyvFeatureOn(),
      // for the securityMonitor mount. Accept either form.
      {
        pattern: "_flagOn\\('securityMonitor'\\)",
        whatItProves: 'securityMonitor flag is read at server bootstrap to gate the middleware mount',
      },
      {
        pattern: 'securityMonitorMiddleware',
        whatItProves: './jrx-security-monitor middleware export is mounted on /api/jrx/*',
      },
    ],
    reachabilityProbes: [
      // securityMonitorMiddleware is mounted via app.use('/api/jrx/', ...) in
      // src/index.ts; Express invokes it on every matching request. No extra
      // reachability evidence needed beyond the wiring proof above.
    ],
  },
];

interface ProbeResult {
  flag: FlagSpec;
  isolation: {
    targetTrue: boolean;
    othersFalse: boolean;
    rawMap: Record<string, boolean>;
    error?: string;
  };
  wiring: { pattern: string; whatItProves: string; matches: string[] }[];
  reachability: {
    symbol: string;
    definedIn: string;
    externalCallsites: string[];
    reachable: boolean;
  }[];
  pass: boolean;
  notes: string[];
}

function spawnFlagProbe(flag: FlagSpec): ProbeResult['isolation'] {
  // Build a tiny eval script the child runs. We use process.cwd() so the
  // import path resolves the same way the Gateway resolves it.
  const child = `
    import('./src/config/jrx-feature-flags.ts')
      .then((m) => {
        // The v5.0.0 module exports the resolved map as NYV_FEATURE_FLAGS
        // and the helper isNyvFeatureOn(flag). We snapshot the map here so
        // the parent process can grade isolation cleanly.
        const map =
          (m as any).NYV_FEATURE_FLAGS ||
          (m as any).FLAGS ||
          (m as any).default ||
          {};
        // eslint-disable-next-line no-console
        console.log('NV_FLAG_PROBE_RESULT=' + JSON.stringify(map));
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('NV_FLAG_PROBE_ERROR=' + (e && e.message ? e.message : String(e)));
        process.exit(2);
      });
  `;

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    // Reset every Phase-C flag, then enable only the target one.
    NYV_F_AUDIT_WIRE: '',
    NYV_F_HITL_REGISTRY: '',
    NYV_F_PII_JCN: '',
    NYV_F_SECURITY_MONITOR: '',
    NYV_F_CITATION_WIRE: '',
    NYV_F_TOKEN_OPT: '',
    [flag.envVar]: 'true',
  };

  const r = spawnSync(
    'npx',
    ['tsx', '--eval', child],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf-8',
      timeout: 30_000,
    },
  );

  if (r.error) {
    return {
      targetTrue: false,
      othersFalse: false,
      rawMap: {},
      error: `spawn error: ${r.error.message}`,
    };
  }

  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const m = out.match(/NV_FLAG_PROBE_RESULT=(\{[^\n]*\})/);
  if (!m) {
    const errMatch = out.match(/NV_FLAG_PROBE_ERROR=(.+)/);
    return {
      targetTrue: false,
      othersFalse: false,
      rawMap: {},
      error: errMatch ? errMatch[1] : `probe produced no result. exit=${r.status}. tail: ${out.slice(-400)}`,
    };
  }

  let parsed: Record<string, boolean> = {};
  try {
    parsed = JSON.parse(m[1]);
  } catch (e: any) {
    return {
      targetTrue: false,
      othersFalse: false,
      rawMap: {},
      error: `JSON parse failed: ${e.message}`,
    };
  }

  const targetTrue = parsed[flag.flagKey] === true;
  const others = Object.entries(parsed).filter(([k]) => k !== flag.flagKey);
  const othersFalse = others.every(([, v]) => v === false);
  return { targetTrue, othersFalse, rawMap: parsed };
}

function checkWiring(spec: FlagSpec): ProbeResult['wiring'] {
  const out: ProbeResult['wiring'] = [];
  for (const ev of spec.wiringEvidence) {
    let matches: string[] = [];
    try {
      const r = execSync(
        `rg -l --type ts ${JSON.stringify(ev.pattern)} src/ 2>/dev/null || true`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      matches = r.trim().split('\n').filter(Boolean);
    } catch {
      matches = [];
    }
    out.push({ pattern: ev.pattern, whatItProves: ev.whatItProves, matches });
  }
  return out;
}

function checkReachability(spec: FlagSpec): ProbeResult['reachability'] {
  const out: ProbeResult['reachability'] = [];
  for (const probe of spec.reachabilityProbes) {
    // Search for callsites of `<symbol>(` anywhere under src/, then exclude
    // the file the symbol is defined in (its own internal references don't
    // count as external consumers).
    const symbolForGrep = probe.symbol.replace(/[.[\]]/g, (c) => `\\${c}`);
    const pattern = `${symbolForGrep}\\(`;
    let allHits: string[] = [];
    try {
      const r = execSync(
        `rg -l --type ts ${JSON.stringify(pattern)} src/ 2>/dev/null || true`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      allHits = r.trim().split('\n').filter(Boolean);
    } catch {
      allHits = [];
    }
    const externalCallsites = allHits.filter((f) => f !== probe.definedIn);
    out.push({
      symbol: probe.symbol,
      definedIn: probe.definedIn,
      externalCallsites,
      reachable: externalCallsites.length > 0,
    });
  }
  return out;
}

function gradeProbe(p: Omit<ProbeResult, 'pass' | 'notes'>): { pass: boolean; notes: string[] } {
  const notes: string[] = [];
  let pass = true;

  if (p.isolation.error) {
    notes.push(`ISOLATION ERROR: ${p.isolation.error}`);
    pass = false;
  } else {
    if (!p.isolation.targetTrue) {
      notes.push(`Target flag ${p.flag.flagKey} did NOT report true with ${p.flag.envVar}=true.`);
      pass = false;
    }
    if (!p.isolation.othersFalse) {
      const cross = Object.entries(p.isolation.rawMap)
        .filter(([k, v]) => k !== p.flag.flagKey && v === true)
        .map(([k]) => k);
      notes.push(`CROSS-TALK detected — other flags also true: ${cross.join(', ')}`);
      pass = false;
    }
  }

  for (const w of p.wiring) {
    if (w.matches.length === 0) {
      notes.push(`Wiring evidence missing — pattern "${w.pattern}" not found in src/. ${w.whatItProves}`);
      pass = false;
    }
  }

  for (const r of p.reachability) {
    if (!r.reachable) {
      notes.push(
        `REACHABILITY GAP — ${r.symbol} (defined in ${r.definedIn}) has ZERO external callsites. ` +
        `The flag's gated branch is statically wired but cannot fire at runtime ` +
        `until an HTTP handler / orchestration hook actually invokes it.`,
      );
      pass = false;
    }
  }

  if (notes.length === 0) notes.push('OK');
  return { pass, notes };
}

function main(): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const localDir = path.resolve(process.cwd(), '..', '.local');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  const logPath = path.join(localDir, `phase-c-onflag-validation-${ts}.log`);

  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('  Phase C ON-flag validation — Nyayavigya v5.0.0 R-7');
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push(`  Scope: flag plumbing isolation + static wiring evidence.`);
  lines.push(`  Auth'd curl matrix is EC2-grade and explicitly deferred — see`);
  lines.push(`  WIP/Phase-D-to-J-Execution-Plan-v5.0.0.md §4.1 + Option A.`);
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('');

  const results: ProbeResult[] = [];
  for (const spec of FLAGS) {
    process.stdout.write(`[probe] ${spec.envVar} ... `);
    const isolation = spawnFlagProbe(spec);
    const wiring = checkWiring(spec);
    const reachability = checkReachability(spec);
    const partial: Omit<ProbeResult, 'pass' | 'notes'> = { flag: spec, isolation, wiring, reachability };
    const grade = gradeProbe(partial);
    const full: ProbeResult = { ...partial, ...grade };
    results.push(full);
    process.stdout.write(grade.pass ? 'PASS\n' : 'FAIL\n');
  }

  for (const r of results) {
    lines.push('-------------------------------------------------------------------');
    lines.push(`Flag:        ${r.flag.envVar}  (key=${r.flag.flagKey}, ticket=${r.flag.ticket})`);
    lines.push(`Description: ${r.flag.description}`);
    lines.push(`Verdict:     ${r.pass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('  Isolation probe (spawn child with ONLY this flag ON):');
    if (r.isolation.error) {
      lines.push(`    error: ${r.isolation.error}`);
    } else {
      lines.push(`    target ${r.flag.flagKey} = ${r.isolation.rawMap[r.flag.flagKey]}`);
      lines.push(`    full map: ${JSON.stringify(r.isolation.rawMap)}`);
      lines.push(`    targetTrue=${r.isolation.targetTrue}  othersFalse=${r.isolation.othersFalse}`);
    }
    lines.push('');
    lines.push('  Wiring evidence:');
    for (const w of r.wiring) {
      lines.push(`    pattern: ${w.pattern}`);
      lines.push(`    proves : ${w.whatItProves}`);
      lines.push(`    found in ${w.matches.length} file(s):`);
      for (const f of w.matches) {
        lines.push(`      - ${f}`);
      }
    }
    lines.push('');
    lines.push('  Reachability audit (gated symbol must have ≥1 external callsite):');
    if (r.reachability.length === 0) {
      lines.push('    n/a — flag gates a top-level route handler / middleware mount.');
    } else {
      for (const rp of r.reachability) {
        lines.push(`    symbol  : ${rp.symbol}`);
        lines.push(`    defined : ${rp.definedIn}`);
        lines.push(`    callers : ${rp.externalCallsites.length} external file(s)`);
        for (const f of rp.externalCallsites) {
          lines.push(`      - ${f}`);
        }
        lines.push(`    reachable: ${rp.reachable ? 'YES' : 'NO — wired-but-unreached'}`);
      }
    }
    lines.push('');
    lines.push('  Notes:');
    for (const n of r.notes) {
      lines.push(`    - ${n}`);
    }
    lines.push('');
  }

  const allPass = results.every((r) => r.pass);
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push(`  SUMMARY: ${results.filter((r) => r.pass).length}/${results.length} flags PASS`);
  lines.push(`  OVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
  lines.push('═══════════════════════════════════════════════════════════════════');

  fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`\nWrote validation log: ${logPath}`);
  process.exit(allPass ? 0 : 1);
}

main();
