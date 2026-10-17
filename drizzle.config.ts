import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./shared/schema.ts', './shared/nv-schema-tables.ts', './shared/nv-governance-schema.ts', './shared/nyayamitra-schema.ts', './shared/nyayasiddhi-institutional-schema.ts', './shared/nyayasiddhi-ministry-schema.ts', './shared/nyayasiddhi-academy-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: false,
  strict: false,
});
