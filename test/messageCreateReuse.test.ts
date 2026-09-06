import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { MessageFlags } from "discord.js";
import { onMessageCreate } from "@/events/messageCreate";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { sinkClient } from "@/services/sinkClient";
import { getUserHash } from "@/services/slugManager";

describe("Auto-Shortening Existing URL Reuse", () => {
  const originalIsWatched = watchService.isWatched;
  const originalGetUserConfig = userConfigService.getUserConfig;
  const originalShouldProcessUser = userConfigService.shouldProcessUser;
  const originalSearchLinks = sinkClient.searchLinks;
  const originalCreateLink = sinkClient.createLink;
  const originalGetFullShortUrl = sinkClient.getFullShortUrl;

  const testUserId = "123456789012345678";
  const testUserHash = getUserHash(testUserId);
  const otherUserId = "987654321098765432";
  const otherUserHash = getUserHash(otherUserId);

  beforeEach(() => {
    watchService.isWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`;
  });

  afterEach(() => {
    watchService.isWatched = originalIsWatched;
    userConfigService.getUserConfig = originalGetUserConfig;
    userConfigService.shouldProcessUser = originalShouldProcessUser;
    sinkClient.searchLinks = originalSearchLinks;
    sinkClient.createLink = originalCreateLink;
    sinkClient.getFullShortUrl = originalGetFullShortUrl;
  });

  it("reuses existing active link belonging to the user and skips createLink", async () => {
    const existingSlug = `reused-${testUserHash}`;
    const searchLinksMock = mock(async () => ({
      success: true,
      list: [
        {
          slug: existingSlug,
          url: "https://example.com/target/reused/path",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      status: 200,
    }));
    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: `new-${testUserHash}`,
        url: "https://example.com/target/reused/path",
      },
    }));

    sinkClient.searchLinks = searchLinksMock;
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: {
            has: (flag: number) => flag === MessageFlags.SuppressEmbeds,
          },
          suppressEmbeds: mock(async () => {}),
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
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Check this: https://example.com/target/reused/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    // searchLinks must have been called with target URL and active status
    expect(searchLinksMock).toHaveBeenCalledTimes(1);
    expect(searchLinksMock.mock.calls[0][0]).toEqual({
      url: "https://example.com/target/reused/path",
      status: "active",
      limit: 20,
    });

    // createLink must NOT be called since active link was reused
    expect(createLinkMock).not.toHaveBeenCalled();

    // Verify DM card contains reused badge
    expect(sentPayloads.length).toBe(2);
    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    expect(cardJson).toContain(`https://s.japsik.com/${existingSlug}`);
    expect(cardJson).toContain("*(기존 링크 재사용)*");

    // Verify replaced text uses reused short URL
    expect(sentPayloads[1].content).toBe(
      `Check this: https://s.japsik.com/${existingSlug}`,
    );
  });

  it("selects the most recent active link when user has multiple existing links for the URL", async () => {
    const olderSlug = `old-${testUserHash}`;
    const newerSlug = `recent-${testUserHash}`;
    const newestSlug = `newest-${testUserHash}`;

    sinkClient.searchLinks = mock(async () => ({
      success: true,
      list: [
        {
          slug: olderSlug,
          url: "https://example.com/multi/path",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          slug: newestSlug,
          url: "https://example.com/multi/path",
          createdAt: "2026-03-01T12:00:00.000Z",
        },
        {
          slug: newerSlug,
          url: "https://example.com/multi/path",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      total: 3,
      status: 200,
    }));
    const createLinkMock = mock(async () => ({ success: false }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: mock(async () => {}),
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
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Link: https://example.com/multi/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    expect(cardJson).toContain(`https://s.japsik.com/${newestSlug}`);
    expect(cardJson).not.toContain(`https://s.japsik.com/${olderSlug}`);
    expect(sentPayloads[1].content).toBe(
      `Link: https://s.japsik.com/${newestSlug}`,
    );
  });

  it("does not reuse active links belonging to a different user and creates a new one", async () => {
    const otherUserSlug = `other-${otherUserHash}`;
    const newSlug = `new-${testUserHash}`;

    const searchLinksMock = mock(async () => ({
      success: true,
      list: [
        {
          slug: otherUserSlug,
          url: "https://example.com/shared/link",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      status: 200,
    }));

    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: newSlug,
        url: "https://example.com/shared/link",
      },
    }));

    sinkClient.searchLinks = searchLinksMock;
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: mock(async () => {}),
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
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Shared: https://example.com/shared/link",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    // createLink must be called because existing link belonged to someone else
    expect(createLinkMock).toHaveBeenCalledTimes(1);

    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    expect(cardJson).toContain(`https://s.japsik.com/${newSlug}`);
    expect(cardJson).not.toContain("*(기존 링크 재사용)*");
    expect(sentPayloads[1].content).toBe(
      `Shared: https://s.japsik.com/${newSlug}`,
    );
  });

  it("falls back to createLink when searchLinks throws an exception", async () => {
    const fallbackSlug = `fallback-${testUserHash}`;

    sinkClient.searchLinks = mock(async () => {
      throw new Error("Network timeout to Sink instance");
    });

    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: fallbackSlug,
        url: "https://example.com/error/fallback",
      },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: mock(async () => {}),
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
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Fallback URL: https://example.com/error/fallback",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).toHaveBeenCalledTimes(1);
    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    expect(cardJson).toContain(`https://s.japsik.com/${fallbackSlug}`);
    expect(cardJson).not.toContain("*(기존 링크 재사용)*");
  });

  it("handles mixed case with one reused link and one new link in the same message", async () => {
    const existingSlug = `reused-${testUserHash}`;
    const newSlug = `new-${testUserHash}`;

    sinkClient.searchLinks = mock(async (params) => {
      if (params?.url === "https://example.com/first/existing") {
        return {
          success: true,
          list: [
            {
              slug: existingSlug,
              url: "https://example.com/first/existing",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          total: 1,
          status: 200,
        };
      }
      return {
        success: true,
        list: [],
        total: 0,
        status: 200,
      };
    });

    const createLinkMock = mock(async (payload) => ({
      success: true,
      link: {
        slug: newSlug,
        url: payload.url,
      },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: mock(async () => {}),
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
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content:
        "First: https://example.com/first/existing Second: https://example.com/second/brandnew",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    // createLink should only be called once (for the second URL)
    expect(createLinkMock).toHaveBeenCalledTimes(1);

    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    // First link has reused label
    expect(cardJson).toContain(
      `\`https://s.japsik.com/${existingSlug}\` *(기존 링크 재사용)*`,
    );
    // Second link does not have reused label
    expect(cardJson).toContain(`\`https://s.japsik.com/${newSlug}\`\\n`);

    // Replaced message contains both
    expect(sentPayloads[1].content).toBe(
      `First: https://s.japsik.com/${existingSlug} Second: https://s.japsik.com/${newSlug}`,
    );
  });

  it("deduplicates in-flight creation when concurrent messages are received with the exact same URL from the same user", async () => {
    const newSlug = `concurrent-${testUserHash}`;

    // Simulate async delay in createLink
    sinkClient.searchLinks = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { success: true, list: [], total: 0, status: 200 };
    });

    const createLinkMock = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        success: true,
        link: {
          slug: newSlug,
          url: "https://example.com/concurrent/race/condition",
        },
      };
    });
    sinkClient.createLink = createLinkMock;

    const sentPayloads1: any[] = [];
    const sentPayloads2: any[] = [];

    const mockMessage1 = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => ({
          send: mock(async (payload: any) => {
            sentPayloads1.push(payload);
            return {
              flags: { has: () => true },
              suppressEmbeds: mock(async () => {}),
            };
          }),
        }),
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Race 1: https://example.com/concurrent/race/condition",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    const mockMessage2 = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => ({
          send: mock(async (payload: any) => {
            sentPayloads2.push(payload);
            return {
              flags: { has: () => true },
              suppressEmbeds: mock(async () => {}),
            };
          }),
        }),
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Race 2: https://example.com/concurrent/race/condition",
      url: "https://discord.com/channels/guild-1/channel-1/msg-2",
    };

    // Fire both concurrent messages simultaneously
    await Promise.all([
      onMessageCreate(mockMessage1 as any),
      onMessageCreate(mockMessage2 as any),
    ]);

    // createLink must be called only once thanks to in-flight deduplication
    expect(createLinkMock).toHaveBeenCalledTimes(1);

    // Verify both handlers delivered the exact same resolved slug in DM card and text chunk
    expect(sentPayloads1.length).toBe(2);
    expect(sentPayloads2.length).toBe(2);

    expect(sentPayloads1[1].content).toBe(
      `Race 1: https://s.japsik.com/${newSlug}`,
    );
    expect(sentPayloads2[1].content).toBe(
      `Race 2: https://s.japsik.com/${newSlug}`,
    );

    const cardJson1 = JSON.stringify(sentPayloads1[0].components[0].toJSON());
    const cardJson2 = JSON.stringify(sentPayloads2[0].components[0].toJSON());
    expect(cardJson1).toContain(`https://s.japsik.com/${newSlug}`);
    expect(cardJson2).toContain(`https://s.japsik.com/${newSlug}`);
  });

  it("does not reuse active links when target URL has different query parameters despite search match", async () => {
    const existingSlug = `different-query-${testUserHash}`;
    const searchLinksMock = mock(async () => ({
      success: true,
      list: [
        {
          slug: existingSlug,
          url: "https://example.com/product?id=123",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      status: 200,
    }));
    sinkClient.searchLinks = searchLinksMock;

    const newSlug = `new-query-${testUserHash}`;
    const createLinkMock = mock(async (payload) => ({
      success: true,
      link: {
        slug: newSlug,
        url: payload.url,
      },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: mock(async () => {}),
        };
      }),
    };

    const incomingUrl = "https://example.com/product?id=123&utm_source=discord";

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: `Check this: ${incomingUrl}`,
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(createLinkMock.mock.calls[0][0].url).toBe(incomingUrl);

    expect(sentPayloads.length).toBe(2);
    const cardJson = JSON.stringify(sentPayloads[0].components[0].toJSON());
    expect(cardJson).toContain(`https://s.japsik.com/${newSlug}`);
    expect(cardJson).not.toContain("*(기존 링크 재사용)*");
  });
});
