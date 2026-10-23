#!/usr/bin/env node
// Extracts every `CREATE TABLE IF NOT EXISTS nv_schema.<x> (...)` block from src/,
// plus their accompanying CREATE INDEX statements within the same template-literal,
// and executes them against DATABASE_URL. Idempotent.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.cjs') || p.endsWith('.js'))) out.push(p);
  }
  return out;
}

function extractBlocks(content) {
  // Find each `sql\`...CREATE TABLE IF NOT EXISTS nv_schema.X ...\`` block.
  // Templates can span many lines and contain ${...} interpolations (none in CREATE statements normally).
  const out = [];
  const re = /sql`([\s\S]*?CREATE TABLE IF NOT EXISTS nv_schema\.[\s\S]*?)`/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const block = m[1];
    // We only want CREATE TABLE / CREATE INDEX / CREATE EXTENSION / ALTER TABLE statements.
    // Split into individual statements by ;
    const stmts = block.split(/;\s*(?=CREATE|ALTER|--)/i).map(s => s.trim()).filter(Boolean);
    for (const s of stmts) {
      const trimmed = s.replace(/;\s*$/, '').trim();
      if (!trimmed) continue;
      // Skip statements that contain ${} interpolation
      if (trimmed.includes('${')) continue;
      const head = trimmed.slice(0, 60).replace(/\s+/g, ' ');
      if (/^(CREATE TABLE IF NOT EXISTS nv_schema\.|CREATE INDEX IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS|ALTER TABLE nv_schema\.|CREATE EXTENSION IF NOT EXISTS)/i.test(trimmed)) {
        out.push({ stmt: trimmed, head });
      }
    }
  }
  return out;
}

(async () => {
  const files = walk('src').concat(walk('shared'));
  const all = [];
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    const blocks = extractBlocks(c);
    for (const b of blocks) all.push({ file: f, ...b });
  }
  console.log(`Found ${all.length} extractable DDL statements across ${files.length} source files.`);

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS nv_schema`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  // pgvector — best-effort (might not be available on all targets)
  try { await client.query(`CREATE EXTENSION IF NOT EXISTS vector`); } catch (e) { console.log('  (skip) vector ext:', e.message); }

  let okCnt = 0, failCnt = 0;
  const failures = [];
  for (const { file, stmt, head } of all) {
    try {
      await client.query(stmt);
      okCnt++;
    } catch (e) {
      failCnt++;
      failures.push({ file, head, msg: e.message });
    }
  }
  console.log(`OK: ${okCnt}  FAIL: ${failCnt}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.slice(0, 30).forEach(f => console.log(`  [${f.file}] ${f.head} → ${f.msg}`));
  }

  // Also pull pgEnum types referenced inside any of those CREATE TABLEs that don't already exist.
  // The case_update_type enum needs to be created before case_updates.
  const enumChk = await client.query(`SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname='nv_schema' AND t.typtype='e'`);
  console.log('Enums in nv_schema after run:', enumChk.rows.map(r => r.typname));

  // Final count
  const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='nv_schema' ORDER BY table_name`);
  console.log(`\nnv_schema tables in target now: ${tables.rows.length}`);
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
