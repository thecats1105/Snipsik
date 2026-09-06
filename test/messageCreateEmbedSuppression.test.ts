import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { MessageFlags } from "discord.js";
import { onMessageCreate } from "@/events/messageCreate";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { sinkClient } from "@/services/sinkClient";

describe("Message Embed Suppression Workflow in DM Auto-Shortening", () => {
  const originalIsWatched = watchService.isWatched;
  const originalGetUserConfig = userConfigService.getUserConfig;
  const originalShouldProcessUser = userConfigService.shouldProcessUser;
  const originalCreateLink = sinkClient.createLink;
  const originalGetFullShortUrl = sinkClient.getFullShortUrl;

  beforeEach(() => {
    watchService.isWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });
    sinkClient.createLink = async () => ({
      success: true,
      link: {
        slug: "abc-xyz",
        url: "https://example.com/very/long/url/path",
      },
    });
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`;
  });

  afterEach(() => {
    watchService.isWatched = originalIsWatched;
    userConfigService.getUserConfig = originalGetUserConfig;
    userConfigService.shouldProcessUser = originalShouldProcessUser;
    sinkClient.createLink = originalCreateLink;
    sinkClient.getFullShortUrl = originalGetFullShortUrl;
  });

  it("sends replaced message chunks with MessageFlags.SuppressEmbeds without altering URLs with <URL>", async () => {
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });

    const sentPayloads: any[] = [];
    const suppressEmbedsMock = mock(async () => {});

    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: {
            has: (flag: number) => flag === MessageFlags.SuppressEmbeds,
          },
          suppressEmbeds: suppressEmbedsMock,
        };
      }),
    };

    const mockMessage = {
      author: {
        id: "1234567890",
        bot: false,
        tag: "User#1234",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content:
        "Here is a link: https://example.com/very/long/url/path check it out!",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    // 1st call: DM Card, 2nd call: Replaced message chunk
    expect(mockDmChannel.send).toHaveBeenCalledTimes(2);

    // Verify 1st call: Components v2 Container Card includes SuppressEmbeds
    const cardPayload = sentPayloads[0];
    expect((cardPayload.flags & MessageFlags.SuppressEmbeds) !== 0).toBe(true);
    expect((cardPayload.flags & MessageFlags.IsComponentsV2) !== 0).toBe(true);

    // Verify 2nd call: Replaced message chunk
    const chunkPayload = sentPayloads[1];
    expect(typeof chunkPayload).toBe("object");
    expect(chunkPayload.flags).toBe(MessageFlags.SuppressEmbeds);

    // Verify that content is NOT wrapped with <URL> but keeps original replacement structure
    expect(chunkPayload.content).toBe(
      "Here is a link: https://s.japsik.com/abc-xyz check it out!",
    );
    expect(chunkPayload.content).not.toContain(
      "<https://s.japsik.com/abc-xyz>",
    );

    // Because sentMsg.flags.has returned true, fallback suppressEmbeds should not be called
    expect(suppressEmbedsMock).not.toHaveBeenCalled();
  });

  it("calls fallback suppressEmbeds(true) on both card and text if Discord API fails to reflect flag", async () => {
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });

    const suppressEmbedsMock = mock(async () => {});

    const mockDmChannel = {
      send: mock(async () => {
        return {
          flags: {
            // Simulate missing SuppressEmbeds flag in returned message
            has: (_flag: number) => false,
          },
          suppressEmbeds: suppressEmbedsMock,
        };
      }),
    };

    const mockMessage = {
      author: {
        id: "1234567890",
        bot: false,
        tag: "User#1234",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Check this https://example.com/very/long/url/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    // Fallback suppressEmbeds(true) should be called for both the DM card (call 1) and replaced text chunk (call 2)
    expect(suppressEmbedsMock).toHaveBeenCalledTimes(2);
    expect(suppressEmbedsMock).toHaveBeenCalledWith(true);
  });

  it("does not count message as successful delivery when fallback suppressEmbeds fails in replace mode", async () => {
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });

    let callCount = 0;
    const mockDmChannel = {
      send: mock(async () => {
        callCount++;
        return {
          flags: {
            has: () => false, // missing flag triggers fallback
          },
          suppressEmbeds: mock(async () => {
            // Card succeeds, but text chunk rejection triggers catch block
            if (callCount === 2) {
              throw new Error("Discord API rate limited / forbidden");
            }
          }),
        };
      }),
    };

    const mockMessage = {
      author: {
        id: "1234567890",
        bot: false,
        tag: "User#1234",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Check this https://example.com/very/long/url/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    // Should complete without uncaught rejection
    await onMessageCreate(mockMessage as any);
    expect(mockDmChannel.send).toHaveBeenCalledTimes(2);
  });

  it("sends raw URL strings with MessageFlags.SuppressEmbeds in 'list' format mode", async () => {
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "list",
      autoShortenMinUrlLength: 0,
    });

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: {
            has: (flag: number) => flag === MessageFlags.SuppressEmbeds,
          },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: "1234567890",
        bot: false,
        tag: "User#1234",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Here: https://example.com/very/long/url/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);

    expect(mockDmChannel.send).toHaveBeenCalledTimes(2);

    const listPayload = sentPayloads[1];
    expect(typeof listPayload).toBe("object");
    expect(listPayload.content).toBe("https://s.japsik.com/abc-xyz");
    expect(listPayload.content).not.toContain("<");
    expect(listPayload.flags).toBe(MessageFlags.SuppressEmbeds);
  });

  it("does not count message as successful delivery when fallback suppressEmbeds fails in list mode", async () => {
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "list",
      autoShortenMinUrlLength: 0,
    });

    let callCount = 0;
    const mockDmChannel = {
      send: mock(async () => {
        callCount++;
        return {
          flags: {
            has: () => false,
          },
          suppressEmbeds: mock(async () => {
            if (callCount === 2) {
              throw new Error("Discord API failure on list item suppression");
            }
          }),
        };
      }),
    };

    const mockMessage = {
      author: {
        id: "1234567890",
        bot: false,
        tag: "User#1234",
        createDM: async () => mockDmChannel,
      },
      guildId: "guild-1",
      guild: {},
      channelId: "channel-1",
      channel: { name: "general" },
      content: "Here: https://example.com/very/long/url/path",
      url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    };

    await onMessageCreate(mockMessage as any);
    expect(mockDmChannel.send).toHaveBeenCalledTimes(2);
  });
});
