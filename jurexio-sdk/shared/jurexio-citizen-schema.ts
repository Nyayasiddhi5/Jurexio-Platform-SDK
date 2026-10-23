/**
 * Jurexio Citizen Schema — Citizen Legal Platform
 * Drizzle ORM table definitions for Jurexio Citizen
 */

import { pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const jrxCitizenUsers = pgTable('jrx_citizen_users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique(),
  fullName: varchar('full_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  preferredLanguage: varchar('preferred_language', { length: 10 }).default('en'),
  isActive: boolean('is_active').default(true),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const jrxCitizenCases = pgTable('jrx_citizen_cases', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  caseType: varchar('case_type', { length: 100 }),
  title: varchar('title', { length: 500 }),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('open'),
  jurisdiction: varchar('jurisdiction', { length: 50 }).default('IN'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** @deprecated use jrxCitizenUsers */
export const jurexioCitizenUsers = jrxCitizenUsers;
/** @deprecated use jrxCitizenCases */
export const jurexioCitizenCases = jrxCitizenCases;
