import { Router, type IRouter } from "express";
import { db, legalTasksTable } from "@workspace/db";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { GetTaskParams } from "@workspace/api-zod";
import { categoryName } from "../lib/categories";
import {
  InvalidJurisdictionError,
  parseQueryJurisdiction,
  taskJurisdictionFilter,
} from "../lib/jurisdictionScope";

const router: IRouter = Router();

router.get("/categories", async (req, res) => {
  let jf;
  try {
    jf = taskJurisdictionFilter(parseQueryJurisdiction(req.query.jurisdiction));
  } catch (err) {
    if (err instanceof InvalidJurisdictionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const rows = await db
    .select({
      category: legalTasksTable.category,
      workType: legalTasksTable.workType,
      count: sql<number>`count(*)::int`,
    })
    .from(legalTasksTable)
    .where(jf)
    .groupBy(legalTasksTable.category, legalTasksTable.workType);

  const map = new Map<
    string,
    { slug: string; name: string; taskCount: number; workTypes: { workType: string; count: number }[] }
  >();

  for (const row of rows) {
    let entry = map.get(row.category);
    if (!entry) {
      entry = {
        slug: row.category,
        name: categoryName(row.category),
        taskCount: 0,
        workTypes: [],
      };
      map.set(row.category, entry);
    }
    entry.taskCount += row.count;
    entry.workTypes.push({ workType: row.workType, count: row.count });
  }

  const result = Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  res.json(result);
});

router.get("/tasks", async (req, res) => {
  const { category, workType, search, limit } = req.query;
  const conditions = [];
  let jf;
  try {
    jf = taskJurisdictionFilter(parseQueryJurisdiction(req.query.jurisdiction));
  } catch (err) {
    if (err instanceof InvalidJurisdictionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (jf) conditions.push(jf);
  if (typeof category === "string" && category) {
    conditions.push(eq(legalTasksTable.category, category));
  }
  if (typeof workType === "string" && workType) {
    conditions.push(eq(legalTasksTable.workType, workType));
  }
  if (typeof search === "string" && search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(legalTasksTable.title, term),
        ilike(legalTasksTable.instructions, term),
      ),
    );
  }

  const lim = typeof limit === "string" ? parseInt(limit, 10) : NaN;

  const rows = await db
    .select()
    .from(legalTasksTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(legalTasksTable.title)
    .limit(Number.isFinite(lim) && lim > 0 ? lim : 500);

  res.json(
    rows.map((t) => ({
      id: t.id,
      category: t.category,
      categoryName: t.categoryName,
      slug: t.slug,
      title: t.title,
      workType: t.workType,
      jurisdiction: t.jurisdiction,
      tags: t.tags,
      instructions: t.instructions,
      deliverables: t.deliverables,
      documents: t.documents,
      criteriaCount: t.criteria.length,
    })),
  );
});

router.get("/tasks/:id", async (req, res) => {
  const { id } = GetTaskParams.parse({ id: Number(req.params.id) });
  const [task] = await db
    .select()
    .from(legalTasksTable)
    .where(eq(legalTasksTable.id, id));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({
    id: task.id,
    category: task.category,
    categoryName: task.categoryName,
    slug: task.slug,
    title: task.title,
    workType: task.workType,
    jurisdiction: task.jurisdiction,
    tags: task.tags,
    instructions: task.instructions,
    deliverables: task.deliverables,
    documents: task.documents,
    criteria: task.criteria,
  });
});

export { InvalidJurisdictionError };

export default router;
