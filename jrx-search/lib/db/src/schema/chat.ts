import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export type ChatAction =
  | "chat"
  | "summary"
  | "extract"
  | "case_details"
  | "draft"
  | "intelligence"
  | "predictions";

export const chatConversationsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  outputFormat: text("output_format").notNull().default("detailed"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    action: text("action").notNull().default("chat"),
    content: text("content").notNull(),
    structured: jsonb("structured").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("chat_messages_conversation_id_idx").on(table.conversationId),
    // Trigram GIN index so ILIKE content search stays fast as histories grow
    // (requires the pg_trgm extension, present in dev and prod).
    index("chat_messages_content_trgm_idx").using(
      "gin",
      sql`${table.content} gin_trgm_ops`,
    ),
  ],
);

export const chatDocumentsTable = pgTable("chat_documents", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  textContent: text("text_content").notNull(),
  original: bytea("original"),
  /** Provenance for documents pulled from the judgment archive (s3://bucket/key). */
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertChatConversationSchema = createInsertSchema(
  chatConversationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatConversation = z.infer<
  typeof insertChatConversationSchema
>;
export type ChatConversation = typeof chatConversationsTable.$inferSelect;

export const insertChatMessageSchema = createInsertSchema(
  chatMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

export const insertChatDocumentSchema = createInsertSchema(
  chatDocumentsTable,
).omit({ id: true, createdAt: true });
export type InsertChatDocument = z.infer<typeof insertChatDocumentSchema>;
export type ChatDocument = typeof chatDocumentsTable.$inferSelect;
