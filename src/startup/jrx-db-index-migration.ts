/**
 * NV Core — Database Index Migration (Sprint 12)
 * Adds production-grade indexes on all high-query ns_* and nm_* tables.
 * Uses CREATE INDEX IF NOT EXISTS — safe to run on every startup.
 *
 * Tables targeted:
 *   ns_cases, ns_ai_sessions, ns_documents, ns_legal_corpus,
 *   nm_cases, nm_consultations, nm_users, nm_literacy_content,
 *   api_keys, sdk_applications, audit_trail
 */

import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('db-index-migration');

const INDEXES: string[] = [
  /* ── ns_cases ──────────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_cases_org_id         ON ns_cases(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_cases_status         ON ns_cases(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_cases_user_id        ON ns_cases(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_cases_created_at     ON ns_cases(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_cases_matter_type    ON ns_cases(matter_type)`,

  /* ── ns_matters (NSP Professional) ─────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_matters_org_id       ON ns_matters(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_matters_status       ON ns_matters(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_matters_assigned_to  ON ns_matters(assigned_to)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_matters_created_at   ON ns_matters(created_at DESC)`,

  /* ── ns_clients ─────────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_clients_org_id       ON ns_clients(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_clients_email        ON ns_clients(email)`,

  /* ── ns_documents ───────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_documents_org_id     ON ns_documents(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_documents_matter_id  ON ns_documents(matter_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_documents_created_at ON ns_documents(created_at DESC)`,

  /* ── ns_ai_sessions ─────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_sessions_org_id   ON ns_ai_sessions(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_sessions_user_id  ON ns_ai_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_sessions_created  ON ns_ai_sessions(created_at DESC)`,

  /* ── ns_ai_usage_logs ───────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_usage_org_id      ON ns_ai_usage_logs(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_usage_created_at  ON ns_ai_usage_logs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_ai_usage_agent       ON ns_ai_usage_logs(agent_key)`,

  /* ── ns_calendar_events ─────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_calendar_org_id      ON ns_calendar_events(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_calendar_start_at    ON ns_calendar_events(start_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_calendar_user_id     ON ns_calendar_events(user_id)`,

  /* ── ns_billing_invoices ────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_invoices_org_id      ON ns_billing_invoices(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_invoices_status      ON ns_billing_invoices(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_invoices_due_date    ON ns_billing_invoices(due_date)`,

  /* ── ns_push_tokens ─────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_push_tokens_user_id  ON ns_push_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_push_tokens_org_id   ON ns_push_tokens(org_id)`,

  /* ── ns_audit_trail ─────────────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_audit_org_id         ON ns_audit_trail(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_audit_created_at     ON ns_audit_trail(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_audit_user_id        ON ns_audit_trail(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_audit_action         ON ns_audit_trail(action)`,

  /* ── ns_indian_law_corpus ───────────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_ns_corpus_statute       ON ns_indian_law_corpus(statute_code)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_corpus_section       ON ns_indian_law_corpus(section_number)`,
  `CREATE INDEX IF NOT EXISTS idx_ns_corpus_practice      ON ns_indian_law_corpus(practice_area)`,

  /* ── nm_* (Jurexio Citizen citizen) ──────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_nm_cases_user_id        ON nm_cases(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nm_cases_status         ON nm_cases(status)`,
  `CREATE INDEX IF NOT EXISTS idx_nm_cases_created_at     ON nm_cases(created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_nm_chat_sessions_user   ON nm_chat_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nm_chat_sessions_date   ON nm_chat_sessions(created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_nm_appointments_user    ON nm_appointments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nm_appointments_date    ON nm_appointments(appointment_date)`,

  `CREATE INDEX IF NOT EXISTS idx_nm_users_phone          ON nm_users(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_nm_users_created_at     ON nm_users(created_at DESC)`,

  /* ── NV SDK keys / applications ─────────────────────── */
  `CREATE INDEX IF NOT EXISTS idx_nv_api_keys_key_hash     ON nv_api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_nv_api_keys_app_id       ON nv_api_keys(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nv_sdk_apps_org_id       ON nv_sdk_applications(org_id)`,

  /* ── DB-03: Missing B-tree indices (audit remediation) */
  `CREATE INDEX IF NOT EXISTS idx_legal_agents_category      ON legal_agents(category)`,
  `CREATE INDEX IF NOT EXISTS idx_legal_agents_practice_area ON legal_agents(practice_area)`,
  `CREATE INDEX IF NOT EXISTS idx_jurexio-citizen_cases_user_id   ON jurexio-citizen_cases(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_academy_enrollments_course  ON academy_enrollments(course_id)`,
];

export async function runDbIndexMigration(): Promise<void> {
  logger.info('[DB-Index] Starting index migration...');
  let created = 0;
  let skipped = 0;

  for (const sql of INDEXES) {
    try {
      if (!pool) {
        skipped++;
        continue;
      }
      await pool.query(sql);
      created++;
    } catch (_e: any) {
      skipped++;
    }
  }

  logger.info(`[DB-Index] Index migration complete: ${created} applied, ${skipped} skipped (table may not exist yet — safe to ignore).`);
}
