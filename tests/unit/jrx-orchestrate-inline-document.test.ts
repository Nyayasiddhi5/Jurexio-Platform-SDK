/**
 * NV-INLINE-DOC-PROMPT-001 — an inline document MUST reach the model's prompt.
 *
 * WHAT THIS FILE GUARDS
 * ---------------------
 * Reproduced 2026-08-19 by driving the real `/api/jrx/orchestrate` handler with the
 * LLM boundary captured (not by grep):
 *
 *   - `prompt` + `documentText`    -> specialist prompt was the instruction alone.
 *                                    The contract was absent.
 *   - `prompt` + `documentContent` -> same, and the same on the Queen branch.
 *   - `documentContent` alone      -> HTTP 400 `prompt is required`.
 *   - control: document inside `prompt` -> present, so the platform could analyse
 *                                    fine; it was failing to RECEIVE.
 *
 * The response was still fluent and confident. That is the whole danger: an
 * advocate uploads a contract, asks for the risks, and gets an answer generated
 * from the question. These tests are written so each of those observations fails
 * if the behaviour returns, on EVERY branch — the field-extraction version of this
 * bug was reported fixed twice while the partner still saw nothing, because the
 * fix lived in one branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const captured: { specialist?: any; queen?: any; docPipeline?: any } = {};

/* Whether a capability leaf claims the request. Default false so a document
 * request falls through to the specialist, which is what production does when no
 * leaf matches — and what makes the specialist assertions meaningful. */
let docPipelineClaims = false;

vi.mock('../../src/orchestration/jrx-sdk-orchestration-wrapper.js', () => ({
  executeWithFullSafetyRing: vi.fn(async (request: any) => {
    captured.specialist = request;
    return {
      content: 'MOCK SPECIALIST ANSWER',
      model: 'mock-model',
      provider: 'mock',
      responseTime: 5,
      tokens: { prompt: 10, completion: 10, total: 20 },
      orchestration: { compliancePassed: true },
      metadata: {},
    };
  }),
  executeWithFullSafetyRingSimple: vi.fn(),
}));

vi.mock('../../src/orchestration/jrx-doc-pipeline-adapter.js', () => ({
  /* Captures the args but reports NOT invoked, so the request falls through to the
   * specialist exactly as it does in production when no capability leaf claims it.
   * Returning `invoked: true` here silently swallowed every specialist assertion —
   * the doc-pipeline lane is now reached for any inline document, because
   * `hasDocumentPayload` finally recognises all four document keys. */
  tryInvokeDocPipelineLeaves: vi.fn(async (args: any) => {
    captured.docPipeline = args;
    return docPipelineClaims
      ? { invoked: true, content: 'MOCK DOC PIPELINE ANSWER', capabilityId: 'doc.parse', output: {} }
      : { invoked: false };
  }),
  docPipelineSystemPrompt: () => 'doc system prompt',
}));

vi.mock('../../src/orchestration/jrx-queen-orchestrator.js', async (importOriginal) => ({
  /* Partial: the stream route constructs the REAL `QueenLifecycleEmitter` and calls
   * `.on(...)` on it. A bare class stub threw inside the handler, which presented
   * as "the document was lost" — the instrument, not the platform. */
  ...(await importOriginal<Record<string, unknown>>()),
  queenOrchestrator: {
    assessPromptComplexity: () => ({
      intent: 'analysis', complexity: 'complex', domains: ['legal'], requiresMultipleAgents: true,
    }),
    orchestrate: vi.fn(async (request: any) => {
      captured.queen = request;
      return {
        success: true,
        synthesizedOutput: 'MOCK QUEEN ANSWER',
        executions: [{ agentId: 'a', agentName: 'A', status: 'completed', tokens: 10, model: 'm', output: 'x' }],
        taskDecomposition: { complexity: 'complex', subtasks: [{}], decompositionAlgorithm: 'auto' },
        metadata: {
          totalTokens: { input: 10, output: 10 },
          totalTime: 20,
          orchestrationPattern: 'parallel',
          totalCost: 0,
        },
      };
    }),
  },
  QueenLifecycleEmitter: (await importOriginal<Record<string, unknown>>()).QueenLifecycleEmitter,
}));

