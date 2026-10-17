/**
 * Jurexio Ministry Schema
 * Drizzle ORM table definitions for government/ministry platform
 */

import { pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const ministryDepartments = pgTable('ministry_departments', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).unique(),
  jurisdiction: varchar('jurisdiction', { length: 50 }).default('IN'),
  isActive: boolean('is_active').default(true),
  settings: jsonb('settings').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ministerialOrders = pgTable('ministerial_orders', {
  id: serial('id').primaryKey(),
  departmentId: integer('department_id'),
  orderNumber: varchar('order_number', { length: 100 }),
  title: varchar('title', { length: 500 }),
  content: text('content'),
  status: varchar('status', { length: 50 }).default('draft'),
  issuedAt: timestamp('issued_at'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
