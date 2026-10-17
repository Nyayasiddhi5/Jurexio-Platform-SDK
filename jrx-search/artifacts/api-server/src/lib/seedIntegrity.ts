/**
 * Shared data-integrity validation for data/seed-tasks.json and
 * data/seed-templates.json.
 *
 * Used by both the vitest suite (src/__tests__/seed-integrity.test.ts) and
 * the seeder pre-flights (src/seed.ts, src/seed-templates.ts) so tests and
 * seeders can never drift. A bad regeneration or merge could wipe/replace
 * the task library with empty instructions, missing rubric criteria, or
 * duplicate slugs; these checks fail loudly (listing offenders) before
 * anything hits the database.
 *
 * Pattern mirrors src/lib/statutesIntegrity.ts.
 */

import { CATEGORY_NAMES } from "./categories";
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_SET } from "./templateCategories";

export interface IntegrityCheckResult {
  name: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// seed-tasks.json
// ---------------------------------------------------------------------------

export interface TaskSeedRow {
  category: string;
  slug: string;
  title: string;
  work_type: string;
  tags: string[];
  instructions: string;
  deliverables: Record<string, unknown> | string[];
  documents: string[];
  jurisdiction: string;
  criteria: { id: string; title: string; match_criteria: string }[];
}

/** Valid task jurisdiction tags: jurisdiction-specific (IN/US) or neutral (GLOBAL). */
export const VALID_TASK_JURISDICTIONS = new Set(["GLOBAL", "IN", "US"]);

export const EXPECTED_TASK_COUNT = 228;

/** Valid catalog category slugs — derived from lib/categories.ts so they can't drift. */
export const VALID_CATEGORY_SLUGS = new Set(Object.keys(CATEGORY_NAMES));

export const MIN_INSTRUCTIONS_LENGTH = 40;

function taskLabel(t: TaskSeedRow): string {
  return `${t.category}/${t.slug}`;
}

function deliverableCount(t: TaskSeedRow): number {
  if (Array.isArray(t.deliverables)) return t.deliverables.length;
  return Object.keys(t.deliverables ?? {}).length;
}

export function checkTaskCount(rows: TaskSeedRow[]): IntegrityCheckResult {
  return {
    name: "task count",
    errors:
      rows.length === EXPECTED_TASK_COUNT
        ? []
        : [`expected ${EXPECTED_TASK_COUNT} tasks, got ${rows.length}`],
  };
}

export function checkTaskDuplicateSlugs(rows: TaskSeedRow[]): IntegrityCheckResult {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of rows) {
    const key = `${t.category}::${t.slug}`;
    if (seen.has(key)) dupes.push(taskLabel(t));
    seen.add(key);
  }
  return { name: "duplicate (category, slug) pairs", errors: dupes };
}

export function checkTaskCategories(rows: TaskSeedRow[]): IntegrityCheckResult {
  return {
    name: "invalid category slugs",
    errors: rows
      .filter((t) => !VALID_CATEGORY_SLUGS.has(t.category))
      .map((t) => `${taskLabel(t)} (category "${t.category}")`),
  };
}

export function checkTaskTitlesAndSlugs(rows: TaskSeedRow[]): IntegrityCheckResult {
  const errors: string[] = [];
  rows.forEach((t, i) => {
    if (!(t.slug ?? "").trim()) errors.push(`index ${i}: empty slug`);
    if (!(t.title ?? "").trim()) errors.push(`${taskLabel(t)}: empty title`);
    if (!(t.work_type ?? "").trim()) errors.push(`${taskLabel(t)}: empty work_type`);
  });
  return { name: "empty slug/title/work_type", errors };
}

export function checkTaskInstructions(rows: TaskSeedRow[]): IntegrityCheckResult {
  return {
    name: "empty or very short instructions",
    errors: rows
      .filter((t) => (t.instructions ?? "").trim().length < MIN_INSTRUCTIONS_LENGTH)
      .map((t) => `${taskLabel(t)} (${(t.instructions ?? "").trim().length} chars)`),
  };
}

export function checkTaskDeliverables(rows: TaskSeedRow[]): IntegrityCheckResult {
  return {
    name: "missing deliverables",
    errors: rows.filter((t) => deliverableCount(t) === 0).map(taskLabel),
  };
}

export function checkTaskCriteria(rows: TaskSeedRow[]): IntegrityCheckResult {
  const errors: string[] = [];
  for (const t of rows) {
    const criteria = t.criteria ?? [];
    if (criteria.length === 0) {
      errors.push(`${taskLabel(t)}: no rubric criteria`);
      continue;
    }
    const ids = new Set<string>();
    for (const c of criteria) {
      if (!(c.id ?? "").trim()) errors.push(`${taskLabel(t)}: criterion with empty id`);
      else if (ids.has(c.id)) errors.push(`${taskLabel(t)}: duplicate criterion id "${c.id}"`);
      ids.add(c.id);
      if (!(c.title ?? "").trim()) errors.push(`${taskLabel(t)}: criterion "${c.id}" empty title`);
      if (!(c.match_criteria ?? "").trim())
        errors.push(`${taskLabel(t)}: criterion "${c.id}" empty match_criteria`);
    }
  }
  return { name: "missing/invalid rubric criteria", errors };
}