/* The statute / deterministic fast paths would answer before dispatch and hide the
 * assembly under test; they have their own suites. Partial mocks (importOriginal)
 * because `nv-queen-admission` also imports `listCoreSectionRefs` from here — a
 * whole-module mock made the ROUTE throw, which looked like the fix failing. */
vi.mock('../../src/services/jrx-statute-qa-grounding.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isShortStatuteFaq: () => false,
  isStatuteQaGroundingEnabled: () => false,
  tryStatuteMappingFastPath: async () => null,
  tryStatuteFaqFastPath: async () => null,
  applyStatuteQaGroundingGate: async (a: any) => ({ content: a.answer, applied: false, corrected: false }),
}));

vi.mock('../../src/services/jrx-nys-deterministic-answer.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  couldBeDeterministic: () => false,
  tryNysDeterministicAnswer: async () => null,
}));

vi.mock('../../src/services/jrx-adaptive-path-ema.js', () => ({
  applyAdaptivePathLearning: async (d: any) => d,
  recordAdaptivePathOutcome: async () => {},
}));

import router from '../../src/routes/jrx-orchestration-routes.js';
import {
  DOCUMENT_BLOCK_START,
  DOCUMENT_BLOCK_END,
  TASK_BLOCK_START,
  TRUNCATION_MARKER,
  DEFAULT_DOCUMENT_INSTRUCTION,
  composeInlineDocumentPrompt,
  selectInlineDocumentText,
  hasInlineDocumentPayload,
} from '../../src/services/jrx-inline-document-prompt.js';
import { estimatePromptTokens, getPromptBudget } from '../../src/config/jrx-prompt-budget.js';

/** A sentinel deep inside the document: only a real injection carries it through. */
const SENTINEL = 'UNIQUE-DOC-SENTINEL-ZQ7';
const DOC = [
  'MASTER SERVICES AGREEMENT dated 14 March 2025 between ACME TECHNOLOGIES PRIVATE',
  'LIMITED (the "Supplier") and BETA RETAIL LIMITED (the "Customer").',
  'CLAUSE 11.2 (INDEMNITY): The Supplier shall indemnify, defend and hold harmless',
  'the Customer against all claims, losses and damages arising out of the Services,',
  'without limitation.',
  'CLAUSE 12.1 (LIABILITY CAP): the aggregate liability of either party shall not',
  'exceed the fees paid in the twelve months preceding the claim.',
  `CLAUSE 14.1 (TERMINATION): The Customer may terminate for convenience on thirty`,
  `(30) days notice. ${SENTINEL}.`,
].join('\n');
const INSTRUCTION = 'What are the risks in this agreement?';

function handlerFor(path: string): (req: any, res: any) => Promise<void> {
  const layer = (router as unknown as { stack: any[] }).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post,
  );
  if (!layer) throw new Error(`no POST handler for ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

interface CallResult { status: number; payload: any; events: any[] }

async function call(path: string, body: Record<string, unknown>): Promise<CallResult> {
  const handler = handlerFor(path);
  const req: any = { body, headers: {}, method: 'POST', path, query: {}, on: () => undefined };
  const out: CallResult = { status: 200, payload: undefined, events: [] };
  const res: any = {
    headersSent: false,
    writableEnded: false,
    status(c: number) { out.status = c; return res; },
    json(p: any) { out.payload = p; return res; },
    setHeader() { return res; },
    flushHeaders() { return res; },
    write(chunk: string) {
      const m = /^event: (\S+)\ndata: ([\s\S]*)\n\n$/.exec(String(chunk));
      if (m) { try { out.events.push(JSON.parse(m[2]!)); } catch { /* [DONE] sentinel */ } }
      return true;
    },
    end() { res.writableEnded = true; return res; },
    on() { return res; },
  };
  await handler(req, res);
  return out;
}

/** Every optional gate off so a test asserts assembly, not the safety ring. */
const LEAN = {
  enableHallucinationCheck: false,
  enableCitationVerification: false,
  enableExplainability: false,
  enableRAG: false,
  enableMemory: false,
  enableHITL: false,
} as const;

beforeEach(() => {
  captured.specialist = undefined;
  captured.queen = undefined;
  captured.docPipeline = undefined;
});

describe('every partner document key reaches the composed prompt (specialist branch)', () => {
  for (const key of ['documentText', 'documentContent', 'content', 'text'] as const) {
    it(`\`${key}\` is folded into the prompt the model receives`, async () => {
      await call('/orchestrate', { prompt: INSTRUCTION, [key]: DOC, taskType: 'analysis', ...LEAN });
      const composed = String(captured.specialist?.prompt ?? '');
      expect(composed, `${key} never reached the model`).toContain(SENTINEL);
      expect(composed).toContain(DOCUMENT_BLOCK_START);
      expect(composed).toContain(DOCUMENT_BLOCK_END);
    });
  }
});

