CREATE TABLE "guild_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"auto_shorten_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"auto_dm_mode" text DEFAULT 'inherit' NOT NULL,
	"dm_format" text DEFAULT 'replace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
