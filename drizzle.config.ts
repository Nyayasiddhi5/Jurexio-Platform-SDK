import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./jurexio-sdk/shared/schema.ts', './jurexio-sdk/shared/jrx-schema-tables.ts', './jurexio-sdk/shared/jrx-governance-schema.ts', './jurexio-sdk/shared/jurexio-citizen-schema.ts', './jurexio-sdk/shared/jrx-institutional-schema.ts', './jurexio-sdk/shared/jrx-ministry-schema.ts', './jurexio-sdk/shared/jrx-academy-schema.ts'],
  out: './jurexio-sdk/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: false,
  strict: false,
});