export function checkTaskJurisdictions(rows: TaskSeedRow[]): IntegrityCheckResult {
  return {
    name: "invalid task jurisdictions (must be GLOBAL, IN, or US)",
    errors: rows
      .filter((t) => !VALID_TASK_JURISDICTIONS.has(t.jurisdiction))
      .map((t) => `${taskLabel(t)} (jurisdiction "${t.jurisdiction}")`),
  };
}

export function checkUnusedCategories(rows: TaskSeedRow[]): IntegrityCheckResult {
  const used = new Set(rows.map((t) => t.category));
  return {
    name: "unused category slugs (in CATEGORY_NAMES but no seed task uses them)",
    errors: Object.entries(CATEGORY_NAMES)
      .filter(([slug]) => !used.has(slug))
      .map(([slug, name]) => `${slug} ("${name}")`),
  };
}

/** Run all task-seed integrity checks. Returns only the checks that failed. */
export function validateTasksSeed(rows: TaskSeedRow[]): IntegrityCheckResult[] {
  return [
    checkTaskCount(rows),
    checkTaskDuplicateSlugs(rows),
    checkTaskCategories(rows),
    checkTaskJurisdictions(rows),
    checkUnusedCategories(rows),
    checkTaskTitlesAndSlugs(rows),
    checkTaskInstructions(rows),
    checkTaskDeliverables(rows),
    checkTaskCriteria(rows),
  ].filter((c) => c.errors.length > 0);
}

// ---------------------------------------------------------------------------
// seed-templates.json
// ---------------------------------------------------------------------------

export interface TemplateSeedRow {
  kind: string;
  slug: string;
  title: string;
  category: string;
  jurisdiction: string;
  description: string;
  tags: string[];
  body: string;
}

export const MIN_TEMPLATE_BODY_LENGTH = 40;
export const VALID_TEMPLATE_KINDS = new Set(["template", "checklist"]);

function templateLabel(t: TemplateSeedRow): string {
  return `${t.kind}:${t.slug}`;
}

export function checkTemplateNonEmpty(rows: TemplateSeedRow[]): IntegrityCheckResult {
  return {
    name: "templates present",
    errors: rows.length > 0 ? [] : ["seed-templates.json contains no templates"],
  };
}

export function checkTemplateDuplicateKeys(rows: TemplateSeedRow[]): IntegrityCheckResult {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of rows) {
    const key = `${t.kind}::${t.slug}`;
    if (seen.has(key)) dupes.push(templateLabel(t));
    seen.add(key);
  }
  return { name: "duplicate (kind, slug) pairs", errors: dupes };
}

export function checkTemplateKinds(rows: TemplateSeedRow[]): IntegrityCheckResult {
  return {
    name: "invalid template kinds",
    errors: rows
      .filter((t) => !VALID_TEMPLATE_KINDS.has(t.kind))
      .map((t) => `${templateLabel(t)} (kind "${t.kind}")`),
  };
}

export function checkTemplateNames(rows: TemplateSeedRow[]): IntegrityCheckResult {
  const errors: string[] = [];
  rows.forEach((t, i) => {
    if (!(t.slug ?? "").trim()) errors.push(`index ${i}: empty slug`);
    if (!(t.title ?? "").trim()) errors.push(`${templateLabel(t)}: empty title`);
  });
  return { name: "empty slug/title", errors };
}

export function checkTemplateBodies(rows: TemplateSeedRow[]): IntegrityCheckResult {
  return {
    name: "empty or very short template body",
    errors: rows
      .filter((t) => (t.body ?? "").trim().length < MIN_TEMPLATE_BODY_LENGTH)
      .map((t) => `${templateLabel(t)} (${(t.body ?? "").trim().length} chars)`),
  };
}

export function checkTemplateCategories(rows: TemplateSeedRow[]): IntegrityCheckResult {
  return {
    name: "invalid template categories (not in TEMPLATE_CATEGORIES)",
    errors: rows
      .filter((t) => !TEMPLATE_CATEGORY_SET.has(t.category))
      .map((t) => `${templateLabel(t)} (category "${t.category}")`),
  };
}

export function checkUnusedTemplateCategories(
  rows: TemplateSeedRow[],
): IntegrityCheckResult {
  const used = new Set(rows.map((t) => t.category));
  return {
    name: "unused template categories (in TEMPLATE_CATEGORIES but no template uses them)",
    errors: TEMPLATE_CATEGORIES.filter((c) => !used.has(c)).map((c) => c),
  };
}

/** Run all template-seed integrity checks. Returns only the checks that failed. */
export function validateTemplatesSeed(rows: TemplateSeedRow[]): IntegrityCheckResult[] {
  return [
    checkTemplateNonEmpty(rows),
    checkTemplateDuplicateKeys(rows),
    checkTemplateKinds(rows),
    checkTemplateCategories(rows),
    checkUnusedTemplateCategories(rows),
    checkTemplateNames(rows),
    checkTemplateBodies(rows),
  ].filter((c) => c.errors.length > 0);
}
