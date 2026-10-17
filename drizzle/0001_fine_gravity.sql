CREATE TABLE "nv_audit_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"trace_id" varchar(36) NOT NULL,
	"app_id" varchar(50),
	"org_id" varchar(36),
	"user_id" varchar(100),
	"route" varchar(300) NOT NULL,
	"method" varchar(10) NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"tokens_used" integer,
	"error_message" text,
	"event_type" varchar(60),
	"record_hash" varchar(64),
	"previous_hash" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_jurisdiction_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"jurisdiction_code" varchar(10) NOT NULL,
	"org_id" varchar(36),
	"name" varchar(100) NOT NULL,
	"currency" varchar(3) DEFAULT 'INR',
	"courts" jsonb DEFAULT '[]'::jsonb,
	"statutes" jsonb DEFAULT '[]'::jsonb,
	"regulatory_bodies" jsonb DEFAULT '[]'::jsonb,
	"languages" jsonb DEFAULT '[]'::jsonb,
	"prohibited_phrases" jsonb DEFAULT '[]'::jsonb,
	"mandatory_disclosures" jsonb DEFAULT '[]'::jsonb,
	"ai_format_rules" jsonb DEFAULT '{}'::jsonb,
	"compliance_frameworks" jsonb DEFAULT '[]'::jsonb,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_amendment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"affected_statutes" jsonb DEFAULT '[]'::jsonb,
	"severity" text DEFAULT 'minor' NOT NULL,
	"source_url" text,
	"source_ref" text,
	"published_at" timestamp,
	"effective_at" timestamp,
	"processed_at" timestamp,
	"impact_score" real,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_client_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer,
	"attribute" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real,
	"evidence_matter_ids" jsonb DEFAULT '[]'::jsonb,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_forensic_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text,
	"document_hash" text NOT NULL,
	"ai_generated_score" real,
	"forgery_score" real,
	"metadata_consistency_score" real,
	"font_consistency_score" real,
	"signature_valid" boolean,
	"seal_authentic" boolean,
	"chain_of_custody_valid" boolean,
	"overall_authenticity_score" real,
	"verdict" text DEFAULT 'pending',
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_legal_oracle_qa" (
	"id" serial PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"domain" text NOT NULL,
	"question" text NOT NULL,
	"expected_answer" text NOT NULL,
	"cited_statutes" jsonb DEFAULT '[]'::jsonb,
	"difficulty" text DEFAULT 'medium',
	"curated_by" text,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_legal_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"jurisdictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_text" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb,
	"enforceability_score" real,
	"version" text DEFAULT '1.0' NOT NULL,
	"is_active" boolean DEFAULT true,
	"reviewed_by" text,
	"last_reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "nv_legal_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "nv_llm_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"judge_model" text NOT NULL,
	"legal_accuracy_score" real,
	"citation_quality_score" real,
	"jurisdiction_correctness_score" real,
	"bias_absence_score" real,
	"actionability_score" real,
	"weighted_total_score" real,
	"judge_reasoning" text,
	"flagged_issues" jsonb DEFAULT '[]'::jsonb,
	"passed_threshold" boolean,
	"evaluated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_matter_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"matter_id" text NOT NULL,
	"user_id" integer,
	"org_id" integer,
	"memory_type" text NOT NULL,
	"content" text NOT NULL,
	"tokens" integer,
	"importance" real,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_regulatory_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"feed_type" text NOT NULL,
	"feed_url" text NOT NULL,
	"last_fetched_at" timestamp,
	"last_change_detected_at" timestamp,
	"fetch_interval_minutes" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true,
	"parser_type" text,
	"auth_config" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_statute_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"statute_id" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"section_number" text NOT NULL,
	"section_title" text NOT NULL,
	"section_text" text NOT NULL,
	"amendment_reference" text,
	"valid_from" timestamp NOT NULL,
	"valid_to" timestamp,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"superseded_by" integer,
	"source_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_template_clauses" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer,
	"clause_name" text NOT NULL,
	"clause_text" text NOT NULL,
	"clause_type" text DEFAULT 'optional' NOT NULL,
	"risk_level" integer DEFAULT 1 NOT NULL,
	"risk_explanation" text,
	"jurisdictions" jsonb DEFAULT '[]'::jsonb,
	"alternatives" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "nv_ai_activity" ADD COLUMN "prompt_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "nv_ai_activity" ADD COLUMN "risk_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "nv_ai_activity" ADD COLUMN "jurisdiction_validated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "nv_ai_activity" ADD COLUMN "template_mode" varchar(10);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "role_snapshot" varchar(100);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "is_billable" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "billable_minutes" integer;--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "linked_invoice_id" integer;--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "stage_before" varchar(50);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "stage_after" varchar(50);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "is_client_visible" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "confidential_level" varchar(30) DEFAULT 'TEAM_VISIBLE';--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "ip_address" varchar(50);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "device_info" varchar(300);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "hash_signature" varchar(64);--> statement-breakpoint
