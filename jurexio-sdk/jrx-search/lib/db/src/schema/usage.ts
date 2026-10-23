import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiUsageTable = pgTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    feature: text("feature").notNull(),
    jurisdiction: text("jurisdiction"),
    model: text("model"),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("api_usage_created_at_idx").on(t.createdAt),
    index("api_usage_feature_idx").on(t.feature),
  ],
);

export const insertApiUsageSchema = createInsertSchema(apiUsageTable).omit({
  id: true,
});
export type InsertApiUsage = z.infer<typeof insertApiUsageSchema>;
export type ApiUsage = typeof apiUsageTable.$inferSelect;
