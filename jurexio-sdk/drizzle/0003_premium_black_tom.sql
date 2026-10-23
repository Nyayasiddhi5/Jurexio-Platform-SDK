CREATE TABLE "nv_auth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"token_hash" varchar(255) NOT NULL,
	"token_type" varchar(50) DEFAULT 'access' NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nv_auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "nv_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"tier" varchar(50) DEFAULT 'pro' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nv_organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "nv_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nv_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"full_name" varchar(255),
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"tier" varchar(50) DEFAULT 'solo' NOT NULL,
	"org_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nv_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "nv_voice_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(36) NOT NULL,
	"user_id" integer,
	"language" varchar(20) DEFAULT 'en-IN',
	"provider" varchar(50),
	"duration_ms" integer,
	"transcript_text" text,
	"word_count" integer,
	"confidence" real,
	"status" varchar(50) DEFAULT 'active',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "nv_voice_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE INDEX "nv_auth_tokens_user_id_idx" ON "nv_auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nv_auth_tokens_token_type_idx" ON "nv_auth_tokens" USING btree ("token_type");--> statement-breakpoint
CREATE UNIQUE INDEX "nv_organizations_slug_idx" ON "nv_organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "nv_organizations_tier_idx" ON "nv_organizations" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "nv_sessions_user_id_idx" ON "nv_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nv_sessions_expires_at_idx" ON "nv_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nv_users_email_idx" ON "nv_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "nv_users_role_idx" ON "nv_users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "nv_users_org_id_idx" ON "nv_users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "nv_voice_sessions_user_id_idx" ON "nv_voice_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nv_voice_sessions_status_idx" ON "nv_voice_sessions" USING btree ("status");