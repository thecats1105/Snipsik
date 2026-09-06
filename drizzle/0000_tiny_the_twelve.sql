CREATE TABLE IF NOT EXISTS "guild_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"auto_shorten_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_configs" ADD COLUMN IF NOT EXISTS "auto_shorten_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_configs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"auto_dm_mode" text DEFAULT 'inherit' NOT NULL,
	"dm_format" text DEFAULT 'replace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "auto_dm_mode" text DEFAULT 'inherit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "dm_format" text DEFAULT 'replace' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_configs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_channels" ADD COLUMN IF NOT EXISTS "guild_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "watch_channels" ADD COLUMN IF NOT EXISTS "channel_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "watch_channels" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "watch_channels" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
