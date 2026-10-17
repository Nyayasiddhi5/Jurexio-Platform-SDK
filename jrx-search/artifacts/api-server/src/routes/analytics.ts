import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, apiUsageTable, runsTable } from "@workspace/db";
import { gte, sql, and, isNotNull, eq, or, inArray, isNull } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { retrieveAuthorities } from "../lib/caselaw";
import { planAndRetrieve } from "../lib/retrievalRouter";
import type { StatuteOut } from "../lib/statutes";
import { recordModelUsage } from "../middlewares/usage";

const router: IRouter = Router();

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

router.get("/analytics/usage", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rawJ =
    typeof req.query.jurisdiction === "string" ? req.query.jurisdiction.toUpperCase() : "ALL";
  const windowCond = gte(apiUsageTable.createdAt, since);
  const jCond =
    rawJ && rawJ !== "ALL"
      ? eq(apiUsageTable.jurisdiction, rawJ)
      : undefined;
  const usageCond = jCond ? and(windowCond, jCond) : windowCond;
  const runsJCond =
    rawJ && rawJ !== "ALL"
      ? eq(runsTable.jurisdiction, rawJ)
      : or(
          inArray(runsTable.jurisdiction, ["IN", "US"]),
          isNull(runsTable.jurisdiction),
        );

  const [totals, byFeature, byJurisdiction, byModel, byDay, scores] = await Promise.all([
    db
      .select({
        totalRequests: sql<number>`count(*)::int`,
        avgLatencyMs: sql<number | null>`round(avg(${apiUsageTable.latencyMs}))::int`,
        p95LatencyMs: sql<number | null>`(percentile_cont(0.95) within group (order by ${apiUsageTable.latencyMs}))::int`,
        errorCount: sql<number>`count(*) filter (where ${apiUsageTable.statusCode} >= 500)::int`,
      })
      .from(apiUsageTable)
      .where(usageCond),
    db
      .select({
        feature: apiUsageTable.feature,
        count: sql<number>`count(*)::int`,
        avgLatencyMs: sql<number | null>`round(avg(${apiUsageTable.latencyMs}))::int`,
      })
      .from(apiUsageTable)
      .where(usageCond)
      .groupBy(apiUsageTable.feature)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        jurisdiction: sql<string>`coalesce(${apiUsageTable.jurisdiction}, 'unspecified')`,
        count: sql<number>`count(*)::int`,
      })
      .from(apiUsageTable)
      .where(usageCond)
      .groupBy(sql`coalesce(${apiUsageTable.jurisdiction}, 'unspecified')`)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        model: apiUsageTable.model,
        count: sql<number>`count(*)::int`,
        avgLatencyMs: sql<number | null>`round(avg(${apiUsageTable.latencyMs}))::int`,
      })
      .from(apiUsageTable)
      .where(and(usageCond, isNotNull(apiUsageTable.model)))
      .groupBy(apiUsageTable.model)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        day: sql<string>`to_char(${apiUsageTable.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        avgLatencyMs: sql<number | null>`round(avg(${apiUsageTable.latencyMs}))::int`,
      })
      .from(apiUsageTable)
      .where(usageCond)
      .groupBy(sql`${apiUsageTable.createdAt}::date`)
      .orderBy(sql`${apiUsageTable.createdAt}::date`),
    db
      .select({
        day: sql<string>`to_char(${runsTable.createdAt}::date, 'YYYY-MM-DD')`,
        avgScore: sql<number | null>`round(avg(${runsTable.score}))::int`,
        runCount: sql<number>`count(*)::int`,
      })
      .from(runsTable)
      .where(and(gte(runsTable.createdAt, since), isNotNull(runsTable.score), runsJCond))
      .groupBy(sql`${runsTable.createdAt}::date`)
      .orderBy(sql`${runsTable.createdAt}::date`),
  ]);

  res.json({
    windowDays: days,
    jurisdiction: rawJ || "ALL",
    totals: totals[0],
    byFeature,
    byJurisdiction,
    byModel,
    byDay,
    scoresOverTime: scores,
  });
});

const AdviseBody = z.object({
  question: z.string().min(10),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  context: z.string().optional(),
});

const AdviseResultSchema = z.object({
  assessment: z.string(),
  keyIssues: z.array(z.string()).default([]),
  strategy: z.string(),
  risks: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
});

router.post("/advise", async (req, res) => {
  recordModelUsage(res);
  const body = AdviseBody.parse(req.body);
  const jurisdiction = body.jurisdiction ?? "IN";

  // Retrieval-first grounding: real authorities + statutes.
  const [authorities, plan] = await Promise.all([
    retrieveAuthorities({
      query: body.question.slice(0, 160),
      limit: 5,
      jurisdiction,
    }).catch(() => []),
    planAndRetrieve({ query: body.question, jurisdiction, limit: 5 }).catch(
      () => null,
    ),
  ]);

  const statutes: StatuteOut[] = [];
  if (plan) {
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
  }

  req.log.info(
    {
      jurisdiction,
      authorityCount: authorities.length,
      statuteCount: statutes.length,
      intent: plan?.intent,
    },
    "advise grounding assembled",
  );

  const authorityNote =
    authorities.length > 0
      ? `\n\nVERIFIED REAL AUTHORITIES (you may cite these; do not fabricate others):\n${authorities
          .map(
            (a) =>
              `- ${a.title}${a.citation ? ` (${a.citation})` : ""}${a.court ? ` — ${a.court}` : ""}`,
          )
          .join("\n")}`
      : "";
  const statuteNote =
    statutes.length > 0
      ? `\n\nVERIFIED STATUTORY PROVISIONS (real text — quote and cite exactly):\n${statutes
          .slice(0, 5)
          .map((s) => `- ${s.code} s.${s.section} — ${s.heading}: ${s.text.slice(0, 400)}`)
          .join("\n")}`
      : "";

  const raw = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a senior litigation strategist advising a licensed attorney. Give a candid, practical case-strategy assessment grounded strictly in the provided verified authorities and statutes; never invent citations. This is analytical assistance, not legal advice to an end client.\n\nRespond with ONLY valid JSON, no markdown fences, exactly this shape:\n{"assessment":"overall assessment of the position","keyIssues":["..."],"strategy":"recommended strategy narrative","risks":["..."],"recommendedActions":["concrete next steps"]}`,
    messages: [
      {
        role: "user",
        content: `Jurisdiction: ${jurisdiction}\n\nQUESTION:\n${body.question}${body.context ? `\n\nBACKGROUND:\n${body.context}` : ""}${authorityNote}${statuteNote}`,
      },
    ],
  });

  const text = raw.content
    .map((b) => (b.type === "text" ? (b as { text: string }).text : ""))
    .join("")
    .trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: z.infer<typeof AdviseResultSchema>;
  try {
    parsed = AdviseResultSchema.parse(JSON.parse(cleaned));
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("The advisor did not return valid structured JSON.");
    }
    parsed = AdviseResultSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
  }

  res.json({
    jurisdiction,
    ...parsed,
    authorities,
    statutes: statutes.slice(0, 5),
    disclaimer:
      "This is AI-generated analytical assistance for a licensed attorney, not legal advice. Verify all authorities before relying on them.",
  });
});

