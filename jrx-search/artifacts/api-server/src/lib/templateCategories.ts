/**
 * Canonical template-category list for data/seed-templates.json.
 *
 * These are the 17 categories currently used by the template/checklist seed.
 * The seed-integrity guard (src/lib/seedIntegrity.ts) enforces that every
 * template category comes from this list and that every canonical category is
 * used by at least one template — mirroring the task-category drift guard so a
 * bad regeneration/merge can't silently introduce or orphan categories.
 */
export const TEMPLATE_CATEGORIES = [
  "criminal",
  "civil",
  "constitutional",
  "commercial",
  "litigation",
  "corporate",
  "consumer",
  "family",
  "banking",
  "arbitration",
  "insolvency",
  "employment",
  "property",
  "privacy",
  "compliance",
  "ip",
  "estate",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_SET: Set<string> = new Set(TEMPLATE_CATEGORIES);
