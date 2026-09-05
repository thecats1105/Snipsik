import { describe, expect, it } from "bun:test";
import { envSchema, normalizeEnv, stripQuotes } from "../src/config";

describe("stripQuotes", () => {
  it("removes outer double quotes", () => {
    expect(stripQuotes('"my-secret-token"')).toBe("my-secret-token");
  });

  it("removes outer single quotes", () => {
    expect(stripQuotes("'my-secret-token'")).toBe("my-secret-token");
  });

  it("preserves quotes inside the string", () => {
    expect(stripQuotes('"my-"internal"-token"')).toBe('my-"internal"-token');
  });

  it("handles complex tokens with special characters", () => {
    expect(stripQuotes('"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz$#@!"')).toBe(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz$#@!",
    );
  });

  it("trims surrounding whitespace before stripping quotes", () => {
    expect(stripQuotes('  "token_with_spaces"  ')).toBe("token_with_spaces");
  });

  it("leaves unquoted strings intact", () => {
    expect(stripQuotes("plain-token")).toBe("plain-token");
  });

  it("handles empty or short strings safely", () => {
    expect(stripQuotes("")).toBe("");
    expect(stripQuotes('""')).toBe("");
    expect(stripQuotes("''")).toBe("");
    expect(stripQuotes('"')).toBe('"');
  });
});

describe("normalizeEnv & envSchema", () => {
  it("normalizes and parses quoted environment variables correctly", () => {
    const rawEnv = {
      DISCORD_TOKEN: '"discord-bot-token"',
      DISCORD_CLIENT_ID: "'123456789'",
      DATABASE_URL: '"postgresql://user:pass@localhost:5432/db"',
      SINK_BASE_URL: '"https://s.japsik.com/"',
      SINK_API_TOKEN: '"super-secret-token!@#$%"',
      NODE_ENV: "test",
    };

    const parsed = envSchema.parse(normalizeEnv(rawEnv));

    expect(parsed.DISCORD_TOKEN).toBe("discord-bot-token");
    expect(parsed.DISCORD_CLIENT_ID).toBe("123456789");
    expect(parsed.DATABASE_URL).toBe(
      "postgresql://user:pass@localhost:5432/db",
    );
    expect(parsed.SINK_BASE_URL).toBe("https://s.japsik.com");
    expect(parsed.SINK_API_TOKEN).toBe("super-secret-token!@#$%");
  });
});
