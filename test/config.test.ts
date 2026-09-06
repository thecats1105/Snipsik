import { describe, expect, it } from "bun:test";
import { envSchema } from "@/config";

describe("Config Schema AUTO_SHORTEN_MIN_URL_LENGTH parsing", () => {
  const baseEnv = {
    DISCORD_TOKEN: "mock-token",
    DISCORD_CLIENT_ID: "1234567890",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    SINK_BASE_URL: "https://s.japsik.com",
    SINK_API_TOKEN: "mock-sink-token",
  };

  it("defaults to 70 when AUTO_SHORTEN_MIN_URL_LENGTH is undefined", () => {
    const parsed = envSchema.parse({ ...baseEnv });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(70);
  });

  it("rejects non-numeric characters and falls back to 70 for partially numeric input", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "10invalid",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(70);
  });

  it("falls back to 70 for negative numbers or invalid strings", () => {
    expect(
      envSchema.parse({ ...baseEnv, AUTO_SHORTEN_MIN_URL_LENGTH: "-5" })
        .AUTO_SHORTEN_MIN_URL_LENGTH,
    ).toBe(70);
    expect(
      envSchema.parse({ ...baseEnv, AUTO_SHORTEN_MIN_URL_LENGTH: "abc" })
        .AUTO_SHORTEN_MIN_URL_LENGTH,
    ).toBe(70);
  });

  it("parses 0 as valid without threshold restriction", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "0",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(0);
  });

  it("parses valid positive integer within 0..2048", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: " 120 ",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(120);
  });

  it("caps maximum value at 2048", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "5000",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(2048);
  });
});
