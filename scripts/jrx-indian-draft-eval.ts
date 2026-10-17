#!/usr/bin/env tsx
/**
 * NV-INDIAN-DRAFT-EVAL-001 — SME rubric + NSP routing audit + optional live A/B lanes.
 *
 *   npm run eval:draft:india              # routing audit + rubric self-test (no LLM)
 *   npm run eval:draft:india -- --live    # + orchestrate fast-medium vs counsel-comprehensive
 *   npm run eval:draft:india -- --live --case IN-BAIL-001
 *   npm run eval:draft:india -- --live --lane=fast   # fast-medium only (shorter CI/QA slice)
 *   npm run eval:draft:india -- --live --lane=counsel
 *
 * Live mode needs NYV_SDK_KEY or NYV_SDK_KEY_NSP (length logged only). Never prints secrets.
 * Scoreboards: docs/audit/eval/draft-scoreboard-*.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
import { scoreIndianDraftRubric } from './jrx-indian-draft-eval-rubric.js';
import { auditNspDraftRouting } from './jrx-indian-draft-routing-audit.js';
import type { DraftDocumentType } from '../src/config/jrx-draft-length-registry.js';
import { buildLegalDraftSystemPrompt } from '../src/services/jrx-legal-drafting-prompt.js';
import { recordDraftRubricObservation } from '../src/services/jrx-draft-rubric-grpo-bridge.js';

export { auditNspDraftRouting } from './jrx-indian-draft-routing-audit.js';

type SmeCase = {
  id: string;
  documentType: DraftDocumentType;
  label: string;
  parameters: Record<string, unknown>;
  prompt: string;
};

type FixtureFile = { cases: SmeCase[] };

const FIXTURE = path.resolve(
  process.cwd(),
  'scripts/fixtures/jrx-indian-draft-sme-cases.json',
);
const EVAL_DIR = path.resolve(process.cwd(), 'docs/audit/eval');

function loadCases(filterId?: string): SmeCase[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as FixtureFile;
  const cases = raw.cases || [];
  if (filterId) {
    const one = cases.filter((c) => c.id === filterId);
    if (!one.length) throw new Error(`unknown case id: ${filterId}`);
    return one;
  }
  return cases;
}

function rubricSelfTest(): void {
  const sample = buildLegalDraftSystemPrompt({
    jurisdiction: 'IN',
    template: 'bail_application',
    documentType: 'bail_application',
    partnerBestOutcome: true,
  });
  if (sample.length < 500) throw new Error('prompt self-test: system prompt too short');
  const score = scoreIndianDraftRubric({
    content: 'IN THE COURT OF SESSIONS\n\nMOST RESPECTFULLY SHOWETH:\n1. Facts.\n\nPRAYER\nGrant bail.\n\nVERIFICATION\nI verify.\n\nAdvocate for Petitioner',
    documentType: 'bail_application',
    prompt: 'bail',
  });
  if (score.pct < 50) throw new Error(`rubric self-test: score too low (${score.pct})`);
}

async function orchestrateLiveViaCurl(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ http: number; ms: number; content: string; model?: string; path?: string }> {
  const t0 = Date.now();
  const url = `${baseUrl.replace(/\/$/, '')}/api/jrx/orchestrate`;
  const payloadPath = path.join(EVAL_DIR, `.eval-payload-${process.pid}.json`);
  fs.mkdirSync(EVAL_DIR, { recursive: true });
  fs.writeFileSync(payloadPath, JSON.stringify(body));
  try {
    const sec = Math.max(30, Math.ceil(timeoutMs / 1000));
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-sS',
        '-m',
        String(sec),
        '-w',
        '\n__HTTP__%{http_code}',
        '-X',
        'POST',
        url,
        '-H',
        'Content-Type: application/json',
        '-H',
        'X-NYV-Platform: nsp',
        '-H',
        `X-API-Key: ${apiKey}`,
        '-d',
        `@${payloadPath}`,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const ms = Date.now() - t0;
    const marker = stdout.lastIndexOf('\n__HTTP__');
    const rawBody = marker >= 0 ? stdout.slice(0, marker) : stdout;
    const http = marker >= 0 ? Number(stdout.slice(marker + 8)) || 0 : 0;
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    const payload = (json.data ?? json) as Record<string, unknown>;
    const content = String(
      payload.content ?? payload.text ?? json.content ?? json.text ?? '',
    );
    const orch = (payload.orchestration || json.orchestration || {}) as Record<string, unknown>;
    const routing = (payload.routing || json.routing || {}) as Record<string, unknown>;
    return {
      http,
      ms,
      content,
      model: String(payload.model ?? json.model ?? orch.model ?? ''),
      path: typeof routing.path === 'string' ? routing.path : undefined,
    };
  } finally {
    try {
      fs.unlinkSync(payloadPath);
    } catch {
      /* ignore */
    }
  }
}

