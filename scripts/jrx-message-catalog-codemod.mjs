#!/usr/bin/env node
/**
 * Mechanical migration: raw { success:false, error } → sendApiError / safeError.
 * Usage: node scripts/nv-message-catalog-codemod.mjs --apply src/routes/nv-auth-routes.ts ...
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const LITERAL_MAP = [
  [/job not found/i, 'JOB_NOT_FOUND'],
  [/document not found/i, 'DOC_NOT_FOUND'],
  [/not found/i, 'NOT_FOUND'],
  [/invalid credentials/i, 'UNAUTHORIZED'],
  [/not authenticated/i, 'UNAUTHORIZED'],
  [/authentication required|auth required/i, 'UNAUTHORIZED'],
  [/forbidden|access denied|permission/i, 'FORBIDDEN'],
  [/rate limit|too many/i, 'RATE_LIMIT_EXCEEDED'],
  [/database not available/i, 'DB_UNAVAILABLE'],
  [/required/i, 'BAD_REQUEST'],
];

function mapLiteral(msg) {
  for (const [re, code] of LITERAL_MAP) {
    if (re.test(msg)) return code;
  }
  return 'BAD_REQUEST';
}

function migrateFile(path) {
  let src = readFileSync(path, 'utf8');
  const orig = src;

  if (!src.includes('nv-api-error')) {
    const imp = "import { sendApiError, safeError } from '../utils/nv-api-error.js';\n";
    if (src.includes("from '../utils/")) {
      src = src.replace(/(import .+ from '\.\.\/utils\/[^']+';)\n/, `$1\n${imp}`);
    } else {
      src = imp + src;
    }
  }

  // sanitizeErrorForClient catch blocks
  src = src.replace(
    /res\.status\((\d+)\)\.json\(\{\s*success:\s*false,\s*error:\s*sanitizeErrorForClient\(([^)]+)\)\s*\}\);?/g,
    'safeError(res, $2, $1);',
  );

  // err.message / e.message patterns
  src = src.replace(
    /res\.status\((\d+)\)\.json\(\{\s*success:\s*false,\s*error:\s*(err|e|error)(?:\.message)?\s*\}\);?/g,
    'safeError(res, $2, $1);',
  );

  // template literal errors
  src = src.replace(
    /res\.status\((\d+)\)\.json\(\{\s*success:\s*false,\s*error:\s*`([^`]*)`\s*\}\);?/g,
    (_, status, msg) => {
      const code = mapLiteral(msg);
      return `sendApiError(res, '${code}', { status: ${status}, overrideMessage: \`${msg}\` });`;
    },
  );

  // dynamic status variable
  src = src.replace(
    /res\.status\((err\.statusCode)\)\.json\(\{\s*success:\s*false,\s*error:\s*err\.message\s*\}\);?/g,
    'safeError(res, err, err.statusCode || 500);',
  );

  // string literal errors
  src = src.replace(
    /res\.status\((\d+)\)\.json\(\{\s*success:\s*false,\s*error:\s*'([^']*)'\s*\}\);?/g,
    (_, status, msg) => {
      const code = mapLiteral(msg);
      if (code === 'BAD_REQUEST' && status !== '400') {
        return `sendApiError(res, '${code}', { status: ${status}, overrideMessage: '${msg.replace(/'/g, "\\'")}' });`;
      }
      if (code === 'BAD_REQUEST') {
        return `sendApiError(res, 'BAD_REQUEST', { overrideMessage: '${msg.replace(/'/g, "\\'")}' });`;
      }
      return `sendApiError(res, '${code}'${status !== '400' && code !== 'NOT_FOUND' && code !== 'UNAUTHORIZED' ? `, { status: ${status} }` : ''});`;
    },
  );

  // { error: '...' } without success (auth routes)
  src = src.replace(
    /res\.status\((\d+)\)\.json\(\{\s*error:\s*'([^']*)'\s*\}\);?/g,
    (_, status, msg) => {
      const code = mapLiteral(msg);
      const st = Number(status);
      if (code === 'DB_UNAVAILABLE' || msg === 'Database not available') {
        return `sendApiError(res, 'DB_UNAVAILABLE');`;
      }
      if (code === 'UNAUTHORIZED' && st === 401) return `sendApiError(res, 'UNAUTHORIZED');`;
      if (code === 'BAD_REQUEST' && st === 400) {
        return `sendApiError(res, 'BAD_REQUEST', { overrideMessage: '${msg.replace(/'/g, "\\'")}' });`;
      }
      return `safeError(res, '${msg.replace(/'/g, "\\'")}', ${status});`;
    },
  );

  if (src === orig) {
    console.log(`  · ${path} (no changes)`);
    return 0;
  }
  if (APPLY) {
    writeFileSync(path, src);
    console.log(`  ✓ ${path}`);
  } else {
    console.log(`  ~ ${path} (dry-run)`);
  }
  return 1;
}

let changed = 0;
for (const f of files) {
  try { changed += migrateFile(f); } catch (e) { console.error(`  ✗ ${f}:`, e.message); }
}
console.log(APPLY ? `Applied ${changed} file(s)` : `Dry-run: ${changed} file(s) would change`);
process.exit(0);
