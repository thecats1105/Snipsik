import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  SINK_BASE_URL: z
    .string()
    .url("SINK_BASE_URL must be a valid URL")
    .transform((url) => url.replace(/\/+$/, "")),
  SINK_API_TOKEN: z.string().min(1, "SINK_API_TOKEN is required"),
  RANDOM_SLUG_LENGTH: z
    .string()
    .optional()
    .default("3")
    .transform((val) => {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) || parsed < 2 ? 3 : parsed;
    }),
  ADMIN_USER_IDS: z
    .string()
    .optional()
    .default("")
    .transform((val) =>
      val
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  AUTO_SHORTEN_MIN_URL_LENGTH: z
    .string()
    .optional()
    .default("70")
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 0) return 70;
      return Math.min(parsed, 2048);
    }),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config;

try {
  parsedConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorDetails = error.errors
      .map((err) => `  - ${err.path.join(".")}: ${err.message}`)
      .join("\n");
    console.error(
      `\x1b[31m❌ Environment Configuration Error:\x1b[0m\n${errorDetails}`,
    );
    process.exit(1);
  }
  throw error;
}

export const config = parsedConfig;
