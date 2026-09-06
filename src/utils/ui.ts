import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  type User,
} from "discord.js";
import { CustomId, type UserDashboardStats } from "@/types/bot";
import type { SinkLink, SinkStats } from "@/types/sink";
import type { UserConfigData } from "@/services/userConfigService";
import { getUserHash } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";

export const COLORS = {
  PRIMARY: 0x5865f2, // Discord Blurple
  SUCCESS: 0x57f287, // Discord Green
  WARNING: 0xfee75c, // Discord Yellow
  DANGER: 0xed4245, // Discord Red
  DARK: 0x2b2d31, // Discord Dark Container
  MUTED: 0x949ba4, // Discord Gray
};

export interface V2MessageView {
  flags: number;
  components: ContainerBuilder[];
}

function safeDescription(text: unknown, maxLen = 3800): string {
  const str = typeof text === "string" ? text : String(text || "");
  if (str.length > maxLen) {
    return (
      str.substring(0, maxLen - 30) + "\n\n...*(내용이 너무 길어 일부 생략됨)*"
    );
  }
  return str;
}

function truncateMiddle(str: string, maxLength = 50): string {
  if (str.length <= maxLength) return str;
  const keep = Math.max(0, maxLength - 3);
  const front = Math.ceil(keep / 2);
  const back = Math.floor(keep / 2);
  return `${str.substring(0, front)}...${str.substring(str.length - back)}`;
}

