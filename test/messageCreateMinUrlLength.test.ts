import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { MessageFlags } from "discord.js";
import { onMessageCreate } from "@/events/messageCreate";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { sinkClient } from "@/services/sinkClient";
import { getUserHash } from "@/services/slugManager";

describe("MessageCreate URL Minimum Length Filtering", () => {
  const originalIsWatched = watchService.isWatched;
  const originalGetUserConfig = userConfigService.getUserConfig;
  const originalShouldProcessUser = userConfigService.shouldProcessUser;
  const originalResolveEffectiveMinUrlLength =
    guildConfigService.resolveEffectiveMinUrlLength;
  const originalSearchLinks = sinkClient.searchLinks;
  const originalCreateLink = sinkClient.createLink;
  const originalGetFullShortUrl = sinkClient.getFullShortUrl;

  const testUserId = "999888777666555444";
  const testUserHash = getUserHash(testUserId);
  const testGuildId = "guild-filter-test";
  const testChannelId = "channel-filter-test";

  beforeEach(() => {
    watchService.isWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: null,
    });
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`;
    sinkClient.searchLinks = async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
    });
  });

  afterEach(() => {
    watchService.isWatched = originalIsWatched;
    userConfigService.getUserConfig = originalGetUserConfig;
    userConfigService.shouldProcessUser = originalShouldProcessUser;
    guildConfigService.resolveEffectiveMinUrlLength =
      originalResolveEffectiveMinUrlLength;
    sinkClient.searchLinks = originalSearchLinks;
    sinkClient.createLink = originalCreateLink;
    sinkClient.getFullShortUrl = originalGetFullShortUrl;
  });

  it("skips URL when URL length is strictly below effective minimum length", async () => {
    // Effective min length: 70
    guildConfigService.resolveEffectiveMinUrlLength = () => 70;

    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: "slug-1", url: "https://example.com/short" },
    }));
    sinkClient.createLink = createLinkMock;

    let dmSent = false;
    const mockDmChannel = {
      send: mock(async () => {
        dmSent = true;
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    // 25 chars < 70
    const shortUrl = "https://example.com/short";
    expect(shortUrl.length).toBe(25);

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "test-channel" },
      content: `Here is a short link: ${shortUrl}`,
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(dmSent).toBe(false);
  });

  it("shortens URL when URL length is equal to or greater than effective minimum length", async () => {
    // Effective min length: 50
    guildConfigService.resolveEffectiveMinUrlLength = () => 50;

    const longUrl =
      "https://example.com/some/very/long/url/with/lots/of/paths/and/query?param=1";
    expect(longUrl.length).toBeGreaterThanOrEqual(50);

    const createdSlug = `created-${testUserHash}`;
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: longUrl },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "test-channel" },
      content: `Check this out: ${longUrl}`,
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(createLinkMock.mock.calls[0][0].url).toBe(longUrl);
    expect(sentPayloads.length).toBe(2);
    expect(sentPayloads[1].content).toBe(
      `Check this out: https://s.japsik.com/${createdSlug}`,
    );
  });

  it("selectively shortens only URLs >= threshold and leaves shorter URLs unchanged in message replacement", async () => {
    // Effective min length: 60
    guildConfigService.resolveEffectiveMinUrlLength = () => 60;

    const shortUrl = "https://example.com/short-link"; // 30 chars
    const longUrl =
      "https://example.com/deep/nested/resource/path/to/interesting/article/2026/09/index.html"; // 86 chars

    expect(shortUrl.length).toBeLessThan(60);
    expect(longUrl.length).toBeGreaterThanOrEqual(60);

    const createdSlug = `article-${testUserHash}`;
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: longUrl },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "test-channel" },
      content: `Read both: Short is ${shortUrl} and long is ${longUrl} here!`,
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    // Only longUrl should be shortened
    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(createLinkMock.mock.calls[0][0].url).toBe(longUrl);

    // Replaced message in DM: shortUrl remains untouched, longUrl is replaced
    expect(sentPayloads.length).toBe(2);
    expect(sentPayloads[1].content).toBe(
      `Read both: Short is ${shortUrl} and long is https://s.japsik.com/${createdSlug} here!`,
    );
  });

  it("shortens URLs under 15 characters when effective minimum length is set to 0", async () => {
    // Effective min length: 0 (전체 단축)
    guildConfigService.resolveEffectiveMinUrlLength = () => 0;

    const tinyUrl = "https://a.bc"; // 12 chars (previously skipped by < 15 hardcode)
    expect(tinyUrl.length).toBe(12);

    const createdSlug = `tiny-${testUserHash}`;
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: tinyUrl },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "test-channel" },
      content: `Tiny link: ${tinyUrl}`,
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(createLinkMock.mock.calls[0][0].url).toBe(tinyUrl);
    expect(sentPayloads[1].content).toBe(
      `Tiny link: https://s.japsik.com/${createdSlug}`,
    );
  });
});