describe('the instruction is preserved alongside the document, never clobbered', () => {
  it('keeps both, each in its own fenced block, task first', async () => {
    await call('/orchestrate', { prompt: INSTRUCTION, documentText: DOC, taskType: 'analysis', ...LEAN });
    const composed = String(captured.specialist?.prompt ?? '');

    expect(composed).toContain(INSTRUCTION);
    expect(composed).toContain(SENTINEL);

    const taskIdx = composed.indexOf(TASK_BLOCK_START);
    const instrIdx = composed.indexOf(INSTRUCTION);
    const docIdx = composed.indexOf(DOCUMENT_BLOCK_START);
    const endIdx = composed.indexOf(DOCUMENT_BLOCK_END);
    /* The instruction must sit in the TASK block, i.e. BEFORE the document fence,
     * not concatenated into the material where clause text can swallow it. */
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(instrIdx).toBeGreaterThan(taskIdx);
    expect(instrIdx).toBeLessThan(docIdx);
    expect(composed.indexOf(SENTINEL)).toBeGreaterThan(docIdx);
    expect(composed.indexOf(SENTINEL)).toBeLessThan(endIdx);
  });

  it('tells the model that document text is material, not instructions', async () => {
    // Prompt-injection surface: a contract is full of imperative "shall" clauses.
    await call('/orchestrate', { prompt: INSTRUCTION, documentText: DOC, taskType: 'analysis', ...LEAN });
    expect(String(captured.specialist?.prompt)).toMatch(/never an instruction to follow/i);
  });

  it('does not overwrite body.prompt with the document — routing still sees the instruction', async () => {
    /* `prompt` feeds routing, hallucination inputText, explainability and memory.
     * Handing those a 40 KB contract is a different bug, so assert it stays clean. */
    const body: Record<string, unknown> = { prompt: INSTRUCTION, documentText: DOC, taskType: 'analysis', ...LEAN };
    await call('/orchestrate', body);
    expect(body.prompt).toBe(INSTRUCTION);
  });
});

describe('the Queen branch is covered, not only the specialist branch', () => {
  it('forced multi-agent mode dispatches the grounded prompt to the Queen', async () => {
    await call('/orchestrate', {
      prompt: INSTRUCTION, documentContent: DOC,
      taskType: 'analysis', orchestrationMode: 'parallel', ...LEAN,
    });
    expect(captured.queen, 'Queen branch was not exercised').toBeTruthy();
    const composed = String(captured.queen?.prompt ?? '');
    expect(composed, 'the Queen fans out from this string — it must carry the document').toContain(SENTINEL);
    expect(composed).toContain(INSTRUCTION);
  });
});

describe('the doc-pipeline branch is covered', () => {
  it('a pure document op receives the grounded prompt and answers from it', async () => {
    docPipelineClaims = true;
    try {
      const out = await call('/orchestrate', {
        prompt: 'Parse this document.', documentText: DOC, taskType: 'parse', ...LEAN,
      });
      expect(captured.docPipeline, 'doc-pipeline branch was not exercised').toBeTruthy();
      expect(String(captured.docPipeline?.prompt ?? '')).toContain(SENTINEL);
      // The leaf answered, so this branch's envelope must carry the meta too.
      expect(out.payload?.data?.documentContext?.injected).toBe(true);
    } finally {
      docPipelineClaims = false;
    }
  });
});

