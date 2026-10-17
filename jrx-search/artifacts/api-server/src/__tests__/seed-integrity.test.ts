/**
 * Data-integrity checks for data/seed-tasks.json and data/seed-templates.json.
 *
 * The task library (228 benchmark + catalog tasks) powers the whole product; a bad
 * regeneration or merge could wipe it with empty instructions, missing
 * rubric criteria, or duplicate slugs. These checks fail loudly (listing
 * the offenders) before bad data ever reaches the database.
 *
 * The validation logic lives in src/lib/seedIntegrity.ts and is shared with
 * the seeder pre-flights (src/seed.ts, src/seed-templates.ts) so they can't
 * drift. Pattern mirrors seed-statutes-integrity.test.ts.
 *
 * Run standalone via: pnpm --filter @workspace/api-server run check:seeds
 */
import { describe, it, expect } from "vitest";
import seedTasks from "../../data/seed-tasks.json";
import seedTemplates from "../../data/seed-templates.json";
import {
  type TaskSeedRow,
  type TemplateSeedRow,
  checkTaskCount,
  checkTaskDuplicateSlugs,
  checkTaskCategories,
  checkUnusedCategories,
  checkTaskTitlesAndSlugs,
  checkTaskInstructions,
  checkTaskDeliverables,
  checkTaskCriteria,
  validateTasksSeed,
  checkTemplateNonEmpty,
  checkTemplateDuplicateKeys,
  checkTemplateKinds,
  checkTemplateCategories,
  checkUnusedTemplateCategories,
  checkTemplateNames,
  checkTemplateBodies,
  validateTemplatesSeed,
} from "../lib/seedIntegrity";

const tasks = seedTasks as unknown as TaskSeedRow[];
const templates = seedTemplates as unknown as TemplateSeedRow[];

function expectClean(result: { name: string; errors: string[] }) {
  expect(result.errors, `${result.name}: ${result.errors.join(", ")}`).toEqual([]);
}

describe("seed-tasks.json integrity", () => {
  it("has exactly the expected task count", () => {
    expectClean(checkTaskCount(tasks));
  });

  it("has no duplicate (category, slug) pairs", () => {
    expectClean(checkTaskDuplicateSlugs(tasks));
  });

  it("uses only valid category slugs", () => {
    expectClean(checkTaskCategories(tasks));
  });

  it("uses every CATEGORY_NAMES slug in at least one task (no orphaned practice areas)", () => {
    expectClean(checkUnusedCategories(tasks));
  });

  it("has no empty slug/title/work_type", () => {
    expectClean(checkTaskTitlesAndSlugs(tasks));
  });

  it("has no empty or very short instructions", () => {
    expectClean(checkTaskInstructions(tasks));
  });

  it("has deliverables on every task", () => {
    expectClean(checkTaskDeliverables(tasks));
  });

  it("has valid, unique rubric criteria on every task", () => {
    expectClean(checkTaskCriteria(tasks));
  });

  it("passes the full validateTasksSeed pre-flight used by the seeder", () => {
    expect(validateTasksSeed(tasks)).toEqual([]);
  });
});

describe("seed-templates.json integrity", () => {
  it("contains templates", () => {
    expectClean(checkTemplateNonEmpty(templates));
  });

  it("has no duplicate (kind, slug) pairs", () => {
    expectClean(checkTemplateDuplicateKeys(templates));
  });

  it("uses only valid kinds", () => {
    expectClean(checkTemplateKinds(templates));
  });

  it("uses only canonical template categories", () => {
    expectClean(checkTemplateCategories(templates));
  });

  it("uses every canonical template category in at least one template", () => {
    expectClean(checkUnusedTemplateCategories(templates));
  });

  it("has no empty slug/title", () => {
    expectClean(checkTemplateNames(templates));
  });

  it("has no empty or very short bodies", () => {
    expectClean(checkTemplateBodies(templates));
  });

  it("passes the full validateTemplatesSeed pre-flight used by the seeder", () => {
    expect(validateTemplatesSeed(templates)).toEqual([]);
  });
});

describe("integrity checks catch corruption", () => {
  it("flags a task with empty instructions, missing criteria, and bad category", () => {
    const corrupted: TaskSeedRow[] = [
      {
        ...tasks[0],
        category: "not-a-real-category",
        instructions: "",
        criteria: [],
      },
    ];
    const failures = validateTasksSeed(corrupted);
    const names = failures.map((f) => f.name);
    expect(names).toContain("task count");
    expect(names).toContain("invalid category slugs");
    expect(names).toContain("empty or very short instructions");
    expect(names).toContain("missing/invalid rubric criteria");
  });

  it("flags duplicate task slugs within the same category", () => {
    const corrupted = [...tasks.slice(0, 143), { ...tasks[0] }] as TaskSeedRow[];
    const failures = validateTasksSeed(corrupted);
    expect(failures.map((f) => f.name)).toContain("duplicate (category, slug) pairs");
  });

  it("flags CATEGORY_NAMES slugs no seed task uses, listing offenders by name", () => {
    const withoutTax = tasks.filter((t) => t.category !== "tax");
    const failure = checkUnusedCategories(withoutTax);
    expect(failure.errors).toEqual(['tax ("Tax")']);
    const failures = validateTasksSeed(withoutTax);
    expect(failures.map((f) => f.name)).toContain(
      "unused category slugs (in CATEGORY_NAMES but no seed task uses them)",
    );
  });

  it("flags duplicate criterion ids within a task", () => {
    const c = tasks[0].criteria[0];
    const corrupted: TaskSeedRow[] = [{ ...tasks[0], criteria: [c, { ...c }] }];
    const failure = checkTaskCriteria(corrupted);
    expect(failure.errors.some((e) => e.includes("duplicate criterion id"))).toBe(true);
  });

  it("flags an empty template file and empty bodies", () => {
    expect(validateTemplatesSeed([]).map((f) => f.name)).toContain("templates present");
    const corrupted: TemplateSeedRow[] = [{ ...templates[0], body: " " }];
    const failures = validateTemplatesSeed(corrupted);
    expect(failures.map((f) => f.name)).toContain("empty or very short template body");
  });

  it("flags duplicate (kind, slug) template keys", () => {
    const corrupted = [templates[0], { ...templates[0] }] as TemplateSeedRow[];
    const failures = validateTemplatesSeed(corrupted);
    expect(failures.map((f) => f.name)).toContain("duplicate (kind, slug) pairs");
  });

  it("flags a template with a non-canonical category", () => {
    const corrupted: TemplateSeedRow[] = [
      { ...templates[0], category: "not-a-real-category" },
    ];
    const failure = checkTemplateCategories(corrupted);
    expect(failure.errors.length).toBe(1);
    expect(failure.errors[0]).toContain('not-a-real-category');
    const failures = validateTemplatesSeed(corrupted);
    expect(failures.map((f) => f.name)).toContain(
      "invalid template categories (not in TEMPLATE_CATEGORIES)",
    );
  });

  it("flags canonical template categories that no template uses", () => {
    const withoutCriminal = templates.filter((t) => t.category !== "criminal");
    const failure = checkUnusedTemplateCategories(withoutCriminal);
    expect(failure.errors).toContain("criminal");
    const failures = validateTemplatesSeed(withoutCriminal);
    expect(failures.map((f) => f.name)).toContain(
      "unused template categories (in TEMPLATE_CATEGORIES but no template uses them)",
    );
  });
});
