import { describe, expect, it } from "bun:test";
import { ui, COLORS } from "@/services/../utils/ui";
import type { User } from "discord.js";
import type { UserDashboardStats } from "@/types/bot";
import type { SinkLink, SinkStats } from "@/types/sink";

const mockUser = {
  id: "123456789012345678",
  username: "TestUser",
  displayAvatarURL: () => "https://cdn.discordapp.com/avatars/test.png",
} as unknown as User;

const mockStats: UserDashboardStats = {
  totalLinks: 2,
  activeLinks: 2,
  expiredLinks: 0,
  totalClicks: 42,
  links: [
    {
      slug: "abc-1234",
      url: "https://example.com/very/long/url",
      title: "예시 타이틀",
      tag: "test",
      clicks: 10,
      createdAt: new Date().toISOString(),
    },
    {
      slug: "def-1234",
      url: "https://google.com",
      clicks: 32,
      createdAt: new Date().toISOString(),
    },
  ],
};

describe("Discord Components v2 UI Modules", () => {
  describe("createDashboardView", () => {
    it("renders single top overview container when no link is selected", () => {
      const view = ui.createDashboardView(mockUser, mockStats);
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const topJson = view.components[0].toJSON();
      expect(topJson.type).toBe(17); // Container
      expect(topJson.accent_color).toBe(COLORS.DARK);
    });

    it("renders 2-step split containers when a link is selected", () => {
      const view = ui.createDashboardView(mockUser, mockStats, "abc-1234");
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(2);

      const topJson = view.components[0].toJSON();
      const bottomJson = view.components[1].toJSON();

      expect(topJson.type).toBe(17);
      expect(bottomJson.type).toBe(17);
      expect(topJson.accent_color).toBe(COLORS.DARK);
      expect(bottomJson.accent_color).toBe(COLORS.DARK);

      // Verify bottom container has Section (Type 9) and ActionRow (Type 1)
      const subTypes = bottomJson.components.map(
        (c: { type: number }) => c.type,
      );
      expect(subTypes).toContain(9); // Section
      expect(subTypes).toContain(1); // ActionRow
    });
  });

  describe("createConfigPanelView", () => {
    it("renders single integrated container for user config", () => {
      const view = ui.createConfigPanelView(mockUser, {
        autoDmMode: "inherit",
        dmFormat: "replace",
      });
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);
      expect(json.accent_color).toBe(COLORS.DARK);
    });

    it("integrates notice banner into the container when notice is provided", () => {
      const view = ui.createConfigPanelView(
        mockUser,
        { autoDmMode: "on", dmFormat: "list" },
        { title: "성공", description: "설정 저장됨", type: "success" },
      );
      expect(view.components.length).toBe(1);
      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);
      expect(JSON.stringify(json)).toContain("성공");
    });
  });

  describe("createDeleteConfirmView", () => {
    it("renders Danger accent colored container with delete buttons", () => {
      const view = ui.createDeleteConfirmView("abc-1234");
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);
      expect(json.accent_color).toBe(COLORS.DANGER);
    });
  });

  describe("createLinkCard", () => {
    it("renders container with Section accessory for single link open button", () => {
      const link: SinkLink = {
        slug: "abc-1234",
        url: "https://example.com",
        clicks: 5,
      };
      const view = ui.createLinkCard(link);
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);

      const section = json.components.find(
        (c: { type: number }) => c.type === 9,
      );
      expect(section).toBeDefined();
      expect(section.accessory.style).toBe(5); // Link style button
    });
  });

  describe("createStatsCard", () => {
    it("renders container with device and referrer statistics", () => {
      const stats: SinkStats = {
        slug: "abc-1234",
        url: "https://example.com",
        clicks: 100,
        devices: { desktop: 70, mobile: 30 },
        countries: { KR: 90, US: 10 },
        referrers: { discord: 50 },
      };
      const view = ui.createStatsCard(stats);
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);
      expect(JSON.stringify(json)).toContain("desktop");
      expect(JSON.stringify(json)).toContain("KR");
    });
  });

  describe("createWatchDmCard", () => {
    it("renders clean information container without action buttons", () => {
      const view = ui.createWatchDmCard(
        [
          {
            originalUrl: "https://verylongurl.com/a/b/c",
            shortenedUrl: "https://s.japsik.com/abc",
            slug: "abc",
          },
        ],
        "https://discord.com/channels/1/2/3",
        "replace",
      );
      expect(view.embeds).toEqual([]);
      expect(view.components.length).toBe(1);

      const json = view.components[0].toJSON();
      expect(json.type).toBe(17);
      // No ActionRow (Type 1)
      const hasActionRow = json.components.some(
        (c: { type: number }) => c.type === 1,
      );
      expect(hasActionRow).toBe(false);
    });
  });

  describe("Simple messages (Success, Error, Info)", () => {
    it("renders Success and Info with Dark accent, Error with Danger accent", () => {
      const success = ui.createSuccessMessage("완료", "작업이 완료되었습니다.");
      const error = ui.createErrorMessage("에러", "작업 실패");
      const info = ui.createInfoMessage("안내", "참고 정보");

      expect(success.components[0].toJSON().accent_color).toBe(COLORS.DARK);
      expect(error.components[0].toJSON().accent_color).toBe(COLORS.DANGER);
      expect(info.components[0].toJSON().accent_color).toBe(COLORS.DARK);
    });
  });
});
