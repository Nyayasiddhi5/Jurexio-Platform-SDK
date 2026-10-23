import { pgTable, serial, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const templatesTable = pgTable("templates", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // "template" | "checklist"
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("IN"),
  description: text("description").notNull(),
  body: text("body").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  isCustom: boolean("is_custom").notNull().default(false),
  source: text("source").notNull().default("seeded"), // "seeded" | "created" | "uploaded"
  sourceFilename: text("source_filename"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTemplateSchema = createInsertSchema(templatesTable).omit({
  id: true,
});
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templatesTable.$inferSelect;
