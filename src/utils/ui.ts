import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type User,
} from "discord.js";
import { CustomId, type UserDashboardStats } from "@/types/bot";
import type { SinkLink, SinkStats } from "@/types/sink";
import type { UserConfigData } from "@/services/userConfigService";
import { getUserHash } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";

const COLORS = {
  PRIMARY: 0x5865f2, // Discord Blurple
  SUCCESS: 0x57f287, // Discord Green
  WARNING: 0xfee75c, // Discord Yellow
  DANGER: 0xed4245, // Discord Red
  DARK: 0x2b2d31, // Discord Dark Container
  MUTED: 0x949ba4, // Discord Gray
};

function safeDescription(text: unknown, maxLen = 4000): string {
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
   * Builds the Ephemeral Personal Dashboard view.
   */
  createDashboardView(
    user: User,
    dashboardStats: UserDashboardStats,
    selectedSlug?: string,
    currentPage: number = 1,
  ): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
  } {
    const userHash = getUserHash(user.id);
    const embeds: EmbedBuilder[] = [];

    const PAGE_SIZE = 20;
    const allUserLinks = dashboardStats.links || [];
    const totalLinks = allUserLinks.length;
    const totalPages = Math.ceil(totalLinks / PAGE_SIZE) || 1;
    const page = Math.max(1, Math.min(currentPage, totalPages));
    const startIndex = (page - 1) * PAGE_SIZE;
    const currentLinks = allUserLinks.slice(startIndex, startIndex + PAGE_SIZE);

    // Main Summary Card
    const summaryEmbed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setAuthor({
        name: `${user.username}'s Link Dashboard`,
        iconURL: user.displayAvatarURL(),
      })
      .setDescription(
        `> **개인 전용 링크 대시보드**에 오신 것을 환영합니다.\n> 고유 유저 해시: \`${userHash}\` ${totalPages > 1 ? `• 페이지: \`${page} / ${totalPages}\`` : ""}`,
      )
      .addFields(
        {
          name: "📊 총 링크",
          value: `\`${dashboardStats.totalLinks}\` 개`,
          inline: true,
        },
        {
          name: "⚡ 활성 링크",
          value: `\`${dashboardStats.activeLinks}\` 개`,
          inline: true,
        },
        {
          name: "⏳ 만료 링크",
          value: `\`${dashboardStats.expiredLinks}\` 개`,
          inline: true,
        },
        {
          name: "🖱️ 누적 클릭 수",
          value: `\`${dashboardStats.totalClicks.toLocaleString()}\` 회`,
          inline: true,
        },
      )
      .setFooter({
        text: `Snipsik • Powered by Sink ${totalPages > 1 ? `(페이지 ${page}/${totalPages})` : ""}`,
      })
      .setTimestamp();

    embeds.push(summaryEmbed);

    // If a link is selected, add its detailed view
    const selectedSlugLower = selectedSlug?.toLowerCase();
    const selectedLink = selectedSlugLower
      ? allUserLinks.find((l) => l.slug.toLowerCase() === selectedSlugLower)
      : undefined;

    if (selectedLink) {
      const fullShortUrl = sinkClient.getFullShortUrl(selectedLink.slug);
      const truncatedUrl =
        selectedLink.url.length > 70
          ? `${selectedLink.url.substring(0, 67)}...`
          : selectedLink.url;

      const linkEmbed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`📌 선택된 링크: /${selectedLink.slug}`)
        .setURL(fullShortUrl)
        .setDescription(
          safeDescription(
            `**단축 URL:** [🔗 /${selectedLink.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n**원본 링크:** [🌐 원본 웹사이트 열기 ↗](${selectedLink.url})\n↳ \`${truncatedUrl}\``,
          ),
        )
        .addFields(
          {
            name: "타이틀",
            value: selectedLink.title || "*설정 안 됨*",
            inline: true,
          },
          {
            name: "태그",
            value: selectedLink.tag ? `\`#${selectedLink.tag}\`` : "*없음*",
            inline: true,
          },
          {
            name: "클릭 수",
            value: `\`${(selectedLink.clicks ?? 0).toLocaleString()}\` 회`,
            inline: true,
          },
          {
            name: "비밀번호 보호",
            value: selectedLink.password ? "🔒 설정됨" : "🔓 공개",
            inline: true,
          },
          {
            name: "만료일",
            value: selectedLink.expiration
              ? `<t:${Math.floor(new Date(selectedLink.expiration).getTime() / 1000)}:R>`
              : "♾️ 무제한",
            inline: true,
          },
        );
      embeds.push(linkEmbed);
    }

    const components: ActionRowBuilder<
      ButtonBuilder | StringSelectMenuBuilder
    >[] = [];

    // Select Menu Row (if user has links)
    if (totalLinks > 0) {
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

      // Top: Previous Page Option (if not first page)
      if (page > 1) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`⬅️ 이전 페이지 (${page - 1}/${totalPages})`)
            .setDescription(`이전 20개 링크 목록으로 이동합니다.`)
            .setEmoji("⬅️")
            .setValue(`nav:page:${page - 1}`),
        );
      }

      // Middle: Current Page Links (Max 20)
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

      // Bottom: Next Page Option (if not last page)
      if (page < totalPages) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`다음 페이지 ➡️ (${page + 1}/${totalPages})`)
            .setDescription(`다음 20개 링크 목록으로 이동합니다.`)
            .setEmoji("➡️")
            .setValue(`nav:page:${page + 1}`),
        );
      }

      selectMenu.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          selectMenu,
        ),
      );
    }

    // Buttons Row
    const hasSelection = Boolean(selectedLink);
    const resolvedSlug = selectedLink?.slug;
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CREATE_BTN)
        .setLabel("새 링크 생성")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          hasSelection && resolvedSlug
            ? `${CustomId.DASHBOARD_EDIT_BTN}:${resolvedSlug}`
            : CustomId.DASHBOARD_EDIT_BTN,
        )
        .setLabel("수정")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasSelection),
      new ButtonBuilder()
        .setCustomId(
          hasSelection && resolvedSlug
            ? `${CustomId.DASHBOARD_DELETE_BTN}:${resolvedSlug}`
            : CustomId.DASHBOARD_DELETE_BTN,
        )
        .setLabel("삭제")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasSelection),
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

    components.push(buttonRow);

    return { embeds, components };
  },

  /**
   * Creates a modern card for a newly created or viewed link.
   */
  createLinkCard(link: SinkLink): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const fullShortUrl = sinkClient.getFullShortUrl(link.slug);
    const truncatedUrl =
      link.url.length > 70 ? `${link.url.substring(0, 67)}...` : link.url;

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🔗 단축 링크: /${link.slug}`)
      .setURL(fullShortUrl)
      .setDescription(
        safeDescription(
          `**단축 URL:** [🔗 /${link.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n**원본 링크:** [🌐 원본 웹사이트 열기 ↗](${link.url})\n↳ \`${truncatedUrl}\``,
        ),
      )
      .addFields(
        {
          name: "🏷️ 태그",
          value: link.tag ? `\`#${link.tag}\`` : "*없음*",
          inline: true,
        },
        {
          name: "🔒 비밀번호",
          value: link.password ? "설정됨" : "없음",
          inline: true,
        },
        {
          name: "⏳ 만료일",
          value: link.expiration
            ? `<t:${Math.floor(new Date(link.expiration).getTime() / 1000)}:R>`
            : "무제한",
          inline: true,
        },
      )
      .setFooter({ text: "Snipsik • URL Shortener" })
      .setTimestamp();

    if (link.title) {
      embed.setAuthor({ name: link.title });
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("링크 바로가기")
        .setStyle(ButtonStyle.Link)
        .setURL(fullShortUrl),
    );

    return { embeds: [embed], components: [buttonRow] };
  },

  /**
   * Creates a detailed statistics view for a slug.
   */
  createStatsCard(stats: SinkStats): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const fullShortUrl = sinkClient.getFullShortUrl(stats.slug);
    const truncatedUrl =
      stats.url.length > 70 ? `${stats.url.substring(0, 67)}...` : stats.url;

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(`📊 링크 통계: /${stats.slug}`)
      .setURL(fullShortUrl)
      .setDescription(
        safeDescription(
          `**단축 URL:** [🔗 /${stats.slug}](${fullShortUrl}) • \`${fullShortUrl}\`\n**원본 타겟:** [🌐 원본 웹사이트 열기 ↗](${stats.url})\n↳ \`${truncatedUrl}\``,
        ),
      )
      .addFields(
        {
          name: "🖱️ 총 클릭 수",
          value: `\`${stats.clicks.toLocaleString()}\` 회`,
          inline: true,
        },
        {
          name: "⏱️ 마지막 클릭",
          value: stats.lastClickedAt
            ? `<t:${Math.floor(new Date(stats.lastClickedAt).getTime() / 1000)}:R>`
            : "*클릭 기록 없음*",
          inline: true,
        },
      )
      .setFooter({ text: "Snipsik • Realtime Analytics" })
      .setTimestamp();

    if (stats.devices && Object.keys(stats.devices).length > 0) {
      const deviceStr = Object.entries(stats.devices)
        .map(([dev, count]) => `• **${dev}**: \`${count}\``)
        .join("\n");
      embed.addFields({ name: "📱 디바이스", value: deviceStr, inline: false });
    }

    if (stats.countries && Object.keys(stats.countries).length > 0) {
      const countryStr = Object.entries(stats.countries)
        .slice(0, 5)
        .map(([c, count]) => `• **${c}**: \`${count}\``)
        .join("\n");
      embed.addFields({
        name: "🌍 상위 국가",
        value: countryStr,
        inline: true,
      });
    }

    if (stats.referrers && Object.keys(stats.referrers).length > 0) {
      const refStr = Object.entries(stats.referrers)
        .slice(0, 5)
        .map(([ref, count]) => `• **${ref}**: \`${count}\``)
        .join("\n");
      embed.addFields({ name: "🌐 유입 경로", value: refStr, inline: true });
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("링크 열기")
        .setStyle(ButtonStyle.Link)
        .setURL(fullShortUrl),
    );

    return { embeds: [embed], components: [buttonRow] };
  },

  /**
   * Creates a card for DM notifications sent when watching channels.
   */
  createWatchDmCard(
    items: Array<{ originalUrl: string; shortenedUrl: string; slug: string }>,
    messageUrl: string,
    dmFormat: "replace" | "list" = "replace",
  ): EmbedBuilder {
    const lines = items.map((item, idx) => {
      const origTrunc = truncateMiddle(item.originalUrl, 48);
      return `**${idx + 1}.** \`${item.shortenedUrl}\`\n   ↳ 원본: \`${origTrunc}\``;
    });

    const description = [
      `> 📍 **원본 메시지:** ${messageUrl}`,
      "",
      "**단축된 링크 목록:**",
      ...lines,
    ].join("\n");

    return new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle("✂️ 긴 URL이 자동으로 단축되었습니다!")
      .setDescription(safeDescription(description))
      .setFooter({
        text:
          dmFormat === "replace"
            ? "아래 메시지에서 URL이 치환된 본문을 빠르게 복사할 수 있습니다."
            : "아래 메시지에서 단축 URL만 빠르게 복사할 수 있습니다.",
      })
      .setTimestamp();
  },

  /**
   * Creates standard success message embed.
   */
  createSuccessMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`✅ ${title}`)
      .setDescription(safeDescription(description))
      .setTimestamp();
  },

  /**
   * Creates standard error message embed.
   */
  createErrorMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle(`❌ ${title}`)
      .setDescription(safeDescription(description || "오류가 발생했습니다."))
      .setTimestamp();
  },

  /**
   * Creates standard warning/info message embed.
   */
  createInfoMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`ℹ️ ${title}`)
      .setDescription(safeDescription(description))
      .setTimestamp();
  },

  /**
   * Creates a confirmation dialog for deleting a link.
   */
  createDeleteConfirmView(slug: string): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const embed = new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle("⚠️ 링크 영구 삭제 확인")
      .setDescription(
        `정말로 단축 링크 \`/${slug}\`을(를) 삭제하시겠습니까?\n삭제된 링크는 복구할 수 없으며 기존 공유된 연결이 끊어집니다.`,
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`)
        .setLabel("삭제 확인")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CANCEL_DELETE_BTN)
        .setLabel("취소")
        .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  },

  /**
   * Builds the interactive Personal Config Panel view.
   */
  createConfigPanelView(
    user: User,
    userConfig: UserConfigData,
    notice?: {
      title: string;
      description: string;
      type?: "success" | "info" | "error";
    },
  ): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const embeds: EmbedBuilder[] = [];

    if (notice) {
      const noticeEmbed = new EmbedBuilder()
        .setColor(
          notice.type === "error"
            ? COLORS.DANGER
            : notice.type === "info"
              ? COLORS.WARNING
              : COLORS.SUCCESS,
        )
        .setTitle(
          notice.type === "error"
            ? `❌ ${notice.title}`
            : notice.type === "info"
              ? `ℹ️ ${notice.title}`
              : `✅ ${notice.title}`,
        )
        .setDescription(safeDescription(notice.description))
        .setTimestamp();
      embeds.push(noticeEmbed);
    }

    const autoDmDesc =
      userConfig.autoDmMode === "inherit"
        ? "🟢 **서버 설정 따름 (기본값)** — 서버 관리자가 지정한 감시 채널에서만 자동 단축 DM이 발송됩니다."
        : userConfig.autoDmMode === "on"
          ? "⚡ **항상 켬 (전체 채널)** — 서버 설정과 무관하게 봇이 접근 가능한 모든 채널에서 자동 단축 DM이 발송됩니다."
          : "🛑 **항상 끔** — 감시 채널에 등록된 곳이라도 나에게는 일절 DM을 발송하지 않습니다.";

    const formatDesc =
      userConfig.dmFormat === "replace"
        ? "💬 **본문 치환 (기본값)** — 원본 메시지 문맥에서 긴 URL만 단축 링크로 고쳐 끼운 완성형 본문을 전송합니다."
        : "📋 **URL 목록 나열** — 단축된 URL만을 순차 나열하여 모바일 복사에 최적화합니다.";

    const configEmbed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setAuthor({
        name: `${user.username}'s 개인 설정 (Config Panel)`,
        iconURL: user.displayAvatarURL(),
      })
      .setDescription(
        "> 긴 URL 감지 시 동작할 **개인 맞춤 정책**을 설정합니다.\n> 아래 버튼을 탭하면 설정이 즉시 반영됩니다.",
      )
      .addFields(
        {
          name: "🤖 자동 DM 수신 모드 (`auto_dm`)",
          value: autoDmDesc,
          inline: false,
        },
        {
          name: "📝 DM 메시지 포맷 (`dm_format`)",
          value: formatDesc,
          inline: false,
        },
      )
      .setFooter({
        text: "Snipsik • 개인 설정은 모든 서버에서 동일하게 적용됩니다.",
      })
      .setTimestamp();

    embeds.push(configEmbed);

    // Row 1: Auto DM Mode Buttons
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
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

    // Row 2: DM Format Buttons
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
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

    // Row 3: Navigation Button
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.CONFIG_NAV_DASHBOARD)
        .setLabel("대시보드로 이동")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Primary),
    );

    return { embeds, components: [row1, row2, row3] };
  },
};