router.get("/analytics/citations", async (_req, res) => {
  const rows = await db
    .select({ authorities: runsTable.authorities })
    .from(runsTable);

  let totalAuthorityRefs = 0;
  let runsWithAuthorities = 0;
  const bySource = new Map<string, number>();
  const byCourt = new Map<string, number>();

  for (const row of rows) {
    const auths = row.authorities ?? [];
    if (auths.length > 0) runsWithAuthorities += 1;
    for (const a of auths) {
      totalAuthorityRefs += 1;
      bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);
      if (a.court) {
        byCourt.set(a.court, (byCourt.get(a.court) ?? 0) + 1);
      }
    }
  }

  const totalRuns = rows.length;
  res.json({
    totalRuns,
    runsWithAuthorities,
    totalAuthorityRefs,
    bySource: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    topCourts: [...byCourt.entries()]
      .map(([court, count]) => ({ court, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    note:
      totalAuthorityRefs === 0
        ? "No grounded authorities recorded on runs yet. Citation treatment stats will populate as agents attach verified authorities."
        : "Read-only aggregate of authorities persisted on completed runs (Open Data scaffold).",
  });
});

router.get("/analytics/litigation", async (_req, res) => {
  const [byWorkType, byJurisdiction, byCategory, totals] = await Promise.all([
    db
      .select({
        workType: runsTable.workType,
        count: sql<number>`count(*)::int`,
      })
      .from(runsTable)
      .groupBy(runsTable.workType)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        jurisdiction: sql<string>`coalesce(${runsTable.jurisdiction}, 'unspecified')`,
        count: sql<number>`count(*)::int`,
      })
      .from(runsTable)
      .groupBy(sql`coalesce(${runsTable.jurisdiction}, 'unspecified')`)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        category: runsTable.category,
        categoryName: runsTable.categoryName,
        count: sql<number>`count(*)::int`,
      })
      .from(runsTable)
      .groupBy(runsTable.category, runsTable.categoryName)
      .orderBy(sql`count(*) desc`)
      .limit(12),
    db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        avgScore: sql<number | null>`round(avg(${runsTable.score}))::int`,
      })
      .from(runsTable),
  ]);

  const totalRuns = totals[0]?.totalRuns ?? 0;
  res.json({
    totalRuns,
    byWorkType,
    byJurisdiction,
    byCategory,
    avgScore: totals[0]?.avgScore ?? null,
    note:
      totalRuns === 0
        ? "No agent runs recorded yet. Litigation analytics will appear here once runs complete."
        : "Read-only run aggregates for litigation analytics (Open Data scaffold).",
  });
});

export default router;
