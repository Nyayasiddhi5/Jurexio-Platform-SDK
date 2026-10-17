import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Statutes corpus: BNS / BNSS / BSA / IPC (India) and selected US Code titles.
 * `mappedSections` holds cross-code equivalents (e.g. IPC 302 -> ["103"]).
 */
export const statutesTable = pgTable(
  "statutes",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(), // BNS | BNSS | BSA | IPC | USC
    jurisdiction: text("jurisdiction").notNull(), // IN | US
    section: text("section").notNull(), // "103", "498A", "1341"
    uscTitle: text("usc_title"), // for USC rows, e.g. "18"
    heading: text("heading").notNull(),
    chapter: text("chapter"),
    text: text("text").notNull(),
    mappedCode: text("mapped_code"), // code the mapping points to (BNS for IPC rows, IPC for BNS rows)
    mappedSections: jsonb("mapped_sections").$type<string[]>().notNull().default([]),
    changeNotes: text("change_notes"),
    // Act-level metadata (India Code corpus expansion)
    actName: text("act_name"), // e.g. "The Companies Act, 2013"
    actYear: text("act_year"), // e.g. "2013"
    actNo: text("act_no"), // e.g. "18"
    ministry: text("ministry"), // e.g. "Corporate Affairs"
    department: text("department"),
    practiceArea: text("practice_area"), // e.g. "Corporate & Commercial"
    provisionType: text("provision_type").notNull().default("section"), // section | article | schedule | preamble
    enactmentDate: text("enactment_date"), // ISO-ish date string from source
    sourceActId: text("source_act_id"), // India Code actid (AC_CEN_...)
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("statutes_code_section_idx").on(t.code, t.section),
    index("statutes_code_idx").on(t.code),
    index("statutes_jurisdiction_idx").on(t.jurisdiction),
    index("statutes_practice_area_idx").on(t.practiceArea),
    index("statutes_act_name_idx").on(t.actName),
    index("statutes_updated_at_idx").on(t.updatedAt),
  ],
);

/**
 * India Code ingest resume/progress tracking (managed by the ingest DDL as well;
 * declared here so `drizzle-kit push` never proposes dropping it).
 */
export const statuteIngestProgressTable = pgTable("statute_ingest_progress", {
  handle: text("handle").primaryKey(),
  actTitle: text("act_title").notNull(),
  code: text("code"),
  status: text("status").notNull().default("pending"),
  sectionsLoaded: integer("sections_loaded").notNull().default(0),
  detail: text("detail"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStatuteSchema = createInsertSchema(statutesTable).omit({
  id: true,
  createdAt: true,
  embedding: true,
});
export type InsertStatute = z.infer<typeof insertStatuteSchema>;
export type Statute = typeof statutesTable.$inferSelect;
