#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makePgSql } from './_pg-pool.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SEED_PATH = path.join(ROOT, 'config', 'bar-council-seed-v5.1.0.json');

type SeedRule = {
  jurisdiction: string;
  rule_id: string;
  rule_text: string;
  enforcement: 'WARN' | 'BLOCK' | 'HITL' | 'MANDATORY_HITL';
};

async function main(): Promise<void> {
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Bar council seed file not found: ${SEED_PATH}`);
  }

  const payload = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8')) as {
    tableSchema?: string;
    seedRules?: SeedRule[];
  };

  const sql = makePgSql(process.env.JRX_DATABASE_URL || process.env.DATABASE_URL);

  try {
    await sql.pool.query('CREATE SCHEMA IF NOT EXISTS jrx');

    const createTable = String(payload.tableSchema || '')
      .replace('CREATE TABLE jrx.bar_council_config', 'CREATE TABLE IF NOT EXISTS jrx.bar_council_config');
    if (!createTable) {
      throw new Error('barCouncilConfig.tableSchema missing from seed payload');
    }
    await sql.pool.query(createTable);
    await sql.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS jrx_bar_council_config_rule_idx ON jrx.bar_council_config (jurisdiction, rule_id)',
    );

    let upserted = 0;
    for (const rule of payload.seedRules || []) {
      await sql.pool.query(
        `
          INSERT INTO jrx.bar_council_config (
            jurisdiction,
            rule_id,
            rule_text,
            enforcement,
            active,
            effective_from,
            effective_to,
            last_updated
          )
          VALUES ($1, $2, $3, $4, TRUE, CURRENT_DATE, NULL, NOW())
          ON CONFLICT (jurisdiction, rule_id)
          DO UPDATE SET
            rule_text = EXCLUDED.rule_text,
            enforcement = EXCLUDED.enforcement,
            active = TRUE,
            effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to,
            last_updated = NOW()
        `,
        [rule.jurisdiction, rule.rule_id, rule.rule_text, rule.enforcement],
      );
      upserted += 1;
    }

    console.log(
      JSON.stringify(
        {
          table: 'jrx.bar_council_config',
          upserted,
          jurisdictions: Array.from(new Set((payload.seedRules || []).map(rule => rule.jurisdiction))).sort(),
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
