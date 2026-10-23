CREATE TABLE "nv_jurisdictional_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"domain" text NOT NULL,
	"insight_key" text NOT NULL,
	"insight_value" text NOT NULL,
	"confidence" real DEFAULT 0.5,
	"source" text,
	"user_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nv_precedent_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"citation" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"court" text,
	"year" integer,
	"principle_of_law" text NOT NULL,
	"headnote" text,
	"status" text DEFAULT 'active' NOT NULL,
	"overruled_by" text,
	"distinguished_in" jsonb DEFAULT '[]'::jsonb,
	"applied_in" jsonb DEFAULT '[]'::jsonb,
	"relevance_score" real DEFAULT 0.5,
	"embedding_vector" text,
	"user_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "nv_jurisdictional_memory_jd_idx" ON "nv_jurisdictional_memory" USING btree ("jurisdiction","domain");--> statement-breakpoint
CREATE INDEX "nv_jurisdictional_memory_key_idx" ON "nv_jurisdictional_memory" USING btree ("insight_key");--> statement-breakpoint
CREATE INDEX "nv_jurisdictional_memory_updated_idx" ON "nv_jurisdictional_memory" USING btree ("last_updated");--> statement-breakpoint
CREATE INDEX "nv_precedent_memory_case_id_idx" ON "nv_precedent_memory" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "nv_precedent_memory_citation_idx" ON "nv_precedent_memory" USING btree ("citation");--> statement-breakpoint
CREATE INDEX "nv_precedent_memory_jurisdiction_idx" ON "nv_precedent_memory" USING btree ("jurisdiction");--> statement-breakpoint
CREATE INDEX "nv_precedent_memory_status_idx" ON "nv_precedent_memory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nv_precedent_memory_year_idx" ON "nv_precedent_memory" USING btree ("year");