ALTER TABLE "nv_case_updates" ADD COLUMN "record_status" varchar(20) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "nv_template_clauses" ADD CONSTRAINT "nv_template_clauses_template_id_nv_legal_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."nv_legal_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nv_amendment_events_jurisdiction_effective_idx" ON "nv_amendment_events" USING btree ("jurisdiction","effective_at");--> statement-breakpoint
CREATE INDEX "nv_amendment_events_severity_idx" ON "nv_amendment_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "nv_amendment_events_published_at_idx" ON "nv_amendment_events" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "nv_client_memory_client_attribute_idx" ON "nv_client_memory" USING btree ("client_id","attribute");--> statement-breakpoint
CREATE INDEX "nv_client_memory_user_id_idx" ON "nv_client_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nv_client_memory_last_updated_idx" ON "nv_client_memory" USING btree ("last_updated");--> statement-breakpoint
CREATE INDEX "nv_forensic_verifications_document_hash_idx" ON "nv_forensic_verifications" USING btree ("document_hash");--> statement-breakpoint
CREATE INDEX "nv_forensic_verifications_verdict_idx" ON "nv_forensic_verifications" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "nv_forensic_verifications_verified_at_idx" ON "nv_forensic_verifications" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "nv_legal_oracle_qa_jurisdiction_domain_idx" ON "nv_legal_oracle_qa" USING btree ("jurisdiction","domain");--> statement-breakpoint
CREATE INDEX "nv_legal_oracle_qa_created_at_idx" ON "nv_legal_oracle_qa" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "nv_legal_templates_category_idx" ON "nv_legal_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "nv_legal_templates_enforceability_idx" ON "nv_legal_templates" USING btree ("enforceability_score");--> statement-breakpoint
CREATE INDEX "nv_llm_evaluations_target_type_id_idx" ON "nv_llm_evaluations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "nv_llm_evaluations_passed_threshold_idx" ON "nv_llm_evaluations" USING btree ("passed_threshold");--> statement-breakpoint
CREATE INDEX "nv_llm_evaluations_weighted_score_idx" ON "nv_llm_evaluations" USING btree ("weighted_total_score");--> statement-breakpoint
CREATE INDEX "nv_llm_evaluations_evaluated_at_idx" ON "nv_llm_evaluations" USING btree ("evaluated_at");--> statement-breakpoint
CREATE INDEX "nv_matter_memory_matter_type_idx" ON "nv_matter_memory" USING btree ("matter_id","memory_type");--> statement-breakpoint
CREATE INDEX "nv_matter_memory_user_id_idx" ON "nv_matter_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nv_matter_memory_created_at_idx" ON "nv_matter_memory" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "nv_matter_memory_importance_idx" ON "nv_matter_memory" USING btree ("importance");--> statement-breakpoint
CREATE INDEX "nv_regulatory_feeds_jurisdiction_idx" ON "nv_regulatory_feeds" USING btree ("jurisdiction");--> statement-breakpoint
CREATE INDEX "nv_regulatory_feeds_feed_type_idx" ON "nv_regulatory_feeds" USING btree ("feed_type");--> statement-breakpoint
CREATE INDEX "nv_regulatory_feeds_is_active_idx" ON "nv_regulatory_feeds" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "nv_regulatory_feeds_last_fetched_at_idx" ON "nv_regulatory_feeds" USING btree ("last_fetched_at");--> statement-breakpoint
CREATE INDEX "nv_statute_versions_statute_valid_idx" ON "nv_statute_versions" USING btree ("statute_id","valid_from");--> statement-breakpoint
CREATE INDEX "nv_statute_versions_jurisdiction_section_idx" ON "nv_statute_versions" USING btree ("jurisdiction","section_number");--> statement-breakpoint
CREATE INDEX "nv_statute_versions_valid_from_idx" ON "nv_statute_versions" USING btree ("valid_from");--> statement-breakpoint
CREATE INDEX "nv_statute_versions_valid_to_idx" ON "nv_statute_versions" USING btree ("valid_to");--> statement-breakpoint
CREATE INDEX "nv_template_clauses_template_id_idx" ON "nv_template_clauses" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "nv_template_clauses_clause_type_idx" ON "nv_template_clauses" USING btree ("clause_type");--> statement-breakpoint
CREATE INDEX "nv_template_clauses_risk_level_idx" ON "nv_template_clauses" USING btree ("risk_level");