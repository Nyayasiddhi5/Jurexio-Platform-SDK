import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  vector,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const caselawDocumentsTable = pgTable(
  "caselaw_documents",
  {
    id: serial("id").primaryKey(),
    jurisdiction: text("jurisdiction").notNull(),
    source: text("source").notNull(),
    nativeId: text("native_id"),
    cnr: text("cnr"),
    title: text("title").notNull(),
    petitioner: text("petitioner"),
    respondent: text("respondent"),
    judges: text("judges"),
    authorJudge: text("author_judge"),
    citation: text("citation"),
    decisionDate: text("decision_date"),
    disposalNature: text("disposal_nature"),
    court: text("court"),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    year: integer("year"),
    description: text("description"),
    embedding: vector("embedding", { dimensions: 1024 }),
    ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
  },
  (t) => [
    index("caselaw_year_idx").on(t.year),
    index("caselaw_source_idx").on(t.source),
    index("caselaw_native_id_idx").on(t.nativeId),
    index("caselaw_disposal_idx").on(t.disposalNature),
  ],
);

export const insertCaselawDocumentSchema = createInsertSchema(
  caselawDocumentsTable,
).omit({ id: true, ingestedAt: true });
export type InsertCaselawDocument = z.infer<typeof insertCaselawDocumentSchema>;
export type CaselawDocument = typeof caselawDocumentsTable.$inferSelect;
