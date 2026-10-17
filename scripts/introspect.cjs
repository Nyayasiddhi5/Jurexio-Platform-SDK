const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await c.connect();

  const cols = await c.query(`
    SELECT table_name, column_name, data_type, udt_name,
           character_maximum_length, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
     WHERE table_schema = 'nv_schema'
     ORDER BY table_name, ordinal_position`);

  const idx = await c.query(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'nv_schema'
     ORDER BY tablename, indexname`);

  const con = await c.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
           string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'nv_schema'
       AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE','FOREIGN KEY')
     GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
     ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`);

  const tables = [...new Set(cols.rows.map(r => r.table_name))];
  const counts = {};
  for (const t of tables) {
    try {
      const r = await c.query('SELECT COUNT(*)::int n FROM nv_schema."' + t + '"');
      counts[t] = r.rows[0].n;
    } catch(e) { counts[t] = "ERR:" + e.message.slice(0,40); }
  }

  console.log("=== TABLES (" + tables.length + " total) ===");
  for (const t of tables) console.log("  " + t.padEnd(45) + " rows=" + counts[t]);

  console.log("\n=== COLUMNS ===");
  for (const r of cols.rows) {
    const len = r.character_maximum_length ? "(" + r.character_maximum_length + ")" : "";
    const nul = r.is_nullable === "NO" ? " NOT NULL" : "";
    const def = r.column_default ? " DEFAULT " + r.column_default : "";
    console.log("  " + r.table_name + "." + r.column_name + " :: " + r.udt_name + len + nul + def);
  }

  console.log("\n=== INDEXES ===");
  for (const r of idx.rows) console.log("  " + r.tablename + " :: " + r.indexname + "\n      " + r.indexdef);

  console.log("\n=== CONSTRAINTS ===");
  for (const r of con.rows) console.log("  " + r.table_name + " :: " + r.constraint_type + " " + r.constraint_name + " (" + r.cols + ")");

  await c.end();
})().catch(e => { console.error("FATAL:", e.message); console.error(e.stack); process.exit(1); });
