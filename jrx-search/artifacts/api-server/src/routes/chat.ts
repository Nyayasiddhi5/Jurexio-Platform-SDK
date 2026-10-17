import { Router, type IRouter } from "express";
import {
  db,
  chatConversationsTable,
  chatMessagesTable,
  chatDocumentsTable,
} from "@workspace/db";
import { desc, eq, ilike, sql, asc, inArray } from "drizzle-orm";
import {
  CreateChatConversationBody,
  UpdateChatConversationBody,
  UploadChatDocumentBody,
  SendChatMessageBody,
} from "@workspace/api-zod";
import {
  extractDocumentText,
  normalizeExtractedText,
  UnsupportedFileError,
  OcrError,
} from "../lib/extractDocText";
import {
  extractArchiveText,
  parseAllowedS3Path,
  ArchiveDocNotFoundError,
  ArchiveDocTooLargeError,
  ArchiveDocBusyError,
} from "../lib/archiveDocs";
import { runChatAction, type ChatActionMode, type OutputFormat } from "../lib/chatActions";
import { resolveLocale } from "../lib/localeHint";
import { openSse } from "../lib/sse";
import { recordModelUsage } from "../middlewares/usage";
import { templatesTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

/** Load a drafting template body when templateId is provided (draft action only). */
async function loadTemplateBody(
  raw: unknown,
): Promise<{ templateBody: string | undefined; templateId: number | null }> {
  const parsed = z
    .object({ templateId: z.number().int().positive().optional() })
    .safeParse(raw ?? {});
  const templateId = parsed.success ? (parsed.data.templateId ?? null) : null;
  if (!templateId) return { templateBody: undefined, templateId: null };
  const [t] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, templateId));
  return { templateBody: t?.body, templateId };
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function serializeConversation(
  c: typeof chatConversationsTable.$inferSelect,
  counts?: { messageCount: number; documentCount: number },
  matchedSnippet?: string | null,
) {
  return {
    id: c.id,
    title: c.title,
    outputFormat: c.outputFormat,
    messageCount: counts?.messageCount ?? 0,
    documentCount: counts?.documentCount ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    matchedSnippet: matchedSnippet ?? null,
  };
}

/** Build a short excerpt around the first case-insensitive match of `term`. */
export function buildSnippet(content: string, term: string, radius = 90): string {
  const idx = content.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return content.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + term.length + radius);
  let snippet = content.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < content.length) snippet = `${snippet}…`;
  return snippet;
}

function serializeMessage(m: typeof chatMessagesTable.$inferSelect) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    action: m.action,
    content: m.content,
    structured: m.structured ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

function serializeDocument(
  d: typeof chatDocumentsTable.$inferSelect,
  ocrUsed?: boolean,
) {
  return {
    id: d.id,
    conversationId: d.conversationId,
    filename: d.filename,
    mimeType: d.mimeType,
    byteSize: d.byteSize,
    textLength: d.textContent.length,
    preview: d.textContent.slice(0, 300),
    createdAt: d.createdAt.toISOString(),
    sourceRef: d.sourceRef ?? null,
    ...(ocrUsed !== undefined ? { ocrUsed } : {}),
  };
}

async function loadConversation(id: number) {
  const [conv] = await db
    .select()
    .from(chatConversationsTable)
    .where(eq(chatConversationsTable.id, id));
  return conv ?? null;
}

