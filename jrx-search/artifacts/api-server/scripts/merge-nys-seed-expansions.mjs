#!/usr/bin/env node
/**
 * Merge optional expansion JSON arrays into seed-templates.json and seed-tasks.json.
 * Usage: node scripts/merge-nys-seed-expansions.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(dataDir, name), "utf8"));
}

function loadOptional(name) {
  try {
    return loadJson(name);
  } catch {
    return [];
  }
}

function dedupeTemplates(base, extra) {
  const seen = new Set(base.map((t) => `${t.kind}::${t.slug}`));
  const out = [...base];
  for (const t of extra) {
    const key = `${t.kind}::${t.slug}`;
    if (seen.has(key)) {
      console.warn(`skip duplicate template ${key}`);
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

function dedupeTasks(base, extra) {
  const seen = new Set(base.map((t) => `${t.category}::${t.slug}`));
  const out = [...base];
  for (const t of extra) {
    const key = `${t.category}::${t.slug}`;
    if (seen.has(key)) {
      console.warn(`skip duplicate task ${key}`);
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

const templates = dedupeTemplates(
  loadJson("seed-templates.json"),
  [
    ...loadOptional("seed-templates-us-expansion.json"),
    ...loadOptional("seed-templates-us-expansion-2.json"),
    ...loadOptional("seed-templates-in-catalog-2026-07.json"),
    ...loadOptional("seed-templates-us-catalog-2026-07.json"),
    ...loadOptional("seed-templates-in-filing-2026-07.json"),
    ...loadOptional("seed-templates-us-filing-2026-07.json"),
    ...loadOptional("seed-templates-in-parity-2026-07.json"),
    ...loadOptional("seed-templates-in-court-tiers-2026-07.json"),
  ],
);
const tasks = dedupeTasks(loadJson("seed-tasks.json"), [
  ...loadOptional("seed-tasks-in-expansion.json"),
  ...loadOptional("seed-tasks-in-expansion-2.json"),
  ...loadOptional("seed-tasks-in-catalog-2026-07.json"),
  ...loadOptional("seed-tasks-us-catalog-2026-07.json"),
  ...loadOptional("seed-tasks-in-parity-2026-07.json"),
]);

writeFileSync(
  path.join(dataDir, "seed-templates.json"),
  `${JSON.stringify(templates, null, 2)}\n`,
);
writeFileSync(path.join(dataDir, "seed-tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`);

const byJur = (arr, key) =>
  arr.reduce((a, x) => {
    a[x[key]] = (a[x[key]] || 0) + 1;
    return a;
  }, {});

console.log("templates total", templates.length, byJur(templates, "jurisdiction"));
console.log("tasks total", tasks.length, byJur(tasks, "jurisdiction"));
