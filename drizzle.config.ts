import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./shared/schema.ts', './shared/jrx-schema-tables.ts', './shared/jrx-governance-schema.ts', './shared/jurexio-citizen-schema.ts', './shared/jrx-institutional-schema.ts', './shared/jrx-ministry-schema.ts', './shared/jrx-academy-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: false,
  strict: false,
});
