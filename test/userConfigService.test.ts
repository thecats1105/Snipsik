import { describe, expect, it } from "bun:test";
import {
  normalizeAutoDmMode,
  normalizeDmFormat,
  normalizeMinUrlLength,
  userConfigService,
  DEFAULT_USER_CONFIG,
} from "@/services/userConfigService";

describe("UserConfigService Unit Tests", () => {
  describe("Normalization Helpers", () => {
    it("should normalize auto DM mode properly", () => {
      expect(normalizeAutoDmMode("inherit")).toBe("inherit");
      expect(normalizeAutoDmMode("DEFAULT")).toBe("inherit");
      expect(normalizeAutoDmMode("on")).toBe("on");
      expect(normalizeAutoDmMode("TRUE")).toBe("on");
      expect(normalizeAutoDmMode("enable")).toBe("on");
      expect(normalizeAutoDmMode("enabled")).toBe("on");
      expect(normalizeAutoDmMode("off")).toBe("off");
      expect(normalizeAutoDmMode("FALSE")).toBe("off");
      expect(normalizeAutoDmMode("disable")).toBe("off");
      expect(normalizeAutoDmMode("disabled")).toBe("off");

      expect(normalizeAutoDmMode("invalid")).toBeNull();
      expect(normalizeAutoDmMode(123)).toBeNull();
      expect(normalizeAutoDmMode(null)).toBeNull();
      expect(normalizeAutoDmMode(undefined)).toBeNull();
    });

    it("should normalize DM format properly", () => {
      expect(normalizeDmFormat("replace")).toBe("replace");
      expect(normalizeDmFormat("MESSAGE")).toBe("replace");
      expect(normalizeDmFormat("list")).toBe("list");
      expect(normalizeDmFormat("URLS")).toBe("list");

      expect(normalizeDmFormat("unknown")).toBeNull();
      expect(normalizeDmFormat(456)).toBeNull();
      expect(normalizeDmFormat(null)).toBeNull();
    });

    it("should normalize min URL length properly", () => {
      // Inherit / Reset to null
      expect(normalizeMinUrlLength(-1)).toEqual({ valid: true, value: null });
      expect(normalizeMinUrlLength("-1")).toEqual({ valid: true, value: null });
      expect(normalizeMinUrlLength("inherit")).toEqual({
        valid: true,
        value: null,
      });
      expect(normalizeMinUrlLength("DEFAULT")).toEqual({
        valid: true,
        value: null,
      });
      expect(normalizeMinUrlLength("reset")).toEqual({
        valid: true,
        value: null,
      });
      expect(normalizeMinUrlLength(null)).toEqual({ valid: true, value: null });
      expect(normalizeMinUrlLength(undefined)).toEqual({
        valid: true,
        value: null,
      });

      // All URLs (0)
      expect(normalizeMinUrlLength(0)).toEqual({ valid: true, value: 0 });
      expect(normalizeMinUrlLength("0")).toEqual({ valid: true, value: 0 });
      expect(normalizeMinUrlLength("all")).toEqual({ valid: true, value: 0 });

      // Specific length (1 ~ 2048)
      expect(normalizeMinUrlLength(1)).toEqual({ valid: true, value: 1 });
      expect(normalizeMinUrlLength(70)).toEqual({ valid: true, value: 70 });
      expect(normalizeMinUrlLength("70")).toEqual({ valid: true, value: 70 });
      expect(normalizeMinUrlLength(2048)).toEqual({ valid: true, value: 2048 });
      expect(normalizeMinUrlLength("2048")).toEqual({
        valid: true,
        value: 2048,
      });

      // Invalid inputs
      expect(normalizeMinUrlLength(-2)).toEqual({ valid: false, value: null });
      expect(normalizeMinUrlLength("-2")).toEqual({
        valid: false,
        value: null,
      });
      expect(normalizeMinUrlLength(2049)).toEqual({
        valid: false,
        value: null,
      });
      expect(normalizeMinUrlLength("2049")).toEqual({
        valid: false,
        value: null,
      });
      expect(normalizeMinUrlLength(3.14)).toEqual({
        valid: false,
        value: null,
      });
      expect(normalizeMinUrlLength("invalid")).toEqual({
        valid: false,
        value: null,
      });
      expect(normalizeMinUrlLength({})).toEqual({ valid: false, value: null });
    });
  });

  describe("Tri-state Processing Decision (shouldProcessUser)", () => {
    it("should fail closed (return false) when cache is not loaded", () => {
      userConfigService.setCacheLoadedForTest(false);
      expect(userConfigService.isCacheLoaded()).toBe(false);

      const userId = "test-fail-closed-user";
      // Regardless of channel watch status or config, always false
      expect(userConfigService.shouldProcessUser(userId, true)).toBe(false);
      expect(userConfigService.shouldProcessUser(userId, false)).toBe(false);
    });

    it("should default to inherit when user has no custom config", () => {
      userConfigService.setCacheLoadedForTest(true);
      const nonExistentUserId = "unconfigured-user-999999";
      const config = userConfigService.getUserConfig(nonExistentUserId);
      expect(config.autoDmMode).toBe(DEFAULT_USER_CONFIG.autoDmMode);
      expect(config.dmFormat).toBe(DEFAULT_USER_CONFIG.dmFormat);

      // Inherit mode: follows isChannelWatched
      expect(userConfigService.shouldProcessUser(nonExistentUserId, true)).toBe(
        true,
      );
      expect(
        userConfigService.shouldProcessUser(nonExistentUserId, false),
      ).toBe(false);
    });

    it("should respect on and off overrides", () => {
      userConfigService.setCacheLoadedForTest(true);
      const onUserId = "user-override-always-on";
      const offUserId = "user-override-always-off";

      // Mock cache directly for testing decision logic
      // @ts-expect-error accessing private cache for test
      userConfigService.cache.set(onUserId, {
        userId: onUserId,
        autoDmMode: "on",
        dmFormat: "replace",
      });

      // @ts-expect-error accessing private cache for test
      userConfigService.cache.set(offUserId, {
        userId: offUserId,
        autoDmMode: "off",
        dmFormat: "replace",
      });

      // ON: Always true regardless of channel watch status
      expect(userConfigService.shouldProcessUser(onUserId, true)).toBe(true);
      expect(userConfigService.shouldProcessUser(onUserId, false)).toBe(true);

      // OFF: Always false regardless of channel watch status
      expect(userConfigService.shouldProcessUser(offUserId, true)).toBe(false);
      expect(userConfigService.shouldProcessUser(offUserId, false)).toBe(false);
    });
  });

  describe("URL Message Replacement (replaceUrlsInText)", () => {
    it("should replace single URL in message", () => {
      const original =
        "이 링크 한번 확인해봐: https://example.com/very/long/url/path/test";
      const replacements = [
        {
          originalUrl: "https://example.com/very/long/url/path/test",
          shortenedUrl: "https://s.japsik.com/abc-021i3v9",
        },
      ];

      const result = userConfigService.replaceUrlsInText(
        original,
        replacements,
      );
      expect(result).toBe(
        "이 링크 한번 확인해봐: https://s.japsik.com/abc-021i3v9",
      );
    });

    it("should replace multiple URLs in message accurately", () => {
      const original =
        "링크1: https://site-a.com/long/path/1 링크2: https://site-b.org/article/2";
      const replacements = [
        {
          originalUrl: "https://site-a.com/long/path/1",
          shortenedUrl: "https://s.japsik.com/a1-021i3v9",
        },
        {
          originalUrl: "https://site-b.org/article/2",
          shortenedUrl: "https://s.japsik.com/b2-021i3v9",
        },
      ];

      const result = userConfigService.replaceUrlsInText(
        original,
        replacements,
      );
      expect(result).toBe(
        "링크1: https://s.japsik.com/a1-021i3v9 링크2: https://s.japsik.com/b2-021i3v9",
      );
    });

    it("should prevent substring collision by replacing longer URLs first", () => {
      // Shorter URL is a prefix/substring of the longer URL
      const shortUrl = "https://example.com";
      const longUrl = "https://example.com/sub/detail";

      const original = `체크: ${longUrl} 및 메인: ${shortUrl}`;
      const replacements = [
        { originalUrl: shortUrl, shortenedUrl: "https://s.japsik.com/short" },
        { originalUrl: longUrl, shortenedUrl: "https://s.japsik.com/long" },
      ];

      const result = userConfigService.replaceUrlsInText(
        original,
        replacements,
      );
      expect(result).toBe(
        "체크: https://s.japsik.com/long 및 메인: https://s.japsik.com/short",
      );
    });

    it("should replace identical URLs appearing multiple times", () => {
      const url = "https://example.com/common/target";
      const original = `앞에도 ${url} 뒤에도 ${url} 중복 등장`;
      const replacements = [
        { originalUrl: url, shortenedUrl: "https://s.japsik.com/target" },
      ];

      const result = userConfigService.replaceUrlsInText(
        original,
        replacements,
      );
      expect(result).toBe(
        "앞에도 https://s.japsik.com/target 뒤에도 https://s.japsik.com/target 중복 등장",
      );
    });

    it("should preserve surrounding Discord markdown and formatting", () => {
      const original =
        "마크다운 [문서](https://example.com/docs) 및 감싸기 <https://example.com/embed>";
      const replacements = [
        {
          originalUrl: "https://example.com/docs",
          shortenedUrl: "https://s.japsik.com/doc",
        },
        {
          originalUrl: "https://example.com/embed",
          shortenedUrl: "https://s.japsik.com/emb",
        },
      ];

      const result = userConfigService.replaceUrlsInText(
        original,
        replacements,
      );
      expect(result).toBe(
        "마크다운 [문서](https://s.japsik.com/doc) 및 감싸기 <https://s.japsik.com/emb>",
      );
    });

    it("should return original content when content is empty or replacements array is empty", () => {
      expect(userConfigService.replaceUrlsInText("", [])).toBe("");
      expect(userConfigService.replaceUrlsInText("그냥 일반 텍스트", [])).toBe(
        "그냥 일반 텍스트",
      );
    });
  });

  describe("Discord Message Chunking (chunkText)", () => {
    it("should not chunk text smaller than limit", () => {
      const text = "짧은 텍스트 메시지입니다.";
      const chunks = userConfigService.chunkText(text, 2000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it("should cleanly split long text exceeding limit", () => {
      const line = "가나다라마바사아자차카타파하 1234567890\n";
      const longText = line.repeat(100); // ~3700 chars
      const chunks = userConfigService.chunkText(longText, 1000);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe("setUserConfig Validation", () => {
    it("rejects invalid autoShortenMinUrlLength values outside 0..2048", async () => {
      const res = await userConfigService.setUserConfig(
        "test-user-validation",
        {
          autoShortenMinUrlLength: 3000,
        },
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid autoShortenMinUrlLength");
    });
  });
});