router.get("/chat/conversations", async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  let convs: (typeof chatConversationsTable.$inferSelect)[];
  // Conversations matched only via message content — id → matching snippet.
  const contentSnippets = new Map<number, string>();

  if (search) {
    const pattern = `%${search}%`;
    // Title matches (ranked first).
    const titleMatches = await db
      .select()
      .from(chatConversationsTable)
      .where(ilike(chatConversationsTable.title, pattern))
      .orderBy(desc(chatConversationsTable.updatedAt));
    const titleIds = new Set(titleMatches.map((c) => c.id));

    // Content matches: distinct conversations whose messages contain the term.
    const contentRows = await db
      .selectDistinctOn([chatMessagesTable.conversationId], {
        conversationId: chatMessagesTable.conversationId,
        content: chatMessagesTable.content,
      })
      .from(chatMessagesTable)
      .where(ilike(chatMessagesTable.content, pattern))
      .orderBy(chatMessagesTable.conversationId, desc(chatMessagesTable.createdAt));

    const contentOnlyIds = contentRows
      .filter((r) => !titleIds.has(r.conversationId))
      .map((r) => {
        contentSnippets.set(
          r.conversationId,
          buildSnippet(r.content, search),
        );
        return r.conversationId;
      });

    let contentConvs: (typeof chatConversationsTable.$inferSelect)[] = [];
    if (contentOnlyIds.length > 0) {
      contentConvs = await db
        .select()
        .from(chatConversationsTable)
        .where(inArray(chatConversationsTable.id, contentOnlyIds))
        .orderBy(desc(chatConversationsTable.updatedAt));
    }
    // Title matches first, then content-only matches.
    convs = [...titleMatches, ...contentConvs];
  } else {
    convs = await db
      .select()
      .from(chatConversationsTable)
      .orderBy(desc(chatConversationsTable.updatedAt));
  }

  const [messageCounts, documentCounts] = await Promise.all([
    db
      .select({
        conversationId: chatMessagesTable.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(chatMessagesTable)
      .groupBy(chatMessagesTable.conversationId),
    db
      .select({
        conversationId: chatDocumentsTable.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(chatDocumentsTable)
      .groupBy(chatDocumentsTable.conversationId),
  ]);
  const msgCountMap = new Map(messageCounts.map((r) => [r.conversationId, r.count]));
  const docCountMap = new Map(documentCounts.map((r) => [r.conversationId, r.count]));

  res.json(
    convs.map((conv) =>
      serializeConversation(
        conv,
        {
          messageCount: msgCountMap.get(conv.id) ?? 0,
          documentCount: docCountMap.get(conv.id) ?? 0,
        },
        contentSnippets.get(conv.id) ?? null,
      ),
    ),
  );
});

router.post("/chat/conversations", async (req, res) => {
  const body = CreateChatConversationBody.parse(req.body ?? {});
  const [conv] = await db
    .insert(chatConversationsTable)
    .values({
      title: body.title?.trim() || "New conversation",
      outputFormat: body.outputFormat ?? "detailed",
    })
    .returning();
  res.status(201).json(serializeConversation(conv));
});

router.get("/chat/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const conv = await loadConversation(id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const [messages, documents] = await Promise.all([
    db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, id))
      .orderBy(asc(chatMessagesTable.createdAt), asc(chatMessagesTable.id)),
    db
      .select()
      .from(chatDocumentsTable)
      .where(eq(chatDocumentsTable.conversationId, id))
      .orderBy(asc(chatDocumentsTable.createdAt)),
  ]);
  res.json({
    id: conv.id,
    title: conv.title,
    outputFormat: conv.outputFormat,
    messages: messages.map(serializeMessage),
    documents: documents.map((d) => serializeDocument(d)),
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
  });
});

router.patch("/chat/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = UpdateChatConversationBody.parse(req.body);
  const updates: Partial<{
    title: string;
    outputFormat: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.outputFormat !== undefined) updates.outputFormat = body.outputFormat;

  const [conv] = await db
    .update(chatConversationsTable)
    .set(updates)
    .where(eq(chatConversationsTable.id, id))
    .returning();
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json(serializeConversation(conv));
});

router.delete("/chat/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const deleted = await db
    .delete(chatConversationsTable)
    .where(eq(chatConversationsTable.id, id))
    .returning({ id: chatConversationsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await db
    .delete(chatMessagesTable)
    .where(eq(chatMessagesTable.conversationId, id));
  await db
    .delete(chatDocumentsTable)
    .where(eq(chatDocumentsTable.conversationId, id));
  res.status(204).send();
});

router.post("/chat/conversations/:id/documents", async (req, res) => {
  const id = Number(req.params.id);
  const conv = await loadConversation(id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const body = UploadChatDocumentBody.parse(req.body);

  const bytes = Buffer.from(body.contentBase64, "base64");
  if (bytes.length === 0) {
    res.status(400).json({ error: "Uploaded file is empty." });
    return;
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: "File too large (max 15 MB)." });
    return;
  }

  let text: string;
  let mimeType: string;
  let ocrUsed = false;
  try {
    const extracted = await extractDocumentText(body.filename, bytes);
    text = normalizeExtractedText(extracted.text);
    mimeType = extracted.mimeType;
    ocrUsed = extracted.ocrUsed;
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof OcrError) {
      req.log.error({ err: String(err) }, "OCR fallback failed");
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.warn({ err: String(err) }, "document extraction failed");
    res.status(400).json({
      error: "Could not read this file. It may be corrupt or password-protected.",
    });
    return;
  }

  if (!text || text.length < 10) {
    res.status(400).json({
      error: "No extractable text found in this file, even after OCR.",
    });
    return;
  }

  const [doc] = await db
    .insert(chatDocumentsTable)
    .values({
      conversationId: id,
      filename: body.filename,
      mimeType,
      byteSize: bytes.length,
      textContent: text,
      original: bytes,
    })
    .returning();

  await db
    .update(chatConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversationsTable.id, id));

  req.log.info(
    { conversationId: id, filename: body.filename, textLength: text.length, ocrUsed },
    "chat document uploaded",
  );
  res.status(201).json(serializeDocument(doc, ocrUsed));
});