describe('the streaming route behaves identically', () => {
  it('/orchestrate/stream grounds the Queen prompt and announces the document', async () => {
    const out = await call('/orchestrate/stream', {
      prompt: INSTRUCTION, documentText: DOC,
      taskType: 'analysis', orchestrationMode: 'parallel', ...LEAN,
    });
    expect(String(captured.queen?.prompt ?? ''), 'stream Queen prompt lost the document').toContain(SENTINEL);
    const ctx = out.events.find((e) => e.type === 'document_context');
    /* A streaming client sees events, not an envelope — without this event the
     * injection and any truncation would be invisible to it. */
    expect(ctx, 'no document_context event was emitted').toBeTruthy();
    expect(ctx.injected).toBe(true);
    expect(ctx.sourceField).toBe('documentText');
  });
});

describe('a document-only request is answered, not rejected', () => {
  it('documentContent with no prompt returns 200 and analyses the document', async () => {
    /* This was HTTP 400 `prompt is required` — a supplied document discarded at
     * the door, which is the same class of failure as ignoring it silently. */
    const out = await call('/orchestrate', { documentContent: DOC, taskType: 'analysis', ...LEAN });
    expect(out.status).toBe(200);
    expect(out.payload?.success).toBe(true);
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed).toContain(SENTINEL);
    expect(composed).toContain(DEFAULT_DOCUMENT_INSTRUCTION);
  });
});

describe('no document supplied behaves exactly as before', () => {
  it('a plain chat turn is dispatched byte-for-byte unchanged', async () => {
    const plain = 'What is anticipatory bail under the BNSS?';
    await call('/orchestrate', { prompt: plain, taskType: 'analysis', ...LEAN });
    expect(captured.specialist?.prompt).toBe(plain);
  });

  it('no fence, no truncation marker, and no documentContext block appear', async () => {
    const out = await call('/orchestrate', { prompt: 'Explain Section 138 NI Act.', taskType: 'analysis', ...LEAN });
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed).not.toContain(DOCUMENT_BLOCK_START);
    expect(composed).not.toContain(TRUNCATION_MARKER);
    expect(out.payload?.data?.documentContext).toBeUndefined();
  });

  it('a document already pasted into `prompt` is not duplicated', async () => {
    /* Doubling the token cost of a request that was already correct is a
     * regression of its own; the control case in the reproduction is this shape. */
    const pasted = `Analyse the risks.\n\n${DOC}`;
    await call('/orchestrate', { prompt: pasted, content: DOC, taskType: 'analysis', ...LEAN });
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed).toBe(pasted);
    expect(composed.split(SENTINEL).length - 1).toBe(1);
  });
});

describe('oversized documents are truncated within budget AND the truncation is signalled', () => {
  const HUGE = `${'CLAUSE X: The Supplier shall deliver the Services with reasonable skill and care. '.repeat(4_000)}${SENTINEL}`;

  it('the document block never exceeds the task class context budget', () => {
    const c = composeInlineDocumentPrompt({
      instruction: INSTRUCTION, body: { documentText: HUGE }, taskType: 'analysis',
    });
    expect(c.injected).toBe(true);
    expect(c.truncated).toBe(true);
    expect(c.documentTokens).toBeLessThanOrEqual(c.budgetTokens);
    // The ceiling must be a REAL published budget, not a number invented here.
    expect(c.budgetTokens).toBe(getPromptBudget('research').maxContextTokens);
    expect(estimatePromptTokens(HUGE)).toBeGreaterThan(c.budgetTokens);
  });

  it('the model is told, in the prompt, that it does not have the whole document', async () => {
    await call('/orchestrate', { prompt: INSTRUCTION, documentText: HUGE, taskType: 'analysis', ...LEAN });
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed).toContain(TRUNCATION_MARKER);
    expect(composed).toMatch(/NOT been given the whole document/i);
    /* A partial contract summarised as complete is worse than a refusal, so the
     * model is instructed to disclose the gap, not merely informed of it. */
    expect(composed).toMatch(/do not state or imply that you/i);
    // And the truncated tail really is gone.
    expect(composed).not.toContain(SENTINEL);
  });

  it('the CALLER is told too, with the numbers and the supported alternative', async () => {
    const out = await call('/orchestrate', { prompt: INSTRUCTION, documentText: HUGE, taskType: 'analysis', ...LEAN });
    const ctx = out.payload?.data?.documentContext;
    expect(ctx, 'truncation was invisible to the caller').toBeTruthy();
    expect(ctx.truncated).toBe(true);
    expect(ctx.documentChars).toBe(HUGE.length);
    expect(ctx.includedChars).toBeLessThan(HUGE.length);
    expect(String(ctx.advice)).toMatch(/ragDocumentIds/);
  });

  it('a document that fits is NOT marked truncated', async () => {
    const out = await call('/orchestrate', { prompt: INSTRUCTION, documentText: DOC, taskType: 'analysis', ...LEAN });
    const ctx = out.payload?.data?.documentContext;
    expect(ctx.injected).toBe(true);
    expect(ctx.truncated).toBe(false);
    expect(ctx.includedChars).toBe(DOC.length);
    expect(String(captured.specialist?.prompt)).not.toContain(TRUNCATION_MARKER);
  });

  it('no budget was raised to fit a document — the published ceilings are unchanged', () => {
    // Discipline check (see the concurrent 600-token case): compress, never raise.
    expect(getPromptBudget('micro_faq').maxPromptTokens).toBe(600);
    expect(getPromptBudget('research').maxPromptTokens).toBe(8_000);
    expect(getPromptBudget('research').maxContextTokens).toBe(4_500);
    expect(getPromptBudget('drafting').maxContextTokens).toBe(14_000);
  });

  it('an Indic-script document is budgeted on its real token cost, not 4 chars/token', () => {
    /* The estimator charges ~2 chars/token for Devanagari; a fixed 4 would let a
     * Hindi document through at double its true cost. */
    const hindi = 'यह एक अनुबंध है जिसमें पक्षकारों के दायित्व निर्धारित हैं। '.repeat(3_000);
    const c = composeInlineDocumentPrompt({
      instruction: INSTRUCTION, body: { documentText: hindi }, taskType: 'analysis',
    });
    expect(c.truncated).toBe(true);
    expect(c.documentTokens).toBeLessThanOrEqual(c.budgetTokens);
  });
});

