CREATE TABLE IF NOT EXISTS "user_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"auto_dm_mode" text DEFAULT 'inherit' NOT NULL,
	"dm_format" text DEFAULT 'replace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