async function orchestrateLiveOnce(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ http: number; ms: number; content: string; model?: string; path?: string }> {
  if (timeoutMs > 180_000 || process.env.NYV_EVAL_USE_CURL === '1') {
    return orchestrateLiveViaCurl(baseUrl, apiKey, body, timeoutMs);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/jrx/orchestrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-NYV-Platform': 'nsp',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    const json = (await res.json()) as Record<string, unknown>;
    const payload = (json.data ?? json) as Record<string, unknown>;
    const content = String(
      payload.content ?? payload.text ?? json.content ?? json.text ?? '',
    );
    const orch = (payload.orchestration || json.orchestration || {}) as Record<string, unknown>;
    const routing = (payload.routing || json.routing || {}) as Record<string, unknown>;
    return {
      http: res.status,
      ms,
      content,
      model: String(payload.model ?? json.model ?? orch.model ?? ''),
      path: typeof routing.path === 'string' ? routing.path : undefined,
    };
  } finally {
    clearTimeout(t);
  }
}

async function orchestrateLive(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ http: number; ms: number; content: string; model?: string; path?: string }> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await orchestrateLiveOnce(baseUrl, apiKey, body, timeoutMs);
    } catch (err: unknown) {
      lastErr = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = rawMsg.replace(/X-API-Key:\s*\S+/gi, 'X-API-Key: [REDACTED]');
      console.warn(`    orchestrate retry ${attempt}/${maxAttempts}: ${msg.slice(0, 240)}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 15_000 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function loadApiKey(): string {
  const k = process.env.NYV_SDK_KEY_NSP || process.env.NYV_SDK_KEY || '';
  if (k.length < 20) throw new Error('live mode requires NYV_SDK_KEY_NSP or NYV_SDK_KEY (len>20)');
  return k;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const gate = args.includes('--gate');
  const caseArg = args.find((a) => a.startsWith('--case='))?.split('=')[1];
  const laneArg = args.find((a) => a.startsWith('--lane='))?.split('=')[1] as
    | 'fast'
    | 'counsel'
    | 'both'
    | undefined;
  const laneMode = laneArg === 'fast' || laneArg === 'counsel' ? laneArg : 'both';
  const baseUrl = process.env.NYV_EVAL_BASE_URL || 'https://api.nyayasiddhi.online';

  rubricSelfTest();
  const cases = loadCases(caseArg);

  const routingRows = cases.map((c) => auditNspDraftRouting(c));
  const routingFails = routingRows.filter((r) => !r.pass);

  console.log('=== NV-INDIAN-DRAFT-EVAL-001 ===');
  console.log(`cases=${cases.length} routing_pass=${routingRows.length - routingFails.length}/${routingRows.length}`);
  for (const r of routingRows) {
    console.log(
      `  ${r.pass ? 'OK' : 'FAIL'} ${r.caseId} fastTok=${r.fastMedium.partnerMaxTokens} counselTok=${r.counselComprehensive.partnerMaxTokens} queen=${r.counselComprehensive.queenPath}${r.notes.length ? ` notes=${r.notes.join(';')}` : ''}`,
    );
  }

  const scoreboard: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live+ab' : 'routing+rubric-selftest',
    fixture: path.basename(FIXTURE),
    routing: routingRows,
    lanes: {} as Record<string, unknown>,
  };

  if (live) {
    const key = loadApiKey();
    console.log(`live base=${baseUrl} key_len=${key.length}`);
    const lanes: Record<string, unknown[]> = { fast_medium: [], counsel_comprehensive: [] };

    for (const c of cases) {
      const parameters = { ...c.parameters, documentType: c.documentType };
      const fastBody = {
        prompt: c.prompt,
        taskType: 'legal-draft-fast',
        jurisdiction: 'IN',
        parameters,
        options: { draftLength: 'medium' },
        partnerSyncLean: true,
      };
      const counselBody = {
        prompt: c.prompt,
        taskType: 'legal-draft',
        jurisdiction: 'IN',
        parameters,
        options: { draftLength: 'comprehensive' },
      };

      const lanePlan = [
        ['fast_medium', fastBody, 120_000] as const,
        ['counsel_comprehensive', counselBody, 480_000] as const,
      ].filter(([lane]) => {
        if (laneMode === 'both') return true;
        if (laneMode === 'fast') return lane === 'fast_medium';
        return lane === 'counsel_comprehensive';
      });

      for (const [lane, body, timeout] of lanePlan) {
        console.log(`  live ${c.id} ${lane}…`);
        const out = await orchestrateLive(baseUrl, key, body, timeout);
        const rubric = scoreIndianDraftRubric({
          content: out.content,
          documentType: c.documentType,
          draftLength: lane === 'fast_medium' ? 'medium' : 'comprehensive',
          parameters,
          prompt: c.prompt,
        });
        lanes[lane].push({
          caseId: c.id,
          http: out.http,
          ms: out.ms,
          contentLen: out.content.length,
          model: out.model,
          path: out.path,
          rubricPct: rubric.pct,
          rubric,
        });
        if (process.env.NYV_DRAFT_RUBRIC_GRPO_LOG === '1') {
          recordDraftRubricObservation({
            caseId: c.id,
            documentType: c.documentType,
            tier: lane === 'fast_medium' ? 'medium' : 'comprehensive',
            rubricPct: rubric.pct,
            model: out.model,
          });
        }
        console.log(`    http=${out.http} ms=${out.ms} rubric=${rubric.pct}% len=${out.content.length}`);
      }
    }

    const avg = (lane: unknown[]) => {
      const rows = lane as Array<{ rubricPct: number }>;
      if (!rows.length) return 0;
      return Math.round(rows.reduce((a, b) => a + b.rubricPct, 0) / rows.length);
    };
    const laneSummary: Record<string, unknown> = {};
    if (lanes.fast_medium.length) {
      laneSummary.fast_medium = { avgRubricPct: avg(lanes.fast_medium), runs: lanes.fast_medium };
    }
    if (lanes.counsel_comprehensive.length) {
      laneSummary.counsel_comprehensive = {
        avgRubricPct: avg(lanes.counsel_comprehensive),
        runs: lanes.counsel_comprehensive,
      };
    }
    scoreboard.lanes = laneSummary;
    scoreboard.laneMode = laneMode;
  }

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const outPath = path.join(
    EVAL_DIR,
    `draft-scoreboard-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(outPath, `${JSON.stringify(scoreboard, null, 2)}\n`);
  console.log(`scoreboard=${outPath}`);

  if (gate && routingFails.length > 0) process.exit(1);
  if (gate && live) {
    const lanes = scoreboard.lanes as {
      counsel_comprehensive?: { avgRubricPct?: number };
      fast_medium?: { avgRubricPct?: number };
    };
    const fastAvg = lanes.fast_medium?.avgRubricPct;
    const counselAvg = lanes.counsel_comprehensive?.avgRubricPct;
    if (fastAvg === undefined || counselAvg === undefined) {
      console.error(
        'GATE SKIP: need both lanes in one run (omit --lane) or merge scoreboards before --gate',
      );
      process.exit(1);
    }
    if (counselAvg < fastAvg + 5) {
      console.error(`GATE FAIL: counsel avg ${counselAvg} not >= fast+5 (${fastAvg + 5})`);
      process.exit(1);
    }
  }
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