describe('the candidate-selection rule has exactly one definition (NV-NO-DUPLICATE-001)', () => {
  it('longest-wins, so an instruction in `prompt` cannot mask a document in `content`', () => {
    expect(selectInlineDocumentText({ content: DOC }, INSTRUCTION, true).text).toBe(DOC);
    expect(selectInlineDocumentText({ content: DOC }, INSTRUCTION, true).sourceKey).toBe('content');
  });

  it('`prompt` competes only for field extraction, never for injection', () => {
    /* If `prompt` counted as a document key, a plain chat turn would be "injected"
     * into itself and every request would look grounded. That is the failure this
     * asymmetry prevents. */
    expect(selectInlineDocumentText({}, DOC, true).sourceKey).toBe('prompt');
    expect(selectInlineDocumentText({}, DOC, false).text).toBe('');
  });

  it('hasInlineDocumentPayload only fires on a real document key', () => {
    expect(hasInlineDocumentPayload({ documentContent: DOC })).toBe(true);
    expect(hasInlineDocumentPayload({ text: DOC })).toBe(true);
    expect(hasInlineDocumentPayload({ prompt: DOC })).toBe(false);
    expect(hasInlineDocumentPayload({ documentText: '   ' })).toBe(false);
    expect(hasInlineDocumentPayload({})).toBe(false);
    expect(hasInlineDocumentPayload(null)).toBe(false);
  });

  it('the route no longer carries its own copy of the candidate list', () => {
    const src = readFileSync(join(process.cwd(), 'src/routes/jrx-orchestration-routes.ts'), 'utf8');
    expect(src).toContain('selectInlineDocumentText(req.body, prompt, true)');
    /* The inline reduce() that used to live here is what disagreed with the
     * prompt path; a second copy must not reappear. */
    expect(src).not.toContain('const docFieldCandidates = [');
  });
});

