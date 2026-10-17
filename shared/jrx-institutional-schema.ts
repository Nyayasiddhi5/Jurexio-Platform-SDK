/**
 * Jurexio Institutional Schema
 * Drizzle ORM table definitions for Jurexio Institutional platform
 */

import { pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const institutionalOrganizations = pgTable('institutional_organizations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  orgType: varchar('org_type', { length: 100 }),
  jurisdiction: varchar('jurisdiction', { length: 50 }),
  isActive: boolean('is_active').default(true),
  settings: jsonb('settings').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const institutionalCases = pgTable('institutional_cases', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id'),
  caseTitle: varchar('case_title', { length: 500 }),
  caseType: varchar('case_type', { length: 100 }),
  status: varchar('status', { length: 50 }).default('active'),
  priority: varchar('priority', { length: 50 }).default('normal'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
