/**
 * Jurexio Academy Schema
 * Drizzle ORM table definitions for legal education platform
 */

import { pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb, real } from 'drizzle-orm/pg-core';

export const academyCourses = pgTable('academy_courses', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  level: varchar('level', { length: 50 }).default('beginner'),
  language: varchar('language', { length: 10 }).default('en'),
  duration: integer('duration'),
  isPublished: boolean('is_published').default(false),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const academyEnrollments = pgTable('academy_enrollments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  courseId: integer('course_id'),
  status: varchar('status', { length: 50 }).default('enrolled'),
  progress: real('progress').default(0),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
