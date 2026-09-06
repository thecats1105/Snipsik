import { describe, expect, it, beforeEach } from "bun:test";
import {
  guildConfigService,
  DEFAULT_GUILD_CONFIG,
} from "@/services/guildConfigService";
import { userConfigService } from "@/services/userConfigService";
import { config } from "@/config";

describe("GuildConfigService Unit Tests", () => {
  const testGuildId = "test-guild-123456";
  const testUserId = "test-user-654321";

  beforeEach(() => {
    // Reset internal caches
    // @ts-expect-error accessing private cache for test setup
    guildConfigService.cache.clear();
    // @ts-expect-error accessing private cache for test setup
    userConfigService.cache.clear();
  });

  describe("getGuildConfig", () => {
    it("returns default guild config when guild is not cached", () => {
      const result = guildConfigService.getGuildConfig("unconfigured-guild");
      expect(result.guildId).toBe("unconfigured-guild");
      expect(result.autoShortenEnabled).toBe(
        DEFAULT_GUILD_CONFIG.autoShortenEnabled,
      );
      expect(result.autoShortenMinUrlLength).toBe(
        DEFAULT_GUILD_CONFIG.autoShortenMinUrlLength,
      );
      expect(result.autoShortenMinUrlLength).toBeNull();
    });

    it("returns cached guild config when present", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 50,
      });

      const result = guildConfigService.getGuildConfig(testGuildId);
      expect(result.guildId).toBe(testGuildId);
      expect(result.autoShortenMinUrlLength).toBe(50);
    });
  });

  describe("resolveEffectiveMinUrlLength (3-Tier Hierarchy)", () => {
    it("falls back to global ENV default (70) when neither user nor guild has override", () => {
      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(config.AUTO_SHORTEN_MIN_URL_LENGTH);
      expect(effective).toBe(70);
    });

    it("applies guild override when user has no override", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 45,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(45);
    });

    it("applies user override over guild override and global ENV", () => {
      // Guild override: 45
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 45,
      });

      // User override: 30
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 30,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(30);
    });

    it("respects user override of 0 (shorten all URLs) even if guild has higher threshold", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 100,
      });

      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 0,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(0);
    });

    it("respects guild override of 0 (shorten all URLs in guild) when user is inherit (null)", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 0,
      });

      // User has config record, but autoShortenMinUrlLength is null (inherit)
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: null,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(0);
    });

    it("handles null/undefined guildId gracefully and checks user then ENV", () => {
      // User override: 80
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 80,
      });

      expect(
        guildConfigService.resolveEffectiveMinUrlLength(undefined, testUserId),
      ).toBe(80);
      expect(
        guildConfigService.resolveEffectiveMinUrlLength(null, testUserId),
      ).toBe(80);

      // Without user override -> ENV (70)
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.clear();
      expect(
        guildConfigService.resolveEffectiveMinUrlLength(undefined, testUserId),
      ).toBe(70);
    });
  });
});
