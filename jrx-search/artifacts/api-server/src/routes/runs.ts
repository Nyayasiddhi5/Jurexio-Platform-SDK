import { Router, type IRouter } from "express";
import { db, runsTable, legalTasksTable } from "@workspace/db";
import type { Criterion } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CreateRunBody, GetRunParams, DeleteRunParams } from "@workspace/api-zod";
import { categoryName } from "../lib/categories";
import { performLegalWork, evaluateWork } from "../lib/agent";
import { retrieveAuthorities } from "../lib/caselaw";
import { planAndRetrieve } from "../lib/retrievalRouter";
import type { StatuteOut } from "../lib/statutes";
import { openSse } from "../lib/sse";
import { recordModelUsage } from "../middlewares/usage";
import { extractArchiveText } from "../lib/archiveDocs";
import type { ReferenceDocument } from "../lib/agent";
import type { Authority } from "@workspace/db";
import { resolveLocale } from "../lib/localeHint";
import {
  InvalidJurisdictionError,
  parseQueryJurisdiction,
  runJurisdictionFilter,
} from "../lib/jurisdictionScope";

const router: IRouter = Router();

type RunBody = ReturnType<typeof CreateRunBody.parse>;

interface ResolvedTask {
  criteria: Criterion[];
  documents: string[];
  resolvedCategory: string;
  resolvedName: string;
}

async function resolveTask(body: RunBody): Promise<ResolvedTask> {
  let criteria: Criterion[] = [];
  let documents: string[] = [];
  let resolvedCategory = body.category;
  let resolvedName = categoryName(body.category);
  if (body.taskId) {
    const [task] = await db
      .select()
      .from(legalTasksTable)
      .where(eq(legalTasksTable.id, body.taskId));
    if (task) {
      criteria = task.criteria;
      documents = task.documents;
      resolvedCategory = task.category;
      resolvedName = task.categoryName;
    }
  }
  return { criteria, documents, resolvedCategory, resolvedName };
}

