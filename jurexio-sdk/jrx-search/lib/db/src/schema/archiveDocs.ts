import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Cache of on-demand text extractions from archived judgment PDFs.
 * Keyed by the resolved s3://bucket/key path so repeat summarize/reference
 * requests never re-download or re-OCR the same document.
 */
export const archiveExtractsTable = pgTable(
  "archive_extracts",
  {
    id: serial("id").primaryKey(),
    /** Resolved s3://bucket/key of the PDF that was actually fetched. */
    s3Path: text("s3_path").notNull(),
    /** The s3 path as originally requested (may differ when the HC sibling-bucket fallback resolved it). */
    requestedPath: text("requested_path").notNull(),
    title: text("title"),
    byteSize: integer("byte_size").notNull(),
    textContent: text("text_content").notNull(),
    ocrUsed: boolean("ocr_used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("archive_extracts_requested_path_idx").on(table.requestedPath)],
);

export type ArchiveExtract = typeof archiveExtractsTable.$inferSelect;