export const ui = {
  /**
   * Builds the Ephemeral Personal Dashboard view using Components v2 ContainerBuilder.
   * Split into Top Overview Container and optional Bottom Selected Link Container.
   */
  createDashboardView(
    user: User,
    dashboardStats: UserDashboardStats,
    selectedSlug?: string,
    currentPage: number = 1,
  ): V2MessageView {
    const userHash = getUserHash(user.id);

    const PAGE_SIZE = 20;
    const allUserLinks = dashboardStats.links || [];
    const totalLinks = allUserLinks.length;
    const totalPages = Math.ceil(totalLinks / PAGE_SIZE) || 1;
    const page = Math.max(1, Math.min(currentPage, totalPages));
    const startIndex = (page - 1) * PAGE_SIZE;
    const currentLinks = allUserLinks.slice(startIndex, startIndex + PAGE_SIZE);

    // 1. Top Container: Overview Stats + Select Menu + Global Action Buttons
    const topContainer = new ContainerBuilder().setAccentColor(COLORS.DARK);

    const headerText = new TextDisplayBuilder().setContent(
      `### 📊 ${user.username}'s Link Dashboard\n> **개인 전용 링크 대시보드**에 오신 것을 환영합니다.\n> 고유 유저 해시: \`${userHash}\` ${totalPages > 1 ? `• 페이지: \`${page} / ${totalPages}\`` : ""}`,
    );

    const statsText = new TextDisplayBuilder().setContent(
      `📊 **총 링크:** \`${dashboardStats.totalLinks}\`개  •  ⚡ **활성:** \`${dashboardStats.activeLinks}\`개\n` +
        `⏳ **만료:** \`${dashboardStats.expiredLinks}\`개  •  🖱️ **누적 클릭:** \`${dashboardStats.totalClicks.toLocaleString()}\`회`,
    );

    topContainer.addTextDisplayComponents(headerText);
    topContainer.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true),
    );
    topContainer.addTextDisplayComponents(statsText);

    // Select Menu for choosing links
    const selectedSlugLower = selectedSlug?.toLowerCase();
    if (totalLinks > 0) {
      topContainer.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true),
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(CustomId.DASHBOARD_SELECT_LINK)
        .setPlaceholder(
          totalPages > 1
            ? `📋 관리할 링크 선택... (페이지 ${page}/${totalPages}, 총 ${totalLinks}개)`
            : `📋 관리할 링크를 선택하세요... (총 ${totalLinks}개)`,
        )
        .setMinValues(1)
        .setMaxValues(1);

      const options: StringSelectMenuOptionBuilder[] = [];

      if (page > 1) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`⬅️ 이전 페이지 (${page - 1}/${totalPages})`)
            .setDescription("이전 20개 링크 목록으로 이동합니다.")
            .setEmoji("⬅️")
            .setValue(`nav:page:${page - 1}`),
        );
      }

      for (const l of currentLinks) {
        const labelText = `/${l.slug}`;
        const descText = (l.url || "URL 정보 없음").substring(0, 100);

        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(labelText)
          .setDescription(descText)
          .setValue(`slug:${l.slug}:${page}`);

        if (selectedSlugLower && l.slug.toLowerCase() === selectedSlugLower) {
          opt.setDefault(true);
        }
        options.push(opt);
      }

      if (page < totalPages) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`다음 페이지 ➡️ (${page + 1}/${totalPages})`)
            .setDescription("다음 20개 링크 목록으로 이동합니다.")
            .setEmoji("➡️")
            .setValue(`nav:page:${page + 1}`),
        );
      }

      selectMenu.addOptions(options);
      topContainer.addActionRowComponents(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          selectMenu,
        ),
      );
    }

    // Global Action Buttons (Create, Refresh, Config)
    topContainer.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true),
    );
    const globalButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CREATE_BTN)
        .setLabel("새 링크 생성")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CustomId.DASHBOARD_REFRESH_BTN}:${page}`)
        .setLabel("새로고침")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CONFIG_BTN)
        .setLabel("설정")
        .setEmoji("⚙️")
        .setStyle(ButtonStyle.Secondary),
    );
    topContainer.addActionRowComponents(globalButtonRow);

    const components: ContainerBuilder[] = [topContainer];

    // 2. Bottom Container: Selected Link Detail + Link-dependent Action Buttons
    const selectedLink = selectedSlugLower
      ? allUserLinks.find((l) => l.slug.toLowerCase() === selectedSlugLower)
      : undefined;

    if (selectedLink) {
      const fullShortUrl = sinkClient.getFullShortUrl(selectedLink.slug);
      const truncatedUrl =
        selectedLink.url.length > 70
          ? `${selectedLink.url.substring(0, 67)}...`
          : selectedLink.url;

      const linkContainer = new ContainerBuilder().setAccentColor(COLORS.DARK);

      const linkDetailText = new TextDisplayBuilder().setContent(
        `### 📌 선택된 링크: /${selectedLink.slug}\n` +
          `**단축 URL:** [🔗 /${selectedLink.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n` +
          `**원본 타겟:** [🌐 원본 웹사이트 열기 ↗](${selectedLink.url})\n` +
          `↳ \`${truncatedUrl}\`\n\n` +
          `🏷️ **타이틀:** ${selectedLink.title || "*설정 안 됨*"}  •  🏷️ **태그:** ${selectedLink.tag ? `\`#${selectedLink.tag}\`` : "*없음*"}\n` +
          `🖱️ **클릭 수:** \`${(selectedLink.clicks ?? 0).toLocaleString()}\`회  •  🔒 **비밀번호:** ${selectedLink.password ? "🔒 설정됨" : "🔓 공개"}\n` +
          `⏳ **만료일:** ${selectedLink.expiration ? `<t:${Math.floor(new Date(selectedLink.expiration).getTime() / 1000)}:R>` : "♾️ 무제한"}`,
      );

      linkContainer.addTextDisplayComponents(linkDetailText);
      linkContainer.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true),
      );

      // Section with Inline Link Open Button Accessory
      const linkSection = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "🌐 **브라우저에서 단축 링크 바로 열기**",
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setLabel("링크 열기")
            .setStyle(ButtonStyle.Link)
            .setURL(fullShortUrl),
        );
      linkContainer.addSectionComponents(linkSection);

      linkContainer.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true),
      );

      // Link-specific Action Buttons (Edit, Delete)
      const linkActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CustomId.DASHBOARD_EDIT_BTN}:${selectedLink.slug}`)
          .setLabel("수정")
          .setEmoji("✏️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CustomId.DASHBOARD_DELETE_BTN}:${selectedLink.slug}`)
          .setLabel("삭제")
          .setEmoji("🗑️")
          .setStyle(ButtonStyle.Danger),
      );
      linkContainer.addActionRowComponents(linkActionRow);

      components.push(linkContainer);
    }

    return { flags: MessageFlags.IsComponentsV2, components };
  },

  /**
   * Creates a modern card for a newly created or viewed link using ContainerBuilder.
   */
  createLinkCard(link: SinkLink): V2MessageView {
    const fullShortUrl = sinkClient.getFullShortUrl(link.slug);
    const truncatedUrl =
      link.url.length > 70 ? `${link.url.substring(0, 67)}...` : link.url;

    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);

    const linkText = new TextDisplayBuilder().setContent(
      `### 🔗 단축 링크: /${link.slug}\n` +
        `**단축 URL:** [🔗 /${link.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n` +
        `**원본 링크:** [🌐 원본 웹사이트 열기 ↗](${link.url})\n` +
        `↳ \`${truncatedUrl}\`\n\n` +
        `🏷️ **태그:** ${link.tag ? `\`#${link.tag}\`` : "*없음*"}  •  🔒 **비밀번호:** ${link.password ? "설정됨" : "없음"}\n` +
        `⏳ **만료일:** ${link.expiration ? `<t:${Math.floor(new Date(link.expiration).getTime() / 1000)}:R>` : "♾️ 무제한"}`,
    );

    container.addTextDisplayComponents(linkText);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const openSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "🌐 **브라우저에서 단축 링크 바로 열기**",
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel("링크 바로가기")
          .setStyle(ButtonStyle.Link)
          .setURL(fullShortUrl),
      );
    container.addSectionComponents(openSection);

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Creates a detailed statistics view for a slug using ContainerBuilder.
   */
  createStatsCard(stats: SinkStats): V2MessageView {
    const fullShortUrl = sinkClient.getFullShortUrl(stats.slug);
    const truncatedUrl =
      stats.url.length > 70 ? `${stats.url.substring(0, 67)}...` : stats.url;

    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);

    let content =
      `### 📊 링크 통계: /${stats.slug}\n` +
      `**단축 URL:** [🔗 /${stats.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n` +
      `**원본 타겟:** [🌐 원본 웹사이트 열기 ↗](${stats.url})\n` +
      `↳ \`${truncatedUrl}\`\n\n` +
      `🖱️ **총 클릭 수:** \`${stats.clicks.toLocaleString()}\`회  •  ⏱️ **마지막 클릭:** ${
        stats.lastClickedAt
          ? `<t:${Math.floor(new Date(stats.lastClickedAt).getTime() / 1000)}:R>`
          : "*클릭 기록 없음*"
      }`;

    if (stats.devices && Object.keys(stats.devices).length > 0) {
      const deviceStr = Object.entries(stats.devices)
        .map(([dev, count]) => `• **${dev}**: \`${count}\``)
        .join("  ");
      content += `\n\n📱 **디바이스:** ${deviceStr}`;
    }

    if (stats.countries && Object.keys(stats.countries).length > 0) {
      const countryStr = Object.entries(stats.countries)
        .slice(0, 5)
        .map(([c, count]) => `• **${c}**: \`${count}\``)
        .join("  ");
      content += `\n\n🌍 **상위 국가:** ${countryStr}`;
    }

    if (stats.referrers && Object.keys(stats.referrers).length > 0) {
      const refStr = Object.entries(stats.referrers)
        .slice(0, 5)
        .map(([ref, count]) => `• **${ref}**: \`${count}\``)
        .join("  ");
      content += `\n\n🌐 **유입 경로:** ${refStr}`;
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeDescription(content)),
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const openSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "🌐 **브라우저에서 단축 링크 바로 열기**",
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel("링크 열기")
          .setStyle(ButtonStyle.Link)
          .setURL(fullShortUrl),
      );
    container.addSectionComponents(openSection);

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Creates a card for DM notifications sent when watching channels using ContainerBuilder.
   */
  createWatchDmCard(
    items: Array<{ originalUrl: string; shortenedUrl: string; slug: string }>,
    messageUrl: string,
    dmFormat: "replace" | "list" = "replace",
  ): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);

    const lines = items.map((item, idx) => {
      const origTrunc = truncateMiddle(item.originalUrl, 48);
      return `**${idx + 1}.** \`${item.shortenedUrl}\`\n   ↳ 원본: \`${origTrunc}\``;
    });

    const footerNotice =
      dmFormat === "replace"
        ? "*아래 메시지에서 URL이 치환된 본문을 빠르게 복사할 수 있습니다.*"
        : "*아래 메시지에서 단축 URL만 빠르게 복사할 수 있습니다.*";

    const description = [
      "### ✂️ 긴 URL이 자동으로 단축되었습니다!",
      `> 📍 **원본 메시지:** ${messageUrl}`,
      "",
      "**단축된 링크 목록:**",
      ...lines,
      "",
      footerNotice,
    ].join("\n");

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeDescription(description)),
    );

    return {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressEmbeds,
      components: [container],
    };
  },

  /**
   * Creates standard success message container.
   */
  createSuccessMessage(title: string, description: string): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ✅ ${title}\n${safeDescription(description)}`,
      ),
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Creates standard error message container.
   */
  createErrorMessage(title: string, description: string): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DANGER);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ❌ ${title}\n${safeDescription(description || "오류가 발생했습니다.")}`,
      ),
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Creates standard warning/info message container.
   */
  createInfoMessage(title: string, description: string): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ℹ️ ${title}\n${safeDescription(description)}`,
      ),
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Creates a confirmation dialog for deleting a link using ContainerBuilder.
   */
  createDeleteConfirmView(slug: string): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DANGER);

    const text = new TextDisplayBuilder().setContent(
      `### ⚠️ 링크 영구 삭제 확인\n` +
        `정말로 단축 링크 **\`/${slug}\`**을(를) 삭제하시겠습니까?\n` +
        `> ⚠️ **경고:** 삭제된 링크는 복구할 수 없으며 기존 공유된 연결이 영구히 끊어집니다.`,
    );
    container.addTextDisplayComponents(text);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`)
        .setLabel("영구 삭제")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CANCEL_DELETE_BTN)
        .setLabel("취소")
        .setStyle(ButtonStyle.Secondary),
    );
    container.addActionRowComponents(actionRow);

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },

  /**
   * Builds the interactive Personal Config Panel view using a single integrated ContainerBuilder.
   */
  createConfigPanelView(
    user: User,
    userConfig: UserConfigData,
    notice?: {
      title: string;
      description: string;
      type?: "success" | "info" | "error";
    },
  ): V2MessageView {
    const container = new ContainerBuilder().setAccentColor(COLORS.DARK);

    // 1. Notice Banner (Integrated at top inside the container if present)
    if (notice) {
      const icon =
        notice.type === "error" ? "❌" : notice.type === "info" ? "ℹ️" : "✅";
      const noticeText = new TextDisplayBuilder().setContent(
        `> ${icon} **${notice.title}**\n> ${safeDescription(notice.description)}`,
      );
      container.addTextDisplayComponents(noticeText);
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }

    // 2. Header
    const headerText = new TextDisplayBuilder().setContent(
      `### ⚙️ ${user.username}'s 개인 설정 (Config Panel)\n` +
        `> 긴 URL 감지 시 동작할 **개인 맞춤 정책**을 설정합니다.\n` +
        `> 아래 버튼을 탭하면 설정이 즉시 반영됩니다.`,
    );
    container.addTextDisplayComponents(headerText);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // 3. Auto DM Section
    const autoDmDesc =
      userConfig.autoDmMode === "inherit"
        ? "🟢 **서버 설정 따름 (기본값)** — 서버 관리자가 지정한 감시 채널에서만 자동 단축 DM이 발송됩니다."
        : userConfig.autoDmMode === "on"
          ? "⚡ **항상 켬 (전체 채널)** — 서버 설정과 무관하게 봇이 접근 가능한 모든 채널에서 자동 단축 DM이 발송됩니다."
          : "🛑 **항상 끔** — 감시 채널에 등록된 곳이라도 나에게는 일절 DM을 발송하지 않습니다.";

    const autoDmText = new TextDisplayBuilder().setContent(
      `🤖 **자동 DM 수신 모드 (\`auto_dm\`)**\n${autoDmDesc}`,
    );
    container.addTextDisplayComponents(autoDmText);

    const autoDmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_DM_INHERIT)
        .setLabel("상속 (기본)")
        .setEmoji("🟢")
        .setStyle(
          userConfig.autoDmMode === "inherit"
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_DM_ON)
        .setLabel("항상 켬")
        .setEmoji("⚡")
        .setStyle(
          userConfig.autoDmMode === "on"
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_DM_OFF)
        .setLabel("항상 끔")
        .setEmoji("🛑")
        .setStyle(
          userConfig.autoDmMode === "off"
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary,
        ),
    );
    container.addActionRowComponents(autoDmRow);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // 4. DM Format Section
    const formatDesc =
      userConfig.dmFormat === "replace"
        ? "💬 **본문 치환 (기본값)** — 원본 메시지 문맥에서 긴 URL만 단축 링크로 고쳐 끼운 완성형 본문을 전송합니다."
        : "📋 **URL 목록 나열** — 단축된 URL만을 순차 나열하여 모바일 복사에 최적화합니다.";

    const formatText = new TextDisplayBuilder().setContent(
      `📝 **DM 메시지 포맷 (\`dm_format\`)**\n${formatDesc}`,
    );
    container.addTextDisplayComponents(formatText);

    const formatRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_FMT_REPLACE)
        .setLabel("본문 치환 (기본)")
        .setEmoji("💬")
        .setStyle(
          userConfig.dmFormat === "replace"
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_FMT_LIST)
        .setLabel("URL 목록")
        .setEmoji("📋")
        .setStyle(
          userConfig.dmFormat === "list"
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
    );
    container.addActionRowComponents(formatRow);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // 5. Navigation Section
    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_NAV_DASHBOARD)
        .setLabel("대시보드로 이동")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Primary),
    );
    container.addActionRowComponents(navRow);

    const footerText = new TextDisplayBuilder().setContent(
      "*Snipsik • 개인 설정은 모든 서버에서 동일하게 적용됩니다.*",
    );
    container.addTextDisplayComponents(footerText);

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  },
};