async function groundRun(
  body: RunBody,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<{ authorities: Awaited<ReturnType<typeof retrieveAuthorities>>; statutes: StatuteOut[] }> {
  const authorities = await retrieveAuthorities({
    query: body.title,
    limit: 5,
    jurisdiction: body.jurisdiction,
  });
  log.info(
    { authorityCount: authorities.length },
    "retrieved real authorities for grounding",
  );

  let statutes: StatuteOut[] = [];
  const groundable =
    body.jurisdiction === undefined ||
    body.jurisdiction === "IN" ||
    body.jurisdiction === "US";
  if (groundable) {
    try {
      const plan = await planAndRetrieve({
        query: `${body.title}. ${body.instruction}`,
        jurisdiction: body.jurisdiction === "US" ? "US" : "IN",
        limit: 5,
      });
      log.info(
        {
          intent: plan.intent,
          llmRequired: plan.llmRequired,
          tools: plan.steps.map((s) => s.tool),
          reason: plan.reason,
        },
        "retrieval router decision for run grounding",
      );
      for (const step of plan.steps) {
        if (step.tool === "statute-lookup") statutes.push(...step.statutes);
        if (step.tool === "ipc-bns-compare" && step.comparison.ipc) {
          statutes.push(step.comparison.ipc, ...step.comparison.bnsMatches);
        }
        if (step.tool === "old-new-compare") {
          statutes.push(...step.oldNew.matches);
        }
        if (step.tool === "new-old-compare") {
          if (step.newOld.statute) statutes.push(step.newOld.statute);
          statutes.push(...step.newOld.matches);
        }
      }
      statutes = statutes.slice(0, 5);
    } catch (err) {
      log.warn(
        { err: String(err) },
        "retrieval router grounding failed; continuing without statutes",
      );
    }
  } else {
    log.info(
      { jurisdiction: body.jurisdiction },
      "reserved jurisdiction; skipping retrieval grounding",
    );
  }
  return { authorities, statutes };
}

/** Max characters of each archived judgment passed to the agent prompt. */
const REFERENCE_EXCERPT_CHARS = 8_000;

/**
 * Resolve user-selected archive references into full-text grounding documents
 * plus provenance authorities. Failures on individual documents are logged and
 * skipped — grounding never blocks a run.
 */
async function resolveArchiveReferences(
  body: RunBody,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<{ referenceDocuments: ReferenceDocument[]; referenceAuthorities: Authority[] }> {
  const refs = body.archiveReferences ?? [];
  const referenceDocuments: ReferenceDocument[] = [];
  const referenceAuthorities: Authority[] = [];
  for (const ref of refs.slice(0, 3)) {
    try {
      const extracted = await extractArchiveText({
        s3Path: ref.s3Path,
        title: ref.title ?? null,
        log,
      });
      const title =
        ref.title ??
        extracted.title ??
        (extracted.s3Path.split("/").pop() ?? "Archived judgment");
      let text = extracted.text;
      if (text.length > REFERENCE_EXCERPT_CHARS) {
        text =
          text.slice(0, REFERENCE_EXCERPT_CHARS) +
          "\n[Excerpt truncated — full judgment available in the archive.]";
      }
      referenceDocuments.push({ title, sourceRef: extracted.s3Path, text });
      referenceAuthorities.push({
        title,
        citation: null,
        court: null,
        date: null,
        url: extracted.s3Path,
        source: "archive",
      });
    } catch (err) {
      log.warn(
        { s3Path: ref.s3Path, err: String(err) },
        "archive reference extraction failed; continuing without it",
      );
    }
  }
  if (referenceDocuments.length > 0) {
    log.info(
      { count: referenceDocuments.length },
      "archive references resolved for run grounding",
    );
  }
  return { referenceDocuments, referenceAuthorities };
}

function serializeRun(run: typeof runsTable.$inferSelect) {
  return {
    id: run.id,
    taskId: run.taskId,
    title: run.title,
    category: run.category,
    categoryName: run.categoryName,
    workType: run.workType,
    jurisdiction: run.jurisdiction,
    instruction: run.instruction,
    context: run.context,
    status: run.status,
    output: run.output,
    score: run.score,
    createdAt: run.createdAt.toISOString(),
  };
}

router.get("/runs", async (req, res) => {
  let runFilter;
  try {
    runFilter = runJurisdictionFilter(parseQueryJurisdiction(req.query.jurisdiction));
  } catch (err) {
    if (err instanceof InvalidJurisdictionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const rows = await db
    .select()
    .from(runsTable)
    .where(runFilter)
    .orderBy(desc(runsTable.createdAt));
  res.json(rows.map(serializeRun));
});

router.post("/runs", async (req, res) => {
  recordModelUsage(res);
  const body = CreateRunBody.parse(req.body);
  const { criteria, documents, resolvedCategory, resolvedName } =
    await resolveTask(body);

  req.log.info(
    { taskId: body.taskId, workType: body.workType },
    "agent run started",
  );

  const [{ authorities, statutes }, { referenceDocuments, referenceAuthorities }] =
    await Promise.all([
      groundRun(body, req.log),
      resolveArchiveReferences(body, req.log),
    ]);
  const allAuthorities = [...authorities, ...referenceAuthorities];

  const locale = resolveLocale(body);

  const output = await performLegalWork({
    title: body.title,
    categoryName: resolvedName,
    workType: body.workType,
    instruction: body.instruction,
    context: body.context,
    documents,
    authorities,
    statutes,
    referenceDocuments,
    locale,
  });

  const [run] = await db
    .insert(runsTable)
    .values({
      taskId: body.taskId ?? null,
      title: body.title,
      category: resolvedCategory,
      categoryName: resolvedName,
      workType: body.workType,
      jurisdiction: body.jurisdiction ?? null,
      instruction: body.instruction,
      context: body.context ?? null,
      status: "completed",
      output,
      criteria,
      evaluation: null,
      authorities: allAuthorities,
    })
    .returning();

  res.status(201).json({
    ...serializeRun(run),
    criteria: run.criteria,
    evaluation: run.evaluation,
    authorities: run.authorities,
  });
});

// SSE streaming variant: emits status/delta events while the agent works,
// then a final `done` event with the persisted run.
router.post("/runs/stream", async (req, res) => {
  recordModelUsage(res);
  const body = CreateRunBody.parse(req.body);
  const sse = openSse(res);
  const ac = new AbortController();
  let clientGone = false;
  // Use res "close" (not req "close", which fires early once the request body
  // is read) and guard on writableFinished to detect a premature disconnect.
  res.on("close", () => {
    if (!res.writableFinished && !ac.signal.aborted) {
      clientGone = true;
      ac.abort();
      req.log.info(
        { taskId: body.taskId },
        "client disconnected; aborting run stream",
      );
    }
  });
  try {
    sse.status("resolving-task");
    const { criteria, documents, resolvedCategory, resolvedName } =
      await resolveTask(body);

    req.log.info(
      { taskId: body.taskId, workType: body.workType },
      "agent streaming run started",
    );

    sse.status("retrieving-authorities");
    const [{ authorities, statutes }, { referenceDocuments, referenceAuthorities }] =
      await Promise.all([
        groundRun(body, req.log),
        resolveArchiveReferences(body, req.log),
      ]);
    const allAuthorities = [...authorities, ...referenceAuthorities];

    sse.status("drafting");
    const locale = resolveLocale(body);
    const output = await performLegalWork({
      title: body.title,
      categoryName: resolvedName,
      workType: body.workType,
      instruction: body.instruction,
      context: body.context,
      documents,
      authorities,
      statutes,
      referenceDocuments,
      locale,
      onDelta: (text) => sse.delta(text),
      signal: ac.signal,
    });

    if (clientGone || ac.signal.aborted) {
      req.log.info(
        { taskId: body.taskId },
        "run stream cancelled; not persisting run",
      );
      return;
    }

    sse.status("saving");
    const [run] = await db
      .insert(runsTable)
      .values({
        taskId: body.taskId ?? null,
        title: body.title,
        category: resolvedCategory,
        categoryName: resolvedName,
        workType: body.workType,
        jurisdiction: body.jurisdiction ?? null,
        instruction: body.instruction,
        context: body.context ?? null,
        status: "completed",
        output,
        criteria,
        evaluation: null,
        authorities: allAuthorities,
      })
      .returning();

    sse.done({
      ...serializeRun(run),
      criteria: run.criteria,
      evaluation: run.evaluation,
      authorities: run.authorities,
    });
  } catch (err) {
    if (clientGone || ac.signal.aborted) {
      req.log.info({ taskId: body.taskId }, "run stream aborted by client");
      return;
    }
    req.log.error({ err: String(err) }, "streaming run failed");
    sse.error(err instanceof Error ? err.message : "The agent run failed.");
  }
});

router.get("/runs/:id", async (req, res) => {
  const { id } = GetRunParams.parse({ id: Number(req.params.id) });
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({
    ...serializeRun(run),
    criteria: run.criteria,
    evaluation: run.evaluation,
    authorities: run.authorities,
  });
});

router.delete("/runs/:id", async (req, res) => {
  const { id } = DeleteRunParams.parse({ id: Number(req.params.id) });
  const deleted = await db
    .delete(runsTable)
    .where(eq(runsTable.id, id))
    .returning({ id: runsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.status(204).send();
});

router.post("/runs/:id/evaluate", async (req, res) => {
  recordModelUsage(res);
  const { id } = GetRunParams.parse({ id: Number(req.params.id) });
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (!run.output) {
    res.status(400).json({ error: "Run has no work product to evaluate" });
    return;
  }
  if (run.criteria.length === 0) {
    res.status(400).json({ error: "This run has no rubric to evaluate against" });
    return;
  }

  req.log.info({ runId: id }, "evaluation started");

  const evaluation = await evaluateWork({
    runId: id,
    output: run.output,
    criteria: run.criteria,
  });

  await db
    .update(runsTable)
    .set({ evaluation, score: evaluation.score })
    .where(eq(runsTable.id, id));

  res.json(evaluation);
});

export default router;
