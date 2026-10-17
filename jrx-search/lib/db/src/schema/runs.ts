import { pgTable, serial, text, integer, jsonb, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { Criterion } from "./legalTasks";

export type EvaluationResult = {
  criterionId: string;
  title: string;
  passed: boolean;
  rationale: string;
};

export type Evaluation = {
  runId: number;
  score: number;
  passCount: number;
  totalCount: number;
  results: EvaluationResult[];
};

export type Authority = {
  title: string;
  citation: string | null;
  court: string | null;
  date: string | null;
  url: string | null;
  source: string;
};

export const runsTable = pgTable("runs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id"),
  title: text("title").notNull(),
  category: text("category").notNull(),
  categoryName: text("category_name").notNull(),
  workType: text("work_type").notNull(),
  // Jurisdiction the run was scoped to at creation (IN/US live; GCC/UK/EU/SG reserved). Null for legacy runs.
  jurisdiction: text("jurisdiction"),
  instruction: text("instruction").notNull(),
  context: text("context"),
  status: text("status").notNull().default("completed"),
  output: text("output"),
  score: real("score"),
  criteria: jsonb("criteria").$type<Criterion[]>().notNull().default([]),
  evaluation: jsonb("evaluation").$type<Evaluation | null>(),
  authorities: jsonb("authorities").$type<Authority[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRunSchema = createInsertSchema(runsTable).omit({ id: true });
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;
