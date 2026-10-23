import { Router, type IRouter } from "express";
import { db, runsTable, legalTasksTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { categoryName } from "../lib/categories";
import {
  InvalidJurisdictionError,
  parseQueryJurisdiction,
  runJurisdictionFilter,
  taskJurisdictionFilter,
} from "../lib/jurisdictionScope";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res) => {
  let jurisdiction: string | undefined;
  try {
    jurisdiction = parseQueryJurisdiction(req.query.jurisdiction);
  } catch (err) {
    if (err instanceof InvalidJurisdictionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const runFilter = runJurisdictionFilter(jurisdiction);
  const taskFilter = taskJurisdictionFilter(jurisdiction);

  const [{ totalRuns, avgScore }] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      avgScore: sql<number | null>`round(avg(${runsTable.score}))::int`,
    })
    .from(runsTable)
    .where(runFilter);

  const [{ totalTasks }] = await db
    .select({ totalTasks: sql<number>`count(*)::int` })
    .from(legalTasksTable)
    .where(taskFilter);

  const [{ totalCategories }] = await db
    .select({
      totalCategories: sql<number>`count(distinct ${legalTasksTable.category})::int`,
    })
    .from(legalTasksTable)
    .where(taskFilter);

  const byWorkType = await db
    .select({
      workType: runsTable.workType,
      count: sql<number>`count(*)::int`,
    })
    .from(runsTable)
    .where(runFilter)
    .groupBy(runsTable.workType);

  const topCategories = await db
    .select({
      category: runsTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(runsTable)
    .where(runFilter)
    .groupBy(runsTable.category)
    .orderBy(sql`count(*) desc`)
    .limit(6);

  const recent = await db
    .select()
    .from(runsTable)
    .where(runFilter)
    .orderBy(desc(runsTable.createdAt))
    .limit(5);

  let byJurisdiction: { jurisdiction: string; count: number }[] | undefined;
  if (jurisdiction === "ALL" || !jurisdiction) {
    byJurisdiction = await db
      .select({
        jurisdiction: sql<string>`coalesce(${runsTable.jurisdiction}, 'unspecified')`,
        count: sql<number>`count(*)::int`,
      })
      .from(runsTable)
      .groupBy(sql`coalesce(${runsTable.jurisdiction}, 'unspecified')`)
      .orderBy(sql`count(*) desc`);
  }

  res.json({
    totalRuns,
    totalTasks,
    totalCategories,
    avgScore,
    byWorkType,
    ...(byJurisdiction ? { byJurisdiction } : {}),
    topCategories: topCategories.map((c) => ({
      category: c.category,
      categoryName: categoryName(c.category),
      count: c.count,
    })),
    recentRuns: recent.map((run) => ({
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
    })),
  });
});

export default router;
