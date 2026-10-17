CREATE TYPE "public"."ai_activity_type" AS ENUM('PATTERN_CALL', 'RAG_QUERY', 'AGENT_DISPATCH', 'DOCUMENT_ANALYSIS', 'VOICE_CALL', 'KNOWLEDGE_QUERY', 'GRPO_EVAL');--> statement-breakpoint
CREATE TYPE "public"."case_update_type" AS ENUM('STATUS_CHANGE', 'HEARING_SCHEDULED', 'ORDER_PASSED', 'FILING_DONE', 'JUDGMENT', 'NOTICE_RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('CREDIT_TOPUP', 'CREDIT_USAGE', 'CREDIT_REFUND', 'CREDIT_EXPIRY', 'CREDIT_BONUS', 'CREDIT_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."filing_status" AS ENUM('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'PROCESSED', 'REJECTED', 'APPEAL_PENDING');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('SOLO', 'PLUS', 'PRO', 'INSTITUTIONAL', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED');--> statement-breakpoint
CREATE TABLE "nv_agui_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"pattern" varchar(20),
	"agent_id" varchar(60),
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"event_count" integer DEFAULT 0,
	"tokens_streamed" integer DEFAULT 0,
	"duration_ms" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'running',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "nv_ai_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"org_id" varchar(100),
	"session_id" varchar(200),
	"activity_type" "ai_activity_type" NOT NULL,
	"pattern_key" varchar(10),
	"agent_id" varchar(100),
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"model_provider" varchar(50),
	"model_name" varchar(100),
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"latency_ms" integer DEFAULT 0,
	"credits_charged" integer DEFAULT 0,
	"blocked" boolean DEFAULT false,
	"block_reason" text,
	"trace_id" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_automate_executions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(36) NOT NULL,
	"status" varchar(20) DEFAULT 'running',
	"steps_completed" integer DEFAULT 0,
	"steps_total" integer DEFAULT 0,
	"result" jsonb,
	"error_msg" text,
	"triggered_by" varchar(36),
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "nv_automate_workflows" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"trigger" varchar(30) DEFAULT 'manual',
	"steps" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(20) DEFAULT 'draft',
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"run_count" integer DEFAULT 0,
	"last_run_at" timestamp,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_case_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"document_id" integer,
	"added_by" integer,
	"document_role" varchar(100) DEFAULT 'supporting',
	"summary" text,
	"extracted_entities" jsonb DEFAULT '{}'::jsonb,
	"source" varchar(100) DEFAULT 'upload',
	"notes" text,
	"version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_case_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"insight_type" varchar(100),
	"title" varchar(500),
	"content" text,
	"confidence" real DEFAULT 0.8,
	"sources" jsonb DEFAULT '[]'::jsonb,
	"agent_id" varchar(100),
	"orchestration_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_case_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"case_number" varchar(200) NOT NULL,
	"court_code" varchar(50),
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"update_type" "case_update_type" NOT NULL,
	"summary" text,
	"hearing_date" timestamp,
	"order_date" timestamp,
	"judges" text[] DEFAULT '{}',
	"next_hearing_date" timestamp,
	"raw_data" jsonb DEFAULT '{}'::jsonb,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" varchar(100),
	"title" varchar(500) NOT NULL,
	"description" text,
	"case_type" varchar(100),
	"jurisdiction" varchar(200),
	"court_name" varchar(255),
	"status" varchar(50) DEFAULT 'open',
	"priority" varchar(50) DEFAULT 'normal',
	"user_id" integer,
	"organization_id" integer,
	"lawyer_id" integer,
	"applicable_sections" jsonb DEFAULT '[]'::jsonb,
	"parties" jsonb DEFAULT '[]'::jsonb,
	"client_details" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}',
	"insights_generated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_clawd_bots" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"channels" jsonb DEFAULT '[]'::jsonb,
	"system_prompt" text,
	"persona" varchar(60) DEFAULT 'professional',
	"status" varchar(20) DEFAULT 'draft',
	"total_chats" integer DEFAULT 0,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_clawd_conversations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"bot_id" varchar(36) NOT NULL,
	"user_id" varchar(36),
	"channel" varchar(30) DEFAULT 'web',
	"status" varchar(20) DEFAULT 'open',
	"messages" jsonb DEFAULT '[]'::jsonb,
	"risk_score" real DEFAULT 0,
	"escalated" boolean DEFAULT false,
	"closed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" text,
	"reference_id" varchar(200),
	"reference_type" varchar(50),
	"pattern_key" varchar(10),
	"tokens_consumed" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_credit_wallet" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"org_id" varchar(100),
	"balance_credits" integer DEFAULT 0 NOT NULL,
	"lifetime_earned_credits" integer DEFAULT 0 NOT NULL,
	"lifetime_spent_credits" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'INR',
	"expires_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_document_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"chunk_id" varchar(100),
	"user_id" varchar(100),
	"assistant_id" integer,
	"text" text,
	"text_hash" varchar(64),
	"embedding" double precision[],
	"model" varchar(100),
	"provider" varchar(100),
	"dimensions" integer,
	"chunk_index" integer,
	"start_position" integer,
	"end_position" integer,
	"word_count" integer,
	"character_count" integer,
	"document_type" varchar(100),
	"source_file_name" varchar(500),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_extracted_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"content_type" varchar(100),
	"content" text,
	"confidence" real,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"page_number" integer,
	"text" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_parsing" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"filename" varchar(500),
	"original_filename" varchar(500),
	"mime_type" varchar(100),
	"file_size" integer,
	"page_count" integer,
	"language" varchar(10),
	"status" varchar(50) DEFAULT 'pending',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_processing_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"job_type" varchar(100),
	"status" varchar(50) DEFAULT 'pending',
	"priority" integer DEFAULT 5,
	"result" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scoped_feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"flag_key" varchar(200) NOT NULL,
	"scope" varchar(50) DEFAULT 'global',
	"scope_id" varchar(100) DEFAULT '_global',
	"is_enabled" boolean DEFAULT false,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_filing_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"case_number" varchar(200),
	"court_code" varchar(50),
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"filing_type" varchar(100) NOT NULL,
	"status" "filing_status" DEFAULT 'DRAFT' NOT NULL,
	"document_ids" integer[] DEFAULT '{}',
	"filed_at" timestamp,
	"acknowledged_at" timestamp,
	"cnr_number" varchar(50),
	"stamp_duty_paid" boolean DEFAULT false,
	"stamp_duty_amount_paise" integer DEFAULT 0,
	"rejection_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_grpo_policy_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"average_reward" real,
	"group_size" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_grpo_runs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"pattern_key" varchar(20) NOT NULL,
	"route" varchar(255),
	"agent_id" varchar(60),
	"jurisdiction" varchar(10),
	"task_hash" varchar(64),
	"response_snippet" text,
	"reward" real,
	"policy_updated" boolean DEFAULT false,
	"total_episodes" integer DEFAULT 0,
	"avg_reward" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_hallucination_detections" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"trace_id" varchar(36),
	"pattern" varchar(20),
	"agent_id" varchar(60),
	"input_snippet" text,
	"output_snippet" text,
	"score" real NOT NULL,
	"flagged" boolean DEFAULT false,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"grounding_score" real DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_hearing_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_update_id" integer,
	"case_number" varchar(200) NOT NULL,
	"court_name" varchar(300),
	"hearing_date" timestamp NOT NULL,
	"hearing_type" varchar(100),
	"judges" text[] DEFAULT '{}',
	"advocates" text[] DEFAULT '{}',
	"hearing_notes" text,
	"order_passed" boolean DEFAULT false,
	"order_summary" text,
	"next_date" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hitl_workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer,
	"triggered_by" varchar(100),
	"trigger_type" varchar(100),
	"trigger_context" jsonb DEFAULT '{}'::jsonb,
	"agent_confidence" real,
	"status" varchar(50) DEFAULT 'pending',
	"current_step_id" varchar(100),
	"approvals" jsonb DEFAULT '[]'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hitl_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"owner_id" varchar(100),
	"workflow_type" varchar(100),
	"steps" jsonb DEFAULT '[]'::jsonb,
	"trigger_conditions" jsonb DEFAULT '[]'::jsonb,
	"required_approvers" jsonb DEFAULT '[]'::jsonb,
	"escalation_timeout_minutes" integer DEFAULT 60,
	"auto_approve_threshold" real,
	"require_review_threshold" real,
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_identity_extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"organization_id" integer,
	"document_id" integer,
	"document_type" varchar(100),
	"extracted_fields" jsonb DEFAULT '{}'::jsonb,
	"confidence" real DEFAULT 0.8,
	"status" varchar(50) DEFAULT 'extracted',
	"agent_id" varchar(100),
	"orchestration_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_institutional_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_name" varchar(300) NOT NULL,
	"contact_name" varchar(200),
	"contact_email" varchar(300),
	"contact_phone" varchar(20),
	"org_type" varchar(50),
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"user_count" integer,
	"use_cases" text[] DEFAULT '{}',
	"stage" varchar(50) DEFAULT 'INQUIRY',
	"assigned_to" varchar(100),
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"org_id" varchar(100),
	"invoice_number" varchar(100) NOT NULL,
	"subscription_id" integer,
	"amount_in_paise" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'INR',
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"line_items" jsonb DEFAULT '[]'::jsonb,
	"tax_breakdown" jsonb DEFAULT '{}'::jsonb,
	"pdf_url" text,
	"gst_number" varchar(20),
	"billing_address" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "legal_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" varchar(50) DEFAULT '2.0.0',
	"tier" varchar(50) DEFAULT 'solo',
	"roma_level" varchar(10) DEFAULT 'L2',
	"category" varchar(100) NOT NULL,
	"practice_area" varchar(100),
	"description" text,
	"system_prompt" text DEFAULT '',
	"capabilities" text[] DEFAULT '{}',
	"tools" text[] DEFAULT '{}',
	"protocols" text[] DEFAULT '{}',
	"preferred_models" text[] DEFAULT '{}',
	"fallback_models" text[] DEFAULT '{}',
	"operation_modes" jsonb DEFAULT '{}'::jsonb,
	"security_level" varchar(50) DEFAULT 'standard',
	"reports_to" text[] DEFAULT '{}',
	"manages" text[] DEFAULT '{}',
	"collaborates_with" text[] DEFAULT '{}',
	"supported_languages" text[] DEFAULT '{}',
	"guardrails" jsonb DEFAULT '{}'::jsonb,
	"cost_optimization" jsonb DEFAULT '{}'::jsonb,
	"jurisdictions" text[] DEFAULT '{}',
	"indian_law_support" jsonb DEFAULT '{}'::jsonb,
	"saudi_law_support" jsonb DEFAULT '{}'::jsonb,
	"singapore_law_support" jsonb DEFAULT '{}'::jsonb,
	"uae_law_support" jsonb DEFAULT '{}'::jsonb,
	"usa_law_support" jsonb DEFAULT '{}'::jsonb,
	"europe_law_support" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(50) DEFAULT 'active',
	"is_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "legal_agents_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "nyayavigya_context_learning_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100),
	"session_id" varchar(100),
	"context_data" jsonb DEFAULT '{}'::jsonb,
	"outcome" varchar(100),
	"feedback" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nyayavigya_founder_context_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100),
	"profile_data" jsonb DEFAULT '{}'::jsonb,
	"context_version" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nyayavigya_orchestration_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(100),
	"status" varchar(50) DEFAULT 'pending',
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"agent_id" varchar(100),
	"user_id" integer,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_openbot_agents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"agent_type" varchar(40) DEFAULT 'research',
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"mcp_tools" jsonb DEFAULT '[]'::jsonb,
	"pattern" varchar(20) DEFAULT 'react',
	"system_prompt" text,
	"status" varchar(20) DEFAULT 'draft',
	"deployed_url" varchar(255),
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_openbot_tasks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"agent_id" varchar(36) NOT NULL,
	"prompt" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"result" jsonb,
	"tokens_used" integer DEFAULT 0,
	"latency_ms" integer DEFAULT 0,
	"error_msg" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "nv_pattern_audit_log" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"trace_id" varchar(36) NOT NULL,
	"pattern" varchar(20) NOT NULL,
	"agent_id" varchar(60),
	"org_id" varchar(36),
	"jurisdiction" varchar(10),
	"input_hash" varchar(64) NOT NULL,
	"output_hash" varchar(64),
	"chain_hash" varchar(64),
	"risk_score" real DEFAULT 0,
	"risk_badge" varchar(10) DEFAULT 'GREEN',
	"blocked" boolean DEFAULT false,
	"tokens_used" integer DEFAULT 0,
	"latency_ms" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"invoice_id" integer,
	"amount_in_paise" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'INR',
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"gateway" varchar(50) DEFAULT 'razorpay',
	"gateway_payment_id" varchar(200),
	"gateway_order_id" varchar(200),
	"gateway_signature" varchar(500),
	"failure_reason" text,
	"refund_id" varchar(200),
	"refunded_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pii_vault" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36),
	"user_id" varchar(36),
	"category" varchar(60) NOT NULL,
	"encrypted_data" text NOT NULL,
	"data_hash" varchar(64),
	"ttl_seconds" integer DEFAULT 1800,
	"expires_at" timestamp NOT NULL,
	"purpose" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "rag_namespaces" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"embedding_model" varchar(100) DEFAULT 'text-embedding-3-small',
	"dimensions" integer DEFAULT 1536,
	"document_count" integer DEFAULT 0,
	"vector_count" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_api_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"api_key_id" integer,
	"endpoint" varchar(500),
	"method" varchar(10),
	"status_code" integer,
	"latency_ms" integer,
	"tokens_in" integer DEFAULT 0,
	"tokens_out" integer DEFAULT 0,
	"agent_id" varchar(100),
	"request_id" varchar(36),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_app_agent_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"agent_id" varchar(100) NOT NULL,
	"agent_name" varchar(255),
	"practice_area" varchar(100),
	"priority" integer DEFAULT 5,
	"daily_token_limit" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_app_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"name" varchar(255),
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sdk_app_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "sdk_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"app_name" varchar(255) NOT NULL,
	"app_type" varchar(100) NOT NULL,
	"description" text,
	"client_id" varchar(100) NOT NULL,
	"client_secret_hash" varchar(255) NOT NULL,
	"client_secret_prefix" varchar(20),
	"allowed_agents" jsonb DEFAULT '[]'::jsonb,
	"llm_config" jsonb DEFAULT '{}'::jsonb,
	"rate_limit_per_minute" integer DEFAULT 60,
	"daily_token_budget" integer DEFAULT 100000,
	"monthly_token_budget" integer DEFAULT 1000000,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb,
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(50) DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdk_applications_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "sdk_clause_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"clause_id" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(100),
	"description" text,
	"default_text" text,
	"jurisdiction_variants" jsonb DEFAULT '{}'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"risk" varchar(50),
	"popularity" integer DEFAULT 0,
	"version" varchar(20) DEFAULT '1.0',
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdk_clause_library_clause_id_unique" UNIQUE("clause_id")
);
--> statement-breakpoint
CREATE TABLE "sdk_compliance_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_id" varchar(100) NOT NULL,
	"framework" varchar(100),
	"jurisdiction" varchar(50),
	"title" varchar(255) NOT NULL,
	"category" varchar(100),
	"severity" varchar(50),
	"requirements" jsonb DEFAULT '[]'::jsonb,
	"automation_level" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdk_compliance_controls_control_id_unique" UNIQUE("control_id")
);
--> statement-breakpoint
CREATE TABLE "sdk_document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(100),
	"jurisdiction" varchar(50),
	"languages" jsonb DEFAULT '[]'::jsonb,
	"version" varchar(20) DEFAULT '1.0',
	"is_system" boolean DEFAULT false,
	"content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sdk_document_templates_template_id_unique" UNIQUE("template_id")
);
--> statement-breakpoint
CREATE TABLE "sdk_usage_metering" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"agent_id" varchar(100),
	"tokens_in" integer DEFAULT 0,
	"tokens_out" integer DEFAULT 0,
	"cost_usd" real DEFAULT 0,
	"period" varchar(20),
	"request_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer,
	"application_id" integer,
	"status" varchar(50) DEFAULT 'pending',
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"name" varchar(255) NOT NULL,
	"workflow_type" varchar(100),
	"definition" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_skillshop_listings" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"author_id" varchar(36) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(60) DEFAULT 'legal-research',
	"jurisdiction" varchar(10) DEFAULT 'ALL',
	"pattern" varchar(20),
	"skill_code" text,
	"price_paise" integer DEFAULT 0,
	"currency" varchar(5) DEFAULT 'INR',
	"downloads" integer DEFAULT 0,
	"rating" real DEFAULT 0,
	"status" varchar(20) DEFAULT 'draft',
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_subscription_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"previous_plan" "subscription_plan",
	"new_plan" "subscription_plan",
	"previous_status" "subscription_status",
	"new_status" "subscription_status",
	"triggered_by" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"org_id" varchar(100),
	"plan" "subscription_plan" DEFAULT 'SOLO' NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIAL' NOT NULL,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"razorpay_subscription_id" varchar(200),
	"razorpay_customer_id" varchar(200),
	"monthly_token_limit" integer DEFAULT 50000,
	"tokens_used_this_period" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "template_library" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36),
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"category" varchar(60) NOT NULL,
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"language" varchar(10) DEFAULT 'en',
	"template_body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"version" varchar(20) DEFAULT '1.0.0',
	"is_public" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_twindesk_agents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"org_id" varchar(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" varchar(60) DEFAULT 'advocate',
	"jurisdiction" varchar(10) DEFAULT 'IN',
	"practice_areas" jsonb DEFAULT '[]'::jsonb,
	"persona" jsonb DEFAULT '{}'::jsonb,
	"knowledge_base" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(20) DEFAULT 'draft',
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_twindesk_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"agent_id" varchar(36) NOT NULL,
	"user_id" varchar(36),
	"mode" varchar(30) DEFAULT 'collaborative',
	"transcript" jsonb DEFAULT '[]'::jsonb,
	"insights" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(20) DEFAULT 'active',
	"started_at" timestamp DEFAULT now(),
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wai_email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100),
	"organization_id" integer,
	"provider" varchar(50),
	"email" varchar(255),
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"imap_host" varchar(255),
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wai_email_automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"name" varchar(255),
	"conditions" jsonb DEFAULT '[]'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wai_email_processing" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer,
	"processing_type" varchar(100),
	"status" varchar(50) DEFAULT 'pending',
	"result" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wai_email_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer,
	"response_text" text,
	"agent_id" varchar(100),
	"status" varchar(50) DEFAULT 'draft',
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wai_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"message_id" varchar(255),
	"subject" text,
	"from_address" varchar(255),
	"to_addresses" jsonb DEFAULT '[]'::jsonb,
	"body" text,
	"is_read" boolean DEFAULT false,
	"is_processed" boolean DEFAULT false,
	"received_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jurexio-citizen_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"case_type" varchar(100),
	"title" varchar(500),
	"description" text,
	"status" varchar(50) DEFAULT 'open',
	"jurisdiction" varchar(50) DEFAULT 'IN',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jurexio-citizen_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"full_name" varchar(255),
	"phone" varchar(50),
	"preferred_language" varchar(10) DEFAULT 'en',
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "jurexio-citizen_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "institutional_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"case_title" varchar(500),
	"case_type" varchar(100),
	"status" varchar(50) DEFAULT 'active',
	"priority" varchar(50) DEFAULT 'normal',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "institutional_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"org_type" varchar(100),
	"jurisdiction" varchar(50),
	"is_active" boolean DEFAULT true,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ministerial_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer,
	"order_number" varchar(100),
	"title" varchar(500),
	"content" text,
	"status" varchar(50) DEFAULT 'draft',
	"issued_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ministry_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"jurisdiction" varchar(50) DEFAULT 'IN',
	"is_active" boolean DEFAULT true,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "ministry_departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "academy_courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"category" varchar(100),
	"level" varchar(50) DEFAULT 'beginner',
	"language" varchar(10) DEFAULT 'en',
	"duration" integer,
	"is_published" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"course_id" integer,
	"status" varchar(50) DEFAULT 'enrolled',
	"progress" real DEFAULT 0,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
