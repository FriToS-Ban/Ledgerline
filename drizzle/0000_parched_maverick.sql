CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payload" text NOT NULL,
	CONSTRAINT "allocations_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"payload" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_events_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"first_at" bigint NOT NULL,
	"locked_until" bigint
);
--> statement-breakpoint
CREATE TABLE "decision_corrections" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"situation" text NOT NULL,
	"original" text NOT NULL,
	"human" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_corrections_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"recommendation" text NOT NULL,
	"final" text,
	"confidence" double precision NOT NULL,
	"explanation" text NOT NULL,
	"needs_human" boolean NOT NULL,
	"trace" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"sender" text,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"attachments" integer DEFAULT 0 NOT NULL,
	"invoice_ids" text DEFAULT '[]' NOT NULL,
	"source" text DEFAULT 'webhook' NOT NULL,
	"note" text,
	CONSTRAINT "email_messages_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"org_id" uuid NOT NULL,
	"invoice_id" text NOT NULL,
	"scenario" text NOT NULL,
	"expected" text NOT NULL,
	"truth" text NOT NULL,
	"batch" text NOT NULL,
	CONSTRAINT "eval_cases_org_id_invoice_id_pk" PRIMARY KEY("org_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" double precision NOT NULL,
	"as_of" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	CONSTRAINT "fx_rates_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" double precision NOT NULL,
	"po_number" text,
	CONSTRAINT "invoice_lines_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"demo_id" text,
	"vendor_id" text,
	"invoice_number" text,
	"invoice_date" text,
	"currency" text,
	"total" double precision,
	"pdf_path" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_id" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"sender" text,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jobs_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "master_imports" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source" text NOT NULL,
	"signature" text,
	"vendors" integer DEFAULT 0 NOT NULL,
	"pos" integer DEFAULT 0 NOT NULL,
	"po_lines" integer DEFAULT 0 NOT NULL,
	"errors" text DEFAULT '[]' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "master_imports_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"po_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "matches_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"po_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" double precision NOT NULL,
	CONSTRAINT "po_lines_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "policy_rules_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"number" text NOT NULL,
	"vendor_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"issue_date" text NOT NULL,
	"description" text NOT NULL,
	"goods_received" boolean DEFAULT true NOT NULL,
	CONSTRAINT "purchase_orders_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"password_hash" text,
	"role" text DEFAULT 'clerk' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_changed_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_terms" text DEFAULT 'Net 30' NOT NULL,
	CONSTRAINT "vendors_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_email_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "decision_corrections" ADD CONSTRAINT "decision_corrections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_imports" ADD CONSTRAINT "master_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "allocations_org_id" ON "allocations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id" ON "audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_email" ON "auth_sessions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_throttle_first_at" ON "auth_throttle" USING btree ("first_at");--> statement-breakpoint
CREATE INDEX "decision_corrections_org_id" ON "decision_corrections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "decisions_org_id" ON "decisions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "email_messages_org_id" ON "email_messages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_org_message" ON "email_messages" USING btree ("org_id","message_id");--> statement-breakpoint
CREATE INDEX "eval_cases_org_id" ON "eval_cases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "fx_rates_org_id" ON "fx_rates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invites_org_id" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invites_email" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_id" ON "invoice_lines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "jobs_org_id" ON "jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "master_imports_org_id" ON "master_imports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "matches_org_id" ON "matches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "po_lines_org_id" ON "po_lines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "policy_rules_org_id" ON "policy_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_id" ON "purchase_orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendors_org_id" ON "vendors" USING btree ("org_id");