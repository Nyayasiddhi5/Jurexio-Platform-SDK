import { pgTable, serial, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type Criterion = {
  id: string;
  title: string;
  matchCriteria: string;
};

export const legalTasksTable = pgTable("legal_tasks", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  categoryName: text("category_name").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  workType: text("work_type").notNull(),
  // "US" | "IN" for jurisdiction-specific tasks; "GLOBAL" for jurisdiction-neutral benchmark tasks.
  jurisdiction: text("jurisdiction").notNull().default("GLOBAL"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  instructions: text("instructions").notNull(),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  documents: jsonb("documents").$type<string[]>().notNull().default([]),
  criteria: jsonb("criteria").$type<Criterion[]>().notNull().default([]),
});

export const insertLegalTaskSchema = createInsertSchema(legalTasksTable).omit({
  id: true,
});
export type InsertLegalTask = z.infer<typeof insertLegalTaskSchema>;
export type LegalTask = typeof legalTasksTable.$inferSelect;