describe('selection shapes that a weaker rule would get wrong (mutation-driven)', () => {
  /* Both cases below were added because a mutation SURVIVED the first version of
   * this suite: the guard existed but nothing tested it. */

  it('a short label in an EARLIER key must not mask the document in a LATER key', () => {
    /* First-present selection picks `documentContent` here — the string
     * "Contract review" — and the actual document in `text` is discarded. Only
     * longest-wins reaches the document, and this is a shape NSP can produce by
     * populating a title field alongside the body. */
    const body = { documentContent: 'Contract review', text: DOC };
    const chosen = selectInlineDocumentText(body, INSTRUCTION, true);
    expect(chosen.sourceKey).toBe('text');
    expect(chosen.text).toBe(DOC);
  });

  it('a document SHORTER than the instruction is still injected', async () => {
    /* If `prompt` competed as a document candidate, a long instruction would win,
     * the "document" would be the instruction itself, the identity guard would
     * suppress injection, and a short clause sent for review would silently
     * vanish. Clause-level review is a real NSP surface, so this is not academic. */
    const clause = 'CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed '
      + `the fees paid in the twelve preceding months. ${SENTINEL}`;
    const longInstruction = 'Review the clause I am sending against Indian contract law. '
      + 'Tell me whether the cap is enforceable, whether it survives termination, '
      + 'whether it can be read to cap indemnity liability, and what a court in '
      + 'India has held about caps of this kind. Be specific and cite authority.';
    expect(longInstruction.length).toBeGreaterThan(clause.length);

    await call('/orchestrate', { prompt: longInstruction, content: clause, taskType: 'analysis', ...LEAN });
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed, 'a short document was dropped because the instruction was longer').toContain(SENTINEL);
    expect(composed).toContain(longInstruction);
  });
});

describe('NV-SELECTION-TEXT-PRIORITY-001 — explicit selection beats full document keys', () => {
  const FULL_DOC = DOC;
  const CLAUSE = `CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed fees paid. ${SENTINEL}`;

  it('`selectedText` wins over a longer `documentText`', async () => {
    await call('/orchestrate', {
      prompt: 'Rewrite this clause to be more favorable to the Customer.',
      selectedText: CLAUSE,
      documentText: FULL_DOC,
      taskType: 'analysis',
      ...LEAN,
    });
    const composed = String(captured.specialist?.prompt ?? '');
    expect(composed, 'full document was sent instead of selection').toContain(SENTINEL);
    expect(composed).not.toContain('MASTER SERVICES AGREEMENT');
  });

  for (const key of ['selected_text', 'selection', 'selectionText'] as const) {
    it(`\`${key}\` alias wins over longer documentContent`, async () => {
      await call('/orchestrate', {
        prompt: 'Improve this selection.',
        [key]: CLAUSE,
        documentContent: FULL_DOC,
        taskType: 'analysis',
        ...LEAN,
      });
      expect(String(captured.specialist?.prompt ?? '')).toContain(SENTINEL);
    });
  }

  it('selectInlineDocumentText prefers selectedText in unit isolation', () => {
    const chosen = selectInlineDocumentText(
      { selectedText: CLAUSE, documentText: FULL_DOC },
      INSTRUCTION,
      true,
    );
    expect(chosen.sourceKey).toBe('selectedText');
    expect(chosen.text).toBe(CLAUSE);
  });
});

describe('a request carrying a document is classified honestly, not starved', () => {
  it('NV-FAST-CHAT-SLA-001: `legal-chat-fast` with a document stays chat tier, not micro_faq', () => {
    /* Pre-SLA-001: short instruction + document could classify as micro_faq (250 ctx)
     * and truncate. NV-INLINE-DOC-PROMPT-001 floors document carriers at research via
     * forceBestOutcome — but NV-FAST-CHAT-SLA-001 makes explicit `-fast` a latency
     * contract that wins: chat tier (1,000 ctx) fits typical partner excerpts whole. */
    const excerpt = 'CLAUSE 11.2 (INDEMNITY): The Supplier shall indemnify the Customer '
      .repeat(20);
    const c = composeInlineDocumentPrompt({
      instruction: 'Summarise this.', body: { documentText: excerpt }, taskType: 'legal-chat-fast',
    });
    expect(c.taskClass).toBe('chat');
    expect(c.truncated).toBe(false);
    expect(c.budgetTokens).toBe(getPromptBudget('chat').maxContextTokens);
  });

  it('NV-FAST-CHAT-SLA-001: document-free `legal-chat-fast` stays chat tier, not micro_faq', () => {
    /* Explicit `-fast` is a partner latency contract — it must not inherit micro_faq's
     * 600-token overlay ceiling even when the instruction is a one-line FAQ. */
    const c = composeInlineDocumentPrompt({
      instruction: 'What is BNS 420?', body: {}, taskType: 'legal-chat-fast',
    });
    expect(c.taskClass).toBe('chat');
    expect(c.injected).toBe(false);
  });
});
