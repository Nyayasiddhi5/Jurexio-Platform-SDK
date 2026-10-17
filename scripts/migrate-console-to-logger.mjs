/**
 * NYV Console-to-Logger Migration Script
 * Replaces all console.* calls with structured logger.* calls in src/ server files.
 *
 * Skips: guardrails/scripts, data/, scripts/ (console is intentional in utilities)
 * Usage: node scripts/migrate-console-to-logger.mjs [--dry-run]
 *
 * @file scripts/migrate-console-to-logger.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const DRY_RUN = process.argv.includes('--dry-run');

const SKIP_DIRS = new Set([
  'guardrails',
  'data',
]);

const SKIP_FILES = new Set([
  'logger.ts',
  'detect-hardcoded.ts',
  'detect-duplicates.ts',
  'audit-config.ts',
  'generate-all-registries.ts',
  'generate-usa-registry.ts',
  'migrate-console-to-logger.mjs',
]);

function getRelativeLoggerPath(filePath) {
  const fileDir = path.dirname(filePath);
  const loggerPath = path.join(SRC, 'utils', 'logger.ts');
  let rel = path.relative(fileDir, path.join(SRC, 'utils', 'logger.js'));
  rel = rel.replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function getModuleName(filePath) {
  const name = path.basename(filePath, '.ts');
  return name.replace(/^nv-/, '').replace(/-/g, '-').slice(0, 32);
}

function hasLoggerImport(content) {
  return /createLogger|from.*utils\/logger|from.*\/logger/.test(content);
}

function addLoggerImport(content, loggerRelPath) {
  const importLine = `import { createLogger } from '${loggerRelPath}';\n`;
  const lines = content.split('\n');
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith("import'")) {
      lastImportIndex = i;
    }
  }
  if (lastImportIndex >= 0) {
    lines.splice(lastImportIndex + 1, 0, importLine.trimEnd());
  } else {
    lines.unshift(importLine.trimEnd());
  }
  return lines.join('\n');
}

function addLoggerInit(content, moduleName) {
  if (/const logger\s*=/.test(content)) return content;
  const lines = content.split('\n');
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith("import'")) {
      insertAt = i + 1;
    }
  }
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  lines.splice(insertAt, 0, `\nconst logger = createLogger('${moduleName}');\n`);
  return lines.join('\n');
}

function replaceConsoleCalls(content) {
  return content
    .replace(/\bconsole\.log\b/g,   'logger.info')
    .replace(/\bconsole\.error\b/g, 'logger.error')
    .replace(/\bconsole\.warn\b/g,  'logger.warn')
    .replace(/\bconsole\.info\b/g,  'logger.info')
    .replace(/\bconsole\.debug\b/g, 'logger.debug');
}

function collectFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && entry.name !== 'node_modules' && entry.name !== 'dist') {
        collectFiles(full, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !SKIP_FILES.has(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const CONSOLE_RE = /\bconsole\.(log|error|warn|info|debug)\b/;

let migrated = 0;
let skipped = 0;

const allFiles = collectFiles(SRC);
for (const filePath of allFiles) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    continue;
  }

  if (!CONSOLE_RE.test(content)) {
    skipped++;
    continue;
  }

  const loggerRelPath = getRelativeLoggerPath(filePath);
  const moduleName    = getModuleName(filePath);
  let updated = content;

  if (!hasLoggerImport(updated)) {
    updated = addLoggerImport(updated, loggerRelPath);
    updated = addLoggerInit(updated, moduleName);
  } else if (!/const logger\s*=/.test(updated)) {
    updated = addLoggerInit(updated, moduleName);
  }

  updated = replaceConsoleCalls(updated);

  if (updated !== content) {
    if (DRY_RUN) {
      process.stdout.write(`[DRY-RUN] Would update: ${path.relative(ROOT, filePath)}\n`);
    } else {
      fs.writeFileSync(filePath, updated, 'utf-8');
      process.stdout.write(`[MIGRATED] ${path.relative(ROOT, filePath)}\n`);
    }
    migrated++;
  }
}

process.stdout.write(`\nMigration complete: ${migrated} files updated, ${skipped} files skipped (no console calls)\n`);
if (DRY_RUN) process.stdout.write('Dry-run mode: no files were modified\n');