const FromArchiveBody = z.object({
  s3Path: z
    .string()
    .min(6)
    .max(1024)
    .regex(/^s3:\/\//, "s3Path must start with s3://"),
  title: z.string().max(500).optional(),
});

/**
 * Attach an archived judgment PDF to a conversation as a reference document.
 * The PDF is fetched from the owned S3 archive, text-extracted (cached, with
 * OCR fallback), and stored with its s3:// provenance in sourceRef.
 */
router.post("/chat/conversations/:id/documents/from-archive", async (req, res) => {
  const id = Number(req.params.id);
  const conv = await loadConversation(id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const body = FromArchiveBody.parse(req.body);
  const parsed = parseAllowedS3Path(body.s3Path);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  let extracted: Awaited<ReturnType<typeof extractArchiveText>>;
  try {
    extracted = await extractArchiveText({
      s3Path: body.s3Path,
      title: body.title ?? null,
      log: req.log,
    });
  } catch (err) {
    if (err instanceof ArchiveDocNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ArchiveDocTooLargeError) {
      res.status(413).json({ error: err.message });
      return;
    }
    if (err instanceof ArchiveDocBusyError) {
      req.log.warn({ s3Path: body.s3Path }, "archive extraction gate saturated");
      res.status(503).set("Retry-After", "30").json({ error: err.message });
      return;
    }
    if (err instanceof OcrError) {
      req.log.warn({ s3Path: body.s3Path, err: String(err) }, "archive OCR failed");
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.warn({ s3Path: body.s3Path, err: String(err) }, "archive attach failed");
    res.status(502).json({
      error: "Failed to fetch this judgment from the archive. Try again shortly.",
    });
    return;
  }

  const filename = body.title
    ? `${body.title.slice(0, 200)}.pdf`
    : (extracted.s3Path.split("/").pop() ?? "judgment.pdf");
  const [doc] = await db
    .insert(chatDocumentsTable)
    .values({
      conversationId: id,
      filename,
      mimeType: "application/pdf",
      byteSize: extracted.byteSize,
      textContent: extracted.text,
      original: null,
      sourceRef: extracted.s3Path,
    })
    .returning();

  await db
    .update(chatConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversationsTable.id, id));

  req.log.info(
    {
      conversationId: id,
      s3Path: extracted.s3Path,
      textLength: extracted.text.length,
      ocrUsed: extracted.ocrUsed,
      cached: extracted.cached,
    },
    "archive judgment attached to chat",
  );
  res.status(201).json(serializeDocument(doc, extracted.ocrUsed));
});

router.post("/chat/conversations/:id/messages", async (req, res) => {
  recordModelUsage(res);
  const id = Number(req.params.id);
  const conv = await loadConversation(id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const body = SendChatMessageBody.parse(req.body);
  const action = (body.action ?? "chat") as ChatActionMode;
  const format = (body.outputFormat ??
    conv.outputFormat ??
    "detailed") as OutputFormat;

  const [history, documents] = await Promise.all([
    db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, id))
      .orderBy(asc(chatMessagesTable.createdAt), asc(chatMessagesTable.id)),
    db
      .select()
      .from(chatDocumentsTable)
      .where(eq(chatDocumentsTable.conversationId, id))
      .orderBy(asc(chatDocumentsTable.createdAt)),
  ]);

  if (!body.content.trim() && action === "chat") {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }
  if (
    documents.length === 0 &&
    !body.content.trim() &&
    action !== "chat"
  ) {
    res.status(400).json({
      error: "Upload a document or provide an instruction for this action.",
    });
    return;
  }

  const [userMessage] = await db
    .insert(chatMessagesTable)
    .values({
      conversationId: id,
      role: "user",
      action,
      content: body.content,
      structured: null,
    })
    .returning();

  req.log.info({ conversationId: id, action }, "chat action started");

  const { templateBody } = await loadTemplateBody(req.body);

  let outcome;
  try {
    outcome = await runChatAction({
      action,
      prompt: body.content,
      format,
      history,
      documents,
      templateBody,
      jurisdiction: body.jurisdiction,
      locale: resolveLocale(body),
    });
  } catch (err) {
    // Remove the dangling user message so a failed turn doesn't pollute memory.
    await db
      .delete(chatMessagesTable)
      .where(eq(chatMessagesTable.id, userMessage.id));
    throw err;
  }

  const [assistantMessage] = await db
    .insert(chatMessagesTable)
    .values({
      conversationId: id,
      role: "assistant",
      action,
      content: outcome.content,
      structured: outcome.structured,
    })
    .returning();

  const shouldRename =
    conv.title === "New conversation" && body.content.trim().length > 0;
  await db
    .update(chatConversationsTable)
    .set({
      updatedAt: new Date(),
      ...(shouldRename
        ? { title: body.content.trim().slice(0, 80) }
        : {}),
    })
    .where(eq(chatConversationsTable.id, id));

  res.status(201).json({
    userMessage: serializeMessage(userMessage),
    assistantMessage: serializeMessage(assistantMessage),
  });
});

// SSE streaming variant. Free-text actions (chat/summary/draft) stream token
// deltas; structured actions run normally and deliver the result in `done`.
router.post("/chat/conversations/:id/messages/stream", async (req, res) => {
  recordModelUsage(res);
  const id = Number(req.params.id);
  const conv = await loadConversation(id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const body = SendChatMessageBody.parse(req.body);
  const action = (body.action ?? "chat") as ChatActionMode;
  const format = (body.outputFormat ??
    conv.outputFormat ??
    "detailed") as OutputFormat;

  const [history, documents] = await Promise.all([
    db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, id))
      .orderBy(asc(chatMessagesTable.createdAt), asc(chatMessagesTable.id)),
    db
      .select()
      .from(chatDocumentsTable)
      .where(eq(chatDocumentsTable.conversationId, id))
      .orderBy(asc(chatDocumentsTable.createdAt)),
  ]);

  if (!body.content.trim() && action === "chat") {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }
  if (documents.length === 0 && !body.content.trim() && action !== "chat") {
    res.status(400).json({
      error: "Upload a document or provide an instruction for this action.",
    });
    return;
  }

  const { templateBody } = await loadTemplateBody(req.body);

  const [userMessage] = await db
    .insert(chatMessagesTable)
    .values({
      conversationId: id,
      role: "user",
      action,
      content: body.content,
      structured: null,
    })
    .returning();

  req.log.info({ conversationId: id, action }, "chat streaming action started");
  const sse = openSse(res);
  sse.status("working");

  const ac = new AbortController();
  let clientGone = false;
  // Use res "close" (not req "close", which fires early once the request body
  // is read) and guard on writableFinished to detect a premature disconnect.
  res.on("close", () => {
    if (!res.writableFinished && !ac.signal.aborted) {
      clientGone = true;
      ac.abort();
      req.log.info(
        { conversationId: id },
        "client disconnected; aborting chat stream",
      );
    }
  });

  let outcome;
  try {
    outcome = await runChatAction({
      action,
      prompt: body.content,
      format,
      history,
      documents,
      templateBody,
      jurisdiction: body.jurisdiction,
      locale: resolveLocale(body),
      onDelta: (text) => sse.delta(text),
      onStage: (stage) => sse.status(stage),
      signal: ac.signal,
    });
  } catch (err) {
    await db
      .delete(chatMessagesTable)
      .where(eq(chatMessagesTable.id, userMessage.id));
    if (clientGone || ac.signal.aborted) {
      req.log.info({ conversationId: id }, "chat stream aborted by client");
      return;
    }
    req.log.error({ err: String(err), conversationId: id }, "streaming chat action failed");
    sse.error(err instanceof Error ? err.message : "The chat action failed.");
    return;
  }

  if (clientGone || ac.signal.aborted) {
    // Client cancelled mid-stream: drop the dangling user message so the
    // conversation memory isn't polluted by an unanswered turn.
    await db
      .delete(chatMessagesTable)
      .where(eq(chatMessagesTable.id, userMessage.id));
    req.log.info(
      { conversationId: id },
      "chat stream cancelled; not persisting turn",
    );
    return;
  }

  const [assistantMessage] = await db
    .insert(chatMessagesTable)
    .values({
      conversationId: id,
      role: "assistant",
      action,
      content: outcome.content,
      structured: outcome.structured,
    })
    .returning();

  const shouldRename =
    conv.title === "New conversation" && body.content.trim().length > 0;
  await db
    .update(chatConversationsTable)
    .set({
      updatedAt: new Date(),
      ...(shouldRename ? { title: body.content.trim().slice(0, 80) } : {}),
    })
    .where(eq(chatConversationsTable.id, id));

  sse.done({
    userMessage: serializeMessage(userMessage),
    assistantMessage: serializeMessage(assistantMessage),
  });
});

export default router;
