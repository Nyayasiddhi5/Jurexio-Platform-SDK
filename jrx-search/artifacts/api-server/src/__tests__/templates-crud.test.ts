/**
 * Route-level tests for the custom-templates CRUD surface:
 *   - POST /api/templates creates a custom row (isCustom=true, custom- slug)
 *   - PATCH/DELETE are refused (403) on seeded rows, allowed on custom rows
 *   - POST /api/templates/extract turns an uploaded MD/TXT file into text
 *   - Reseed protection: the seeder's delete only targets isCustom=false rows
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, inArray, eq } from "drizzle-orm";

const { db, templatesTable } = await import("@workspace/db");
const { default: app } = await import("../app");

const createdIds: number[] = [];

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(templatesTable).where(inArray(templatesTable.id, createdIds));
  }
});

async function insertSeededFixture() {
  const [row] = await db
    .insert(templatesTable)
    .values({
      kind: "template",
      slug: `test-seeded-fixture-${Date.now()}`,
      title: "Seeded Fixture Template",
      category: "testing",
      jurisdiction: "IN",
      description: "Seeded fixture for protection tests",
      body: "Seeded body content, protected from mutation.",
      tags: [],
      isCustom: false,
      source: "seeded",
    })
    .returning();
  createdIds.push(row.id);
  return row;
}

describe("POST /api/templates", () => {
  it("creates a custom template with a custom- slug and isCustom=true", async () => {
    const res = await request(app).post("/api/templates").send({
      kind: "checklist",
      title: "Vitest Custom Checklist",
      category: "testing",
      jurisdiction: "US",
      description: "Created by the CRUD regression suite",
      body: "1. First step\n2. Second step\n3. Third step of the checklist",
      tags: ["vitest", "crud"],
    });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.isCustom).toBe(true);
    expect(res.body.source).toBe("created");
    expect(res.body.slug).toMatch(/^custom-vitest-custom-checklist/);
    expect(res.body.tags).toEqual(["vitest", "crud"]);
  });

  it("marks uploads via sourceFilename as source=uploaded", async () => {
    const res = await request(app).post("/api/templates").send({
      kind: "template",
      title: "Vitest Uploaded Template",
      category: "testing",
      jurisdiction: "IN",
      description: "Uploaded by the CRUD regression suite",
      body: "Body text long enough to satisfy the minimum length rule.",
      sourceFilename: "uploaded-draft.docx",
    });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.source).toBe("uploaded");
    expect(res.body.sourceFilename).toBe("uploaded-draft.docx");
  });

  it("rejects invalid input (title too short)", async () => {
    const res = await request(app).post("/api/templates").send({
      kind: "template",
      title: "ab",
      category: "testing",
      jurisdiction: "IN",
      description: "bad",
      body: "too short",
    });
    expect(res.status).toBe(400);
  });

  it("deduplicates slugs for identical titles", async () => {
    const payload = {
      kind: "template" as const,
      title: "Vitest Duplicate Title",
      category: "testing",
      jurisdiction: "IN" as const,
      description: "Slug dedupe test",
      body: "Body text long enough to satisfy the minimum length rule.",
    };
    const a = await request(app).post("/api/templates").send(payload);
    const b = await request(app).post("/api/templates").send(payload);
    createdIds.push(a.body.id, b.body.id);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.slug).not.toBe(b.body.slug);
  });
});

describe("PATCH & DELETE protection", () => {
  it("refuses to modify or delete a seeded template (403)", async () => {
    const seeded = await insertSeededFixture();
    const patch = await request(app)
      .patch(`/api/templates/${seeded.id}`)
      .send({ title: "Mutated Seeded Title" });
    expect(patch.status).toBe(403);
    const del = await request(app).delete(`/api/templates/${seeded.id}`);
    expect(del.status).toBe(403);
    const [still] = await db
      .select()
      .from(templatesTable)
      .where(eq(templatesTable.id, seeded.id));
    expect(still.title).toBe("Seeded Fixture Template");
  });

  it("updates and deletes a custom template", async () => {
    const created = await request(app).post("/api/templates").send({
      kind: "template",
      title: "Vitest Mutable Template",
      category: "testing",
      jurisdiction: "IN",
      description: "Will be edited then deleted",
      body: "Original body text long enough for the minimum length.",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const patch = await request(app)
      .patch(`/api/templates/${id}`)
      .send({ title: "Vitest Mutable Template (edited)", tags: ["edited"] });
    expect(patch.status).toBe(200);
    expect(patch.body.title).toBe("Vitest Mutable Template (edited)");
    expect(patch.body.tags).toEqual(["edited"]);

    const del = await request(app).delete(`/api/templates/${id}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/templates/${id}`);
    expect(get.status).toBe(404);
  });

  it("returns 404 for a missing template", async () => {
    const res = await request(app)
      .patch("/api/templates/99999999")
      .send({ title: "Does Not Exist" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/templates/extract", () => {
  it("extracts text from a markdown upload", async () => {
    const content = "# Draft Notice\n\n1. Parties\n2. Facts\n3. Prayer for relief";
    const res = await request(app).post("/api/templates/extract").send({
      filename: "draft-notice.md",
      contentBase64: Buffer.from(content, "utf8").toString("base64"),
    });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Draft Notice");
    expect(res.body.ocrUsed).toBe(false);
  });

  it("rejects unsupported file types", async () => {
    const res = await request(app).post("/api/templates/extract").send({
      filename: "image.png",
      contentBase64: Buffer.from("fake").toString("base64"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects empty uploads", async () => {
    const res = await request(app).post("/api/templates/extract").send({
      filename: "empty.txt",
      contentBase64: "AA==",
    });
    expect(res.status).toBe(400);
  });
});

describe("reseed protection", () => {
  it("the seeder delete filter removes only non-custom rows", async () => {
    const seeded = await insertSeededFixture();
    const custom = await request(app).post("/api/templates").send({
      kind: "template",
      title: "Vitest Reseed Survivor",
      category: "testing",
      jurisdiction: "IN",
      description: "Must survive the seeded-row purge",
      body: "Body text long enough to satisfy the minimum length rule.",
    });
    createdIds.push(custom.body.id);

    // Same predicate the seeder uses (isCustom = false), scoped to our fixture ids
    // so the test never wipes the real seeded library.
    await db
      .delete(templatesTable)
      .where(
        and(
          eq(templatesTable.isCustom, false),
          inArray(templatesTable.id, [seeded.id, custom.body.id]),
        ),
      );

    const [seededGone] = await db
      .select()
      .from(templatesTable)
      .where(eq(templatesTable.id, seeded.id));
    const [customAlive] = await db
      .select()
      .from(templatesTable)
      .where(eq(templatesTable.id, custom.body.id));
    expect(seededGone).toBeUndefined();
    expect(customAlive).toBeDefined();
    expect(customAlive.isCustom).toBe(true);
  });
});
