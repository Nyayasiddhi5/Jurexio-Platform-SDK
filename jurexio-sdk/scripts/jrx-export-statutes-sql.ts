/**
 * NV-STATUTE-EXPANSION-001 — emit idempotent SQL for the 2026-06 statute
 * expansion so it can be applied to prod RDS as the privileged role (nyvadmin)
 * without depending on the gateway's runtime role having INSERT, and without
 * importing the DB-bound seeding service. Pure data in → SQL out.
 *
 *   npx tsx scripts/jrx-export-statutes-sql.ts > migrations/2026-06-25-statutes-expansion.sql
 */
import { EXPANSION_STATUTES, EXPANSION_COUNT_BY_JURISDICTION } from '../src/data/jrx-statutes-expansion-2026-06.js';

const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${(xs ?? []).map(q).join(', ')}]::text[]`;

const lines: string[] = [];
lines.push('-- NV-STATUTE-EXPANSION-001 (2026-06-25) — foundational statute expansion');
lines.push('-- Generated from src/data/jrx-statutes-expansion-2026-06.ts. Idempotent.');
lines.push(`-- Counts: ${JSON.stringify(EXPANSION_COUNT_BY_JURISDICTION)} | total ${EXPANSION_STATUTES.length}`);
lines.push('');
lines.push('BEGIN;');
lines.push('');
lines.push('-- Self-contained guard: nv_statutes is normally provisioned at runtime by the');
lines.push('-- statute-seeding service (best-effort DDL). Recreate it here IF NOT EXISTS so a');
lines.push('-- fresh `createdb + psql -f` of the checked-in migration set applies cleanly. On');
lines.push('-- the live RDS the table already exists, so this is a no-op (column shape mirrors');
lines.push('-- the live RDS definition).');
lines.push('CREATE TABLE IF NOT EXISTS public.nv_statutes (');
lines.push('  id               serial PRIMARY KEY,');
lines.push('  act_title        text NOT NULL,');
lines.push('  act_short_title  text NOT NULL,');
lines.push('  jurisdiction     varchar NOT NULL,');
lines.push('  section_number   varchar NOT NULL,');
lines.push('  section_title    text,');
lines.push('  section_text     text,');
lines.push('  practice_area    varchar,');
lines.push('  keywords         text[],');
lines.push('  effective_date   date,');
lines.push('  amended_date     date,');
lines.push('  related_sections text[],');
lines.push('  is_repealed      boolean DEFAULT false,');
lines.push('  search_vector    tsvector,');
lines.push('  created_at       timestamptz DEFAULT now(),');
lines.push('  updated_at       timestamptz DEFAULT now(),');
lines.push('  CONSTRAINT nv_statutes_jurisdiction_act_short_title_section_number_key');
lines.push('    UNIQUE (jurisdiction, act_short_title, section_number)');
lines.push(');');
lines.push('');

for (const s of EXPANSION_STATUTES) {
  lines.push(
    `INSERT INTO public.nv_statutes (act_title, act_short_title, jurisdiction, section_number, section_title, section_text, practice_area, keywords, effective_date, is_repealed) VALUES (` +
      `${q(s.actTitle)}, ${q(s.actShortTitle)}, ${q(s.jurisdiction)}, ${q(s.sectionNumber)}, ${q(s.sectionTitle)}, ${q(s.sectionText)}, ${q(s.practiceArea)}, ${arr(s.keywords)}, ${q(s.effectiveDate)}::date, ${s.isRepealed ? 'TRUE' : 'FALSE'}` +
      `) ON CONFLICT (jurisdiction, act_short_title, section_number) DO UPDATE SET ` +
      `act_title = EXCLUDED.act_title, section_title = EXCLUDED.section_title, section_text = EXCLUDED.section_text, ` +
      `practice_area = EXCLUDED.practice_area, keywords = EXCLUDED.keywords, effective_date = EXCLUDED.effective_date, ` +
      `is_repealed = EXCLUDED.is_repealed, updated_at = NOW();`,
  );
}

lines.push('');
lines.push('-- Ensure the runtime role can read + future boot-seed these rows. Guarded so a');
lines.push('-- fresh DB without the nv_app role still applies cleanly.');
lines.push('DO $$');
lines.push('BEGIN');
lines.push("  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN");
lines.push("    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.nv_statutes TO nv_app';");
lines.push("    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.nv_statutes_id_seq TO nv_app';");
lines.push('  END IF;');
lines.push('END $$;');
lines.push('');
lines.push('COMMIT;');
lines.push('');

process.stdout.write(lines.join('\n'));
