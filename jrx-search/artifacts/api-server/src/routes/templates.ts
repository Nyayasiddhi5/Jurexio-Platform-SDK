import { Router, type IRouter } from "express";
import { db, templatesTable } from "@workspace/db";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  CreateTemplateBody,
  UpdateTemplateBody,
  ExtractTemplateTextBody,
} from "@workspace/api-zod";
import {
  extractDocumentText,
  normalizeExtractedText,
  UnsupportedFileError,
  OcrError,
} from "../lib/extractDocText";
import {
  InvalidJurisdictionError,
  parseQueryJurisdiction,
  templateJurisdictionFilter,
} from "../lib/jurisdictionScope";

const router: IRouter = Router();

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function serialize(t: typeof templatesTable.$inferSelect, withBody: boolean) {
  return {
    id: t.id,
    kind: t.kind,
    slug: t.slug,
    title: t.title,
    category: t.category,
    jurisdiction: t.jurisdiction,
    description: t.description,
    tags: t.tags,
    isCustom: t.isCustom,
    source: t.source,
    sourceFilename: t.sourceFilename ?? null,
    ...(withBody ? { body: t.body } : {}),
  };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Generate a slug unique across the templates table (custom- prefix avoids
 * ever colliding with the seeded namespace). */
async function uniqueSlug(title: string): Promise<string> {
  const base = `custom-${slugify(title) || "template"}`;
  let candidate = base;
  for (let i = 2; ; i++) {
    const [existing] = await db
      .select({ id: templatesTable.id })
      .from(templatesTable)
      .where(eq(templatesTable.slug, candidate));
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
}

router.get("/templates", async (req, res) => {
  const conditions: SQL[] = [];
  try {
    const jf = templateJurisdictionFilter(parseQueryJurisdiction(req.query.jurisdiction));
    if (jf) conditions.push(jf);
  } catch (err) {
    if (err instanceof InvalidJurisdictionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (typeof req.query.kind === "string" && req.query.kind) {
    conditions.push(eq(templatesTable.kind, req.query.kind));
  }
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const q = `%${req.query.search.trim()}%`;
    const clause = or(
      ilike(templatesTable.title, q),
      ilike(templatesTable.description, q),
      ilike(templatesTable.category, q),
    );
    if (clause) conditions.push(clause);
  }
  const rows = await db
    .select()
    .from(templatesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(templatesTable.kind), asc(templatesTable.title));
  res.json(rows.map((t) => serialize(t, false)));
});

router.post("/templates", async (req, res) => {
  const body = CreateTemplateBody.parse(req.body);
  const slug = await uniqueSlug(body.title);
  const [created] = await db
    .insert(templatesTable)
    .values({
      kind: body.kind,
      slug,
      title: body.title.trim(),
      category: body.category.trim(),
      jurisdiction: body.jurisdiction,
      description: body.description.trim(),
      body: body.body,
      tags: (body.tags ?? []).map((t) => t.trim()).filter(Boolean),
      isCustom: true,
      source: body.sourceFilename ? "uploaded" : "created",
      sourceFilename: body.sourceFilename ?? null,
    })
    .returning();
  req.log.info(
    { id: created.id, slug: created.slug, source: created.source },
    "custom template created",
  );
  res.status(201).json(serialize(created, true));
});

router.post("/templates/extract", async (req, res) => {
  const body = ExtractTemplateTextBody.parse(req.body);
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
  let ocrUsed = false;
  try {
    const extracted = await extractDocumentText(body.filename, bytes);
    text = normalizeExtractedText(extracted.text);
    ocrUsed = extracted.ocrUsed;
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof OcrError) {
      req.log.error({ err: String(err) }, "OCR fallback failed for template upload");
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.warn({ err: String(err) }, "template document extraction failed");
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

  req.log.info(
    { filename: body.filename, textLength: text.length, ocrUsed },
    "template document extracted",
  );
  res.json({ filename: body.filename, text, ocrUsed });
});

router.get("/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  const [t] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, id));
  if (!t) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(serialize(t, true));
});

router.patch("/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  const body = UpdateTemplateBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  if (!existing.isCustom) {
    res.status(403).json({ error: "Seeded templates are read-only. Duplicate it as a custom template instead." });
    return;
  }
  const updates: Partial<typeof templatesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.kind !== undefined) updates.kind = body.kind;
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.category !== undefined) updates.category = body.category.trim();
  if (body.jurisdiction !== undefined) updates.jurisdiction = body.jurisdiction;
  if (body.description !== undefined) updates.description = body.description.trim();
  if (body.body !== undefined) updates.body = body.body;
  if (body.tags !== undefined)
    updates.tags = body.tags.map((t) => t.trim()).filter(Boolean);
  const [updated] = await db
    .update(templatesTable)
    .set(updates)
    .where(eq(templatesTable.id, id))
    .returning();
  req.log.info({ id }, "custom template updated");
  res.json(serialize(updated, true));
});

router.delete("/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  if (!existing.isCustom) {
    res.status(403).json({ error: "Seeded templates cannot be deleted." });
    return;
  }
  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  req.log.info({ id }, "custom template deleted");
  res.status(204).send();
});

export default router;
