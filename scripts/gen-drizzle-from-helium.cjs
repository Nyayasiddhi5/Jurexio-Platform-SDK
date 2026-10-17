#!/usr/bin/env node
const { Client } = require('pg');
const fs = require('fs');

const TARGETS = fs.readFileSync(process.argv[2] || '/tmp/tier-a.txt', 'utf8')
  .split('\n').filter(Boolean);

const PG_TO_DRIZZLE = (col) => {
  const t = col.data_type;
  const udt = col.udt_name;
  const charLen = col.character_maximum_length;
  const numPrec = col.numeric_precision;
  const numScale = col.numeric_scale;
  const dt = col.datetime_precision;
  switch (t) {
    case 'character varying': return `varchar(${charLen ? `'${col.column_name}', { length: ${charLen} }` : `'${col.column_name}'`})`;
    case 'character': return `varchar('${col.column_name}', { length: ${charLen} })`;
    case 'text': return `text('${col.column_name}')`;
    case 'integer':
      if (col.column_default && col.column_default.includes('nextval')) return `serial('${col.column_name}')`;
      return `integer('${col.column_name}')`;
    case 'bigint':
      if (col.column_default && col.column_default.includes('nextval')) return `bigserial('${col.column_name}', { mode: 'number' })`;
      return `bigint('${col.column_name}', { mode: 'number' })`;
    case 'smallint': return `smallint('${col.column_name}')`;
    case 'boolean': return `boolean('${col.column_name}')`;
    case 'json': return `json('${col.column_name}')`;
    case 'jsonb': return `jsonb('${col.column_name}')`;
    case 'uuid': return `uuid('${col.column_name}')`;
    case 'date': return `date('${col.column_name}')`;
    case 'time without time zone': return `time('${col.column_name}')`;
    case 'timestamp without time zone': return `timestamp('${col.column_name}', { withTimezone: false${dt != null ? `, precision: ${dt}` : ''} })`;
    case 'timestamp with time zone': return `timestamp('${col.column_name}', { withTimezone: true${dt != null ? `, precision: ${dt}` : ''} })`;
    case 'numeric': return `numeric('${col.column_name}'${numPrec ? `, { precision: ${numPrec}, scale: ${numScale || 0} }` : ''})`;
    case 'real': return `real('${col.column_name}')`;
    case 'double precision': return `doublePrecision('${col.column_name}')`;
    case 'bytea': return `customType<{ data: Buffer }>({ dataType: () => 'bytea' })('${col.column_name}')`;
    case 'inet': return `text('${col.column_name}')`;
    case 'ARRAY': {
      const elem = (udt || '').replace(/^_/, '');
      if (elem === 'text' || elem === 'varchar') return `text('${col.column_name}').array()`;
      if (elem === 'int4' || elem === 'int8') return `integer('${col.column_name}').array()`;
      return `text('${col.column_name}').array() /* ARRAY of ${elem} */`;
    }
    case 'USER-DEFINED':
      if (udt === 'vector') return `vector('${col.column_name}', { dimensions: 1536 })`;
      return `text('${col.column_name}') /* USER-DEFINED ${udt} */`;
    default: return `text('${col.column_name}') /* UNKNOWN ${t}/${udt} */`;
  }
};

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const Pascal = (s) => s.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());

function defaultExpr(col) {
  const d = col.column_default;
  if (d == null) return null;
  if (d.includes('nextval(')) return null; // serial handled
  if (d === 'now()' || d === 'CURRENT_TIMESTAMP' || d.startsWith('CURRENT_TIMESTAMP')) return '.defaultNow()';
  if (d === 'gen_random_uuid()') return '.default(sql`gen_random_uuid()`)';
  if (d === '(gen_random_uuid())::text') return '.default(sql`(gen_random_uuid())::text`)';
  if (d === 'true' || d === 'false') return `.default(${d})`;
  if (/^'.*'::text$/.test(d)) return `.default(${d.replace(/::text$/, '')})`;
  if (/^'.*'::character varying$/.test(d)) return `.default(${d.replace(/::character varying$/, '')})`;
  if (/^'.*'::jsonb?$/.test(d)) {
    const m = d.match(/^'(.*)'::jsonb?$/);
    return `.default(sql\`'${m[1].replace(/`/g, '\\`')}'::jsonb\`)`;
  }
  if (/^-?\d+(\.\d+)?$/.test(d)) return `.default(${d})`;
  if (/^\d+::/.test(d)) return `.default(${d.split('::')[0]})`;
  return `.default(sql\`${d.replace(/`/g, '\\`')}\`)`;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  let out = '';
  for (const tname of TARGETS) {
    const cols = await c.query(`
      SELECT column_name, data_type, udt_name, character_maximum_length,
             numeric_precision, numeric_scale, datetime_precision,
             is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema='nv_schema' AND table_name=$1
      ORDER BY ordinal_position
    `, [tname]);
    if (cols.rows.length === 0) {
      out += `// SKIP: ${tname} not found in local helium nv_schema\n\n`;
      continue;
    }

    const pkRes = await c.query(`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ('nv_schema."'||$1||'"')::regclass AND i.indisprimary
    `, [tname]);
    const pkCols = pkRes.rows.map(r => r.column_name);

    const idxRes = await c.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='nv_schema' AND tablename=$1 AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `, [tname]);

    const varName = `nv${Pascal(tname)}`;
    out += `// ${tname} — mirrored from local helium 2026-04-29 (Tier-A)\n`;
    out += `export const ${varName} = nvSchema.table('${tname}', {(_dummy:undefined)\n`.replace('{(_dummy:undefined)\n', '{\n');
    for (const col of cols.rows) {
      let line = `  ${camel(col.column_name)}: ${PG_TO_DRIZZLE(col)}`;
      const def = defaultExpr(col);
      if (def) line += def;
      if (col.is_nullable === 'NO') line += '.notNull()';
      if (pkCols.length === 1 && pkCols[0] === col.column_name) line += '.primaryKey()';
      out += line + ',\n';
    }
    out += `}`;
    if (pkCols.length > 1 || idxRes.rows.length > 0) {
      out += `, (t) => ({\n`;
      if (pkCols.length > 1) {
        out += `  pk: primaryKey({ columns: [${pkCols.map(c => `t.${camel(c)}`).join(', ')}] }),\n`;
      }
      for (const idx of idxRes.rows) {
        const isUnique = /CREATE UNIQUE/.test(idx.indexdef);
        const colsMatch = idx.indexdef.match(/\(([^)]+)\)/);
        if (!colsMatch) continue;
        const idxCols = colsMatch[1].split(',').map(s => {
          const parts = s.trim().split(/\s+/);
          const cName = parts[0].replace(/"/g, '');
          const desc = parts.includes('DESC');
          return desc ? `desc(t.${camel(cName)})` : `t.${camel(cName)}`;
        }).join(', ');
        const safeName = idx.indexname.replace(/[^a-zA-Z0-9]/g, '_');
        out += `  ${camel(safeName)}: ${isUnique ? 'uniqueIndex' : 'index'}('${idx.indexname}').on(${idxCols}),\n`;
      }
      out += `})`;
    }
    out += `);\nexport type Nv${Pascal(tname)} = typeof ${varName}.$inferSelect;\nexport type NewNv${Pascal(tname)} = typeof ${varName}.$inferInsert;\n\n`;
  }
  fs.writeFileSync('/tmp/tier-a-drizzle.ts', out);
  console.log('Wrote /tmp/tier-a-drizzle.ts (', out.split('\n').length, 'lines )');
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
