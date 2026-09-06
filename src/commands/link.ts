import {
  type AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Command, UserDashboardStats } from "@/types/bot";
import { sinkClient } from "@/services/sinkClient";
import {
  generateSlug,
  getUserHash,
  isAdmin,
  validateCustomSlug,
  verifyOwnership,
} from "@/services/slugManager";
import { watchService } from "@/services/watchService";
import {
  userConfigService,
  normalizeAutoDmMode,
  normalizeDmFormat,
} from "@/services/userConfigService";
import { ui } from "@/utils/ui";
import { parseExpiration } from "@/utils/time";
import { logger } from "@/utils/logger";

export async function fetchUserDashboardStats(
  userId: string,
): Promise<UserDashboardStats> {
  const userHash = getUserHash(userId);

  // Fetch count stats and user links in parallel without downloading entire database
  const [totalCountRes, activeCountRes, expiredCountRes, searchRes] =
    await Promise.all([
      sinkClient.countLinks({ q: userHash, status: "all" }),
      sinkClient.countLinks({ q: userHash, status: "active" }),
      sinkClient.countLinks({ q: userHash, status: "expired" }),
      sinkClient.searchLinks({ q: userHash, status: "all", limit: 100 }),
    ]);

  const rawUserLinks = searchRes.success ? searchRes.list : [];

  // Strictly verify user ownership (case-insensitive for slug/hash consistency)
  const userHashLower = userHash.toLowerCase();
  const userLinks = rawUserLinks.filter((link) => {
    if (!link.slug) return false;
    const slugLower = link.slug.toLowerCase();
    return (
      slugLower.endsWith(`-${userHashLower}`) || slugLower === userHashLower
    );
  });

  // Sort by createdAt descending (most recent first)
  userLinks.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  const now = Date.now();
  let activeLinks = activeCountRes.success ? activeCountRes.count : 0;
  let expiredLinks = expiredCountRes.success ? expiredCountRes.count : 0;
  let totalLinks = totalCountRes.success
    ? totalCountRes.count
    : userLinks.length;
  let totalClicks = 0;

  for (const link of userLinks) {
    totalClicks += link.clicks ?? 0;
  }

  const countsUnavailable =
    !totalCountRes.success ||
    !activeCountRes.success ||
    !expiredCountRes.success;

  // Fallback calculation if any count endpoint was unavailable
  if (countsUnavailable && userLinks.length > 0) {
    let localActive = 0;
    let localExpired = 0;
    for (const link of userLinks) {
      if (link.expiration) {
        const expTime = new Date(link.expiration).getTime();
        if (!isNaN(expTime) && expTime <= now) {
          localExpired++;
          continue;
        }
      }
      localActive++;
    }

    if (totalCountRes.success) {
      if (activeCountRes.success && !expiredCountRes.success) {
        expiredLinks = Math.max(0, totalLinks - activeLinks);
      } else if (!activeCountRes.success && expiredCountRes.success) {
        activeLinks = Math.max(0, totalLinks - expiredLinks);
      } else if (!activeCountRes.success && !expiredCountRes.success) {
        if (totalLinks <= userLinks.length) {
          activeLinks = localActive;
          expiredLinks = localExpired;
        } else {
          // Bounded sample: derive proportional estimate across totalLinks
          const activeRatio = localActive / userLinks.length;
          activeLinks = Math.round(totalLinks * activeRatio);
          expiredLinks = Math.max(0, totalLinks - activeLinks);
        }
      }
    } else {
      if (activeCountRes.success && expiredCountRes.success) {
        totalLinks = activeLinks + expiredLinks;
      } else {
        if (!activeCountRes.success) activeLinks = localActive;
        if (!expiredCountRes.success) expiredLinks = localExpired;
        totalLinks = Math.max(userLinks.length, activeLinks + expiredLinks);
      }
    }
  }

  return {
    totalLinks,
    activeLinks,
    expiredLinks,
    totalClicks,
    links: userLinks,
  };
}

export const linkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Snipsik URL 단축 및 관리 시스템")
    // /link dashboard
    .addSubcommand((sub) =>
      sub
        .setName("dashboard")
        .setDescription(
          "유저 개인 전용 일시성(Ephemeral) 인터랙티브 대시보드를 엽니다.",
        ),
    )
    // /link config
    .addSubcommand((sub) =>
      sub
        .setName("config")
        .setDescription(
          "개인별 URL 감시 및 DM 전송 설정을 확인하거나 변경합니다.",
        )
        .addStringOption((opt) =>
          opt
            .setName("key")
            .setDescription("설정 항목 (auto_dm, dm_format)")
            .setAutocomplete(true)
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("value")
            .setDescription("설정할 값 (자동완성 추천 또는 직접 입력)")
            .setAutocomplete(true)
            .setRequired(false),
        ),
    )
    // /link create
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("새로운 일반 단축 링크를 생성합니다.")
        .addStringOption((opt) =>
          opt
            .setName("url")
            .setDescription("단축할 대상 URL")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("expiration")
            .setDescription("만료 기간 (예: 10m, 1h, 7d, 24h)")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("password")
            .setDescription("비밀번호 보호 설정")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("tag")
            .setDescription("링크 분류 태그")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("링크 타이틀").setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("링크 상세 설명")
            .setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("unsafe")
            .setDescription("위험/주의 링크 플래그")
            .setRequired(false),
        ),
    )
    // /link custom
    .addSubcommand((sub) =>
      sub
        .setName("custom")
        .setDescription("순수 커스텀 슬러그 링크를 생성합니다 (관리자 전용).")
        .addStringOption((opt) =>
          opt
            .setName("url")
            .setDescription("단축할 대상 URL")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("custom_slug")
            .setDescription("원하는 커스텀 슬러그 문자열")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("expiration")
            .setDescription("만료 기간 (예: 10m, 1h, 7d)")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("password")
            .setDescription("비밀번호 보호 설정")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("tag")
            .setDescription("링크 분류 태그")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("링크 타이틀").setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("링크 상세 설명")
            .setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("unsafe")
            .setDescription("위험/주의 링크 플래그")
            .setRequired(false),
        ),
    )
    // /link list
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("내가 생성한 링크 목록을 조회합니다.")
        .addStringOption((opt) =>
          opt
            .setName("tag")
            .setDescription("특정 태그로 필터링")
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("page")
            .setDescription("페이지 번호 (기본 1)")
            .setMinValue(1)
            .setRequired(false),
        ),
    )
    // /link stats
    .addSubcommand((sub) =>
      sub
        .setName("stats")
        .setDescription("특정 슬러그의 클릭 수 및 방문 통계를 조회합니다.")
        .addStringOption((opt) =>
          opt
            .setName("slug")
            .setDescription("조회할 링크의 슬러그")
            .setRequired(true),
        ),
    )
    // /link delete
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("생성한 단축 링크를 삭제합니다.")
        .addStringOption((opt) =>
          opt
            .setName("slug")
            .setDescription("삭제할 링크의 슬러그")
            .setRequired(true),
        ),
    )
    // /link check
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription(
          "대상 웹사이트의 생존 여부(HTTP 상태코드)를 점검합니다.",
        )
        .addStringOption((opt) =>
          opt
            .setName("url")
            .setDescription("점검할 대상 URL")
            .setRequired(true),
        ),
    )
    // /link admin [list|user|overview|delete] Subcommand Group (Admin only)
    .addSubcommandGroup((group) =>
      group
        .setName("admin")
        .setDescription("봇 관리자 전용 링크 관리 기능 (ADMIN_USER_IDS 전용)")
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("Sink 인스턴스의 전체 단축 링크 목록을 조회합니다.")
            .addStringOption((opt) =>
              opt
                .setName("tag")
                .setDescription("필터링할 태그")
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt
                .setName("query")
                .setDescription("슬러그 또는 URL 검색어")
                .setRequired(false),
            )
            .addIntegerOption((opt) =>
              opt
                .setName("page")
                .setDescription("조회할 페이지 번호")
                .setMinValue(1)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("user")
            .setDescription("특정 유저가 생성한 단축 링크 목록을 조회합니다.")
            .addUserOption((opt) =>
              opt
                .setName("user")
                .setDescription("조회할 디스코드 유저")
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName("tag")
                .setDescription("필터링할 태그")
                .setRequired(false),
            )
            .addIntegerOption((opt) =>
              opt
                .setName("page")
                .setDescription("조회할 페이지 번호")
                .setMinValue(1)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("overview")
            .setDescription(
              "Sink 인스턴스 전체 링크 및 클릭 통계 현황을 조회합니다.",
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription(
              "소유권에 관계없이 특정 단축 링크를 강제 영구 삭제합니다.",
            )
            .addStringOption((opt) =>
              opt
                .setName("slug")
                .setDescription("삭제할 링크의 슬러그")
                .setRequired(true),
            ),
        ),
    )
    // /link watch [add|remove|list] Subcommand Group
    .addSubcommandGroup((group) =>
      group
        .setName("watch")
        .setDescription("채널 URL 자동 단축 감시 설정 (서버 관리자 전용)")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("해당 채널을 URL 감시 대상에 등록합니다.")
            .addChannelOption((opt) =>
              opt
                .setName("channel")
                .setDescription("감시할 텍스트 채널")
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                )
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("해당 채널을 URL 감시 대상에서 해제합니다.")
            .addChannelOption((opt) =>
              opt
                .setName("channel")
                .setDescription("해제할 채널")
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                )
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("현재 서버의 감시 대상 채널 목록을 조회합니다."),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    try {
      // 1. /link admin [list|user|overview|delete]
      if (group === "admin") {
        await handleAdminCommand(interaction, subcommand);
        return;
      }

      // 2. /link watch [add|remove|list]
      if (group === "watch") {
        await handleWatchCommand(interaction, subcommand);
        return;
      }

      // 3. /link dashboard
      if (subcommand === "dashboard") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats);
        await interaction.editReply(view);
        return;
      }

      // 4. /link config
      if (subcommand === "config") {
        await handleConfigCommand(interaction);
        return;
      }

      // 5. /link create
      if (subcommand === "create") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const targetUrl = interaction.options.getString("url", true);
        const expStr = interaction.options.getString("expiration");
        const password = interaction.options.getString("password");
        const tag = interaction.options.getString("tag");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const unsafe = interaction.options.getBoolean("unsafe") || false;

        if (targetUrl.length > 2048) {
          const errEmbed = ui.createErrorMessage(
            "URL 길이 초과",
            "URL 길이는 최대 2,048자까지 허용됩니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const slug = generateSlug(interaction.user.id);
        const expiration = parseExpiration(expStr);

        const res = await sinkClient.createLink({
          url: targetUrl,
          slug,
          expiration,
          password: password || undefined,
          tag: tag || undefined,
          title: title || undefined,
          description: description || undefined,
          unsafe,
        });

        if (!res.success || !res.link) {
          const errEmbed = ui.createErrorMessage(
            "단축 링크 생성 실패",
            res.error || "알 수 없는 오류가 발생했습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const linkCard = ui.createLinkCard(res.link);
        await interaction.editReply(linkCard);
        return;
      }

      // 4. /link custom
      if (subcommand === "custom") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const targetUrl = interaction.options.getString("url", true);
        const customSlug = interaction.options.getString("custom_slug", true);
        const expStr = interaction.options.getString("expiration");
        const password = interaction.options.getString("password");
        const tag = interaction.options.getString("tag");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const unsafe = interaction.options.getBoolean("unsafe") || false;

        if (targetUrl.length > 2048) {
          const errEmbed = ui.createErrorMessage(
            "URL 길이 초과",
            "URL 길이는 최대 2,048자까지 허용됩니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        if (customSlug.length > 2048) {
          const errEmbed = ui.createErrorMessage(
            "슬러그 길이 초과",
            "슬러그 길이는 최대 2,048자까지 허용됩니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const validation = validateCustomSlug(customSlug, interaction.user.id);
        if (!validation.valid) {
          const errEmbed = ui.createErrorMessage(
            "커스텀 슬러그 생성 권한 없음",
            validation.error || "커스텀 슬러그를 생성할 수 없습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const expiration = parseExpiration(expStr);
        const res = await sinkClient.createLink({
          url: targetUrl,
          slug: customSlug,
          expiration,
          password: password || undefined,
          tag: tag || undefined,
          title: title || undefined,
          description: description || undefined,
          unsafe,
        });

        if (!res.success || !res.link) {
          const errEmbed = ui.createErrorMessage(
            "커스텀 단축 링크 생성 실패",
            res.error || "이미 사용 중인 슬러그이거나 오류가 발생했습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const linkCard = ui.createLinkCard(res.link);
        await interaction.editReply(linkCard);
        return;
      }

      // 5. /link list
      if (subcommand === "list") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const inputTag = interaction.options.getString("tag")?.trim();
        const page = interaction.options.getInteger("page") || 1;
        const userHash = getUserHash(interaction.user.id);
        const cleanTag = inputTag
          ? inputTag.replace(/^#/, "").trim()
          : undefined;

        // Fetch user links directly using search endpoint
        const res = await sinkClient.searchLinks({
          q: userHash,
          tag: cleanTag || undefined,
          status: "all",
          limit: 1000,
        });

        if (!res.success) {
          const errEmbed = ui.createErrorMessage(
            "목록 조회 실패",
            res.error || "오류가 발생했습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        // 1. Strictly filter only this user's links (case-insensitive)
        const userHashLower = userHash.toLowerCase();
        let userLinks = res.list.filter((l) => {
          if (!l.slug) return false;
          const slugLower = l.slug.toLowerCase();
          return (
            slugLower.endsWith(`-${userHashLower}`) ||
            slugLower === userHashLower
          );
        });

        // 2. Filter by Tag if specified (client-side guarantee)
        if (cleanTag) {
          const lowerTag = cleanTag.toLowerCase();
          userLinks = userLinks.filter((l) => {
            if (!l.tag) return false;
            const linkTag = l.tag.toLowerCase().replace(/^#/, "");
            const tagList = linkTag.split(/[\s,]+/).map((t) => t.trim());
            return tagList.includes(lowerTag) || linkTag.includes(lowerTag);
          });
        }

        if (userLinks.length === 0) {
          const infoEmbed = ui.createInfoMessage(
            "생성된 링크 없음",
            inputTag
              ? `태그 \`#${inputTag.replace(/^#/, "")}\`에 해당하는 내 단축 링크가 없습니다.`
              : "아직 생성한 단축 링크가 없습니다. `/link create` 또는 `/link dashboard`로 생성해보세요!",
          );
          await interaction.editReply(infoEmbed);
          return;
        }

        const pageSize = 5;
        const totalPages = Math.ceil(userLinks.length / pageSize) || 1;
        const currentPage = Math.max(1, Math.min(page, totalPages));
        const startIndex = (currentPage - 1) * pageSize;
        const paginated = userLinks.slice(startIndex, startIndex + pageSize);

        const lines = paginated.map((l, idx) => {
          const full = sinkClient.getFullShortUrl(l.slug);
          const clickPart = `(\`${(l.clicks ?? 0).toLocaleString()}\` clicks)`;
          const truncated =
            l.url.length > 50 ? `${l.url.substring(0, 47)}...` : l.url;
          return `**${startIndex + idx + 1}.** [/${l.slug}](${full}) ${clickPart}\n   ↳ [🌐 원본 열기 ↗](${l.url}) • \`${truncated}\``;
        });

        const listEmbed = ui.createSuccessMessage(
          `내 링크 목록 (페이지 ${currentPage}/${totalPages})`,
          lines.join("\n\n"),
        );

        await interaction.editReply(listEmbed);
        return;
      }

      // 6. /link stats
      if (subcommand === "stats") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const slug = interaction.options.getString("slug", true).trim();

        if (!verifyOwnership(slug, interaction.user.id)) {
          const errEmbed = ui.createErrorMessage(
            "접근 권한 없음",
            `\`/${slug}\` 링크의 통계를 조회할 권한이 없습니다. 본인이 생성한 링크만 조회할 수 있습니다.`,
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const res = await sinkClient.getStats(slug);
        if (!res.success || !res.stats) {
          const errEmbed = ui.createErrorMessage(
            "통계 조회 실패",
            res.error || "해당 링크의 통계 정보를 찾을 수 없습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const statsCard = ui.createStatsCard(res.stats);
        await interaction.editReply(statsCard);
        return;
      }

      // 7. /link delete
      if (subcommand === "delete") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const slug = interaction.options.getString("slug", true).trim();

        if (!verifyOwnership(slug, interaction.user.id)) {
          const errEmbed = ui.createErrorMessage(
            "삭제 권한 없음",
            `\`/${slug}\` 링크를 삭제할 권한이 없습니다. 본인이 생성한 링크만 삭제할 수 있습니다.`,
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const res = await sinkClient.deleteLink(slug);
        if (!res.success) {
          const errEmbed = ui.createErrorMessage(
            "삭제 실패",
            res.error || "링크 삭제 중 오류가 발생했습니다.",
          );
          await interaction.editReply(errEmbed);
          return;
        }

        const successEmbed = ui.createSuccessMessage(
          "링크 삭제 완료",
          `단축 링크 \`/${slug}\`이(가) 성공적으로 영구 삭제되었습니다.`,
        );
        await interaction.editReply(successEmbed);
        return;
      }

      // 8. /link check
      if (subcommand === "check") {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const targetUrl = interaction.options.getString("url", true).trim();

        const checkResult = await sinkClient.checkUrlHealth(targetUrl);
        if (checkResult.isAlive) {
          const successEmbed = ui.createSuccessMessage(
            "웹사이트 정상 작동",
            `**타겟 URL:** ${checkResult.url}\n**HTTP 상태:** \`${checkResult.status} ${checkResult.statusText}\`\n**응답 속도:** \`${checkResult.responseTimeMs}ms\`\n**콘텐츠 타입:** \`${checkResult.contentType || "알 수 없음"}\``,
          );
          await interaction.editReply(successEmbed);
        } else {
          const errEmbed = ui.createErrorMessage(
            "웹사이트 연결 불가 또는 오류",
            `**타겟 URL:** ${checkResult.url}\n**상태:** \`${checkResult.status !== null ? checkResult.status : "연결 실패"}\` (${checkResult.statusText})\n**경과 시간:** \`${checkResult.responseTimeMs}ms\``,
          );
          await interaction.editReply(errEmbed);
        }
        return;
      }
    } catch (error) {
      logger.error("Error executing /link command:", error);
      const errEmbed = ui.createErrorMessage(
        "명령어 실행 중 오류 발생",
        error instanceof Error
          ? error.message
          : "알 수 없는 오류가 발생했습니다.",
      );
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errEmbed);
      } else {
        await interaction.reply({ ...errEmbed, ephemeral: true });
      }
    }
  },
};

/**
 * Handles /link watch [add|remove|list] subcommands
 */
async function handleWatchCommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    const errEmbed = ui.createErrorMessage(
      "서버 전용 명령어",
      "감시 명령어는 디스코드 서버 내에서만 실행할 수 있습니다.",
    );
    await interaction.reply({ ...errEmbed, ephemeral: true });
    return;
  }

  // Permission Check: ManageGuild
  const member = interaction.member;
  if (
    !member ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    const errEmbed = ui.createErrorMessage(
      "권한 부족",
      "이 명령어를 실행하려면 `서버 관리(ManageGuild)` 권한이 필요합니다.",
    );
    await interaction.reply({ ...errEmbed, ephemeral: true });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });

  if (subcommand === "add") {
    const channel = interaction.options.getChannel("channel", true);
    const res = await watchService.addWatchChannel(
      interaction.guildId,
      channel.id,
      interaction.user.id,
    );

    if (!res.success) {
      const errEmbed = ui.createErrorMessage(
        "감시 채널 등록 실패",
        res.error || "오류가 발생했습니다.",
      );
      await interaction.editReply(errEmbed);
      return;
    }

    const successEmbed = ui.createSuccessMessage(
      "감시 채널 등록 완료",
      `<#${channel.id}> 채널이 URL 자동 단축 감시 대상에 등록되었습니다.\n이제 해당 채널에 긴 URL이 올라오면 작성자의 DM으로 즉시 단축 URL이 전송됩니다.`,
    );
    await interaction.editReply(successEmbed);
    return;
  }

  if (subcommand === "remove") {
    const channel = interaction.options.getChannel("channel", true);
    const res = await watchService.removeWatchChannel(
      interaction.guildId,
      channel.id,
    );

    if (!res.success) {
      const errEmbed = ui.createErrorMessage(
        "감시 채널 해제 실패",
        res.error || "오류가 발생했습니다.",
      );
      await interaction.editReply(errEmbed);
      return;
    }

    const successEmbed = ui.createSuccessMessage(
      "감시 채널 해제 완료",
      `<#${channel.id}> 채널이 URL 감시 대상에서 해제되었습니다.`,
    );
    await interaction.editReply(successEmbed);
    return;
  }

  if (subcommand === "list") {
    const channels = await watchService.getWatchedChannels(interaction.guildId);

    if (channels.length === 0) {
      const infoEmbed = ui.createInfoMessage(
        "감시 대상 채널 없음",
        "현재 서버에 등록된 URL 감시 채널이 없습니다.\n`/link watch add <channel>`로 등록할 수 있습니다.",
      );
      await interaction.editReply(infoEmbed);
      return;
    }

    const channelListStr = channels
      .map(
        (c, i) =>
          `${i + 1}. <#${c.channelId}> (등록자: <@${c.createdBy}>, 등록일: <t:${Math.floor(new Date(c.createdAt).getTime() / 1000)}:d>)`,
      )
      .join("\n");

    const listEmbed = ui.createSuccessMessage(
      `현재 서버의 감시 채널 목록 (${channels.length}개)`,
      channelListStr,
    );
    await interaction.editReply(listEmbed);
    return;
  }
}

/**
 * Handles /link admin [list|user|overview|delete] subcommands
 */
async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    const errEmbed = ui.createErrorMessage(
      "관리자 권한 필요",
      "이 명령어는 `.env`의 `ADMIN_USER_IDS`에 등록된 봇 관리자만 실행할 수 있습니다.",
    );
    await interaction.reply({ ...errEmbed, ephemeral: true });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });

  // 1. /link admin overview
  if (subcommand === "overview") {
    const [totalCountRes, activeCountRes, expiredCountRes, topLinksRes] =
      await Promise.all([
        sinkClient.countLinks({ status: "all" }),
        sinkClient.countLinks({ status: "active" }),
        sinkClient.countLinks({ status: "expired" }),
        sinkClient.listLinks(undefined, 1, 100),
      ]);

    const totalLinks = totalCountRes.success
      ? totalCountRes.count
      : topLinksRes.list?.length || 0;
    const activeLinks = activeCountRes.success
      ? activeCountRes.count
      : totalLinks;
    const expiredLinks = expiredCountRes.success ? expiredCountRes.count : 0;

    const sampleLinks = topLinksRes.list || [];
    let totalClicks = 0;
    for (const l of sampleLinks) {
      totalClicks += l.clicks ?? 0;
    }

    const topLinks = [...sampleLinks]
      .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
      .slice(0, 5);

    const topLines = topLinks.map((l, i) => {
      const full = sinkClient.getFullShortUrl(l.slug);
      const truncated =
        l.url.length > 45 ? `${l.url.substring(0, 42)}...` : l.url;
      return `**${i + 1}.** [/${l.slug}](${full}) - \`${(l.clicks ?? 0).toLocaleString()} clicks\`\n   ↳ [🌐 원본 열기 ↗](${l.url}) • \`${truncated}\``;
    });

    const desc = [
      `📊 **총 등록 링크 수:** \`${totalLinks.toLocaleString()}\`개`,
      `🟢 **활성 링크 수:** \`${activeLinks.toLocaleString()}\`개`,
      `🔴 **만료된 링크 수:** \`${expiredLinks.toLocaleString()}\`개`,
      `🖱️ **상위 링크 샘플 클릭 수:** \`${totalClicks.toLocaleString()}\`회`,
      "",
      "🏆 **최다 클릭 TOP 5 링크 (상위 샘플 기준):**",
      topLines.length > 0 ? topLines.join("\n") : "_등록된 링크가 없습니다._",
    ].join("\n");

    const overviewEmbed = ui.createSuccessMessage(
      "Sink 인스턴스 전체 통계 현황",
      desc,
    );
    await interaction.editReply(overviewEmbed);
    return;
  }

  // 2. /link admin list
  if (subcommand === "list") {
    const inputTag = interaction.options.getString("tag")?.trim();
    const query =
      interaction.options.getString("query")?.toLowerCase().trim() || undefined;
    const page = interaction.options.getInteger("page") || 1;
    const cleanTag = inputTag ? inputTag.replace(/^#/, "").trim() : undefined;

    const [countRes, res] = await Promise.all([
      sinkClient.countLinks({
        q: query,
        tag: cleanTag || undefined,
        status: "all",
      }),
      query
        ? sinkClient.searchLinks({
            q: query,
            tag: cleanTag || undefined,
            status: "all",
            limit: 1000,
          })
        : sinkClient.listLinks(
            cleanTag
              ? { tag: cleanTag, status: "all", limit: 1000 }
              : undefined,
            1,
            1000,
          ),
    ]);

    if (!res.success) {
      const errEmbed = ui.createErrorMessage(
        "목록 조회 실패",
        res.error || "오류가 발생했습니다.",
      );
      await interaction.editReply(errEmbed);
      return;
    }

    let links = res.list || [];

    // Filter by tag (client-side guarantee)
    if (cleanTag) {
      const lowerTag = cleanTag.toLowerCase();
      links = links.filter((l) => {
        if (!l.tag) return false;
        const linkTag = l.tag.toLowerCase().replace(/^#/, "");
        const tagList = linkTag.split(/[\s,]+/).map((t) => t.trim());
        return tagList.includes(lowerTag) || linkTag.includes(lowerTag);
      });
    }

    // Filter by query (if any client-side extra match needed)
    if (query) {
      links = links.filter(
        (l) =>
          l.slug.toLowerCase().includes(query) ||
          l.url.toLowerCase().includes(query) ||
          (l.title && l.title.toLowerCase().includes(query)),
      );
    }

    if (links.length === 0) {
      const infoEmbed = ui.createInfoMessage(
        "링크 없음",
        query
          ? `검색어 \`${query}\`에 일치하는 링크가 없습니다.`
          : inputTag
            ? `태그 \`#${inputTag.replace(/^#/, "")}\`에 해당하는 링크가 없습니다.`
            : "인스턴스에 등록된 링크가 없습니다.",
      );
      await interaction.editReply(infoEmbed);
      return;
    }

    const pageSize = 5;
    const totalPages = Math.ceil(links.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * pageSize;
    const paginated = links.slice(startIndex, startIndex + pageSize);

    const lines = paginated.map((l, idx) => {
      const full = sinkClient.getFullShortUrl(l.slug);
      const titlePart = l.title ? ` - **${l.title}**` : "";
      const clickPart = `(\`${(l.clicks ?? 0).toLocaleString()}\` clicks)`;
      const truncated =
        l.url.length > 50 ? `${l.url.substring(0, 47)}...` : l.url;
      return `**${startIndex + idx + 1}.** [/${l.slug}](${full})${titlePart} ${clickPart}\n   ↳ [🌐 원본 열기 ↗](${l.url}) • \`${truncated}\``;
    });

    const totalCount = countRes.success ? countRes.count : links.length;
    const isCapped = totalCount > links.length;
    const totalCountLabel = isCapped
      ? `${totalCount.toLocaleString()}개 중 상위 ${links.length.toLocaleString()}개`
      : `${links.length.toLocaleString()}개`;

    const listEmbed = ui.createSuccessMessage(
      `전체 링크 목록 (총 ${totalCountLabel} / 페이지 ${currentPage}/${totalPages})`,
      lines.join("\n\n"),
    );
    await interaction.editReply(listEmbed);
    return;
  }

  // 3. /link admin user
  if (subcommand === "user") {
    const targetUser = interaction.options.getUser("user", true);
    const inputTag = interaction.options.getString("tag")?.trim();
    const page = interaction.options.getInteger("page") || 1;
    const userHash = getUserHash(targetUser.id);
    const cleanTag = inputTag ? inputTag.replace(/^#/, "").trim() : undefined;

    const res = await sinkClient.searchLinks({
      q: userHash,
      tag: cleanTag || undefined,
      status: "all",
      limit: 1000,
    });

    if (!res.success) {
      const errEmbed = ui.createErrorMessage(
        "유저 링크 조회 실패",
        res.error || "오류가 발생했습니다.",
      );
      await interaction.editReply(errEmbed);
      return;
    }

    const userHashLower = userHash.toLowerCase();
    let userLinks = res.list.filter((l) => {
      if (!l.slug) return false;
      const slugLower = l.slug.toLowerCase();
      return (
        slugLower.endsWith(`-${userHashLower}`) || slugLower === userHashLower
      );
    });

    // Filter by tag
    if (cleanTag) {
      const lowerTag = cleanTag.toLowerCase();
      userLinks = userLinks.filter((l) => {
        if (!l.tag) return false;
        const linkTag = l.tag.toLowerCase().replace(/^#/, "");
        const tagList = linkTag.split(/[\s,]+/).map((t) => t.trim());
        return tagList.includes(lowerTag) || linkTag.includes(lowerTag);
      });
    }

    if (userLinks.length === 0) {
      const infoEmbed = ui.createInfoMessage(
        "유저 링크 없음",
        inputTag
          ? `<@${targetUser.id}> 님이 생성한 링크 중 태그 \`#${inputTag.replace(/^#/, "")}\`에 해당하는 링크가 없습니다.`
          : `<@${targetUser.id}> (\`userHash: ${userHash}\`) 유저가 생성한 링크가 없습니다.`,
      );
      await interaction.editReply(infoEmbed);
      return;
    }

    const pageSize = 5;
    const totalPages = Math.ceil(userLinks.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * pageSize;
    const paginated = userLinks.slice(startIndex, startIndex + pageSize);

    const lines = paginated.map((l, idx) => {
      const full = sinkClient.getFullShortUrl(l.slug);
      const titlePart = l.title ? ` - **${l.title}**` : "";
      const clickPart = `(\`${(l.clicks ?? 0).toLocaleString()}\` clicks)`;
      const truncated =
        l.url.length > 50 ? `${l.url.substring(0, 47)}...` : l.url;
      return `**${startIndex + idx + 1}.** [/${l.slug}](${full})${titlePart} ${clickPart}\n   ↳ [🌐 원본 열기 ↗](${l.url}) • \`${truncated}\``;
    });

    const userDisplayName = targetUser.displayName || targetUser.username;
    const headerInfo = `> 👤 **대상 유저:** <@${targetUser.id}> (\`userHash: ${userHash}\`)\n\n`;

    const listEmbed = ui.createSuccessMessage(
      `${userDisplayName} 님의 링크 목록 (총 ${userLinks.length}개 / 페이지 ${currentPage}/${totalPages})`,
      headerInfo + lines.join("\n\n"),
    );
    await interaction.editReply(listEmbed);
    return;
  }

  // 4. /link admin delete
  if (subcommand === "delete") {
    const slug = interaction.options.getString("slug", true).trim();
    const cleanSlug = slug.startsWith("/") ? slug.substring(1) : slug;

    const res = await sinkClient.deleteLink(cleanSlug);
    if (!res.success) {
      const errEmbed = ui.createErrorMessage(
        "관리자 강제 삭제 실패",
        res.error || "링크 삭제 중 오류가 발생했습니다.",
      );
      await interaction.editReply(errEmbed);
      return;
    }

    const successEmbed = ui.createSuccessMessage(
      "관리자 강제 삭제 완료",
      `단축 링크 \`/${cleanSlug}\`이(가) 관리자 권한으로 영구 삭제되었습니다.`,
    );
    await interaction.editReply(successEmbed);
    return;
  }
}

/**
 * Handles /link config [key] [value] subcommand
 */
async function handleConfigCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });

  const key = interaction.options.getString("key")?.trim().toLowerCase();
  const value = interaction.options.getString("value")?.trim();

  const currentConfig = userConfigService.getUserConfig(interaction.user.id);

  // 1. No key passed -> show interactive Config Panel
  if (!key) {
    const view = ui.createConfigPanelView(interaction.user, currentConfig);
    await interaction.editReply(view);
    return;
  }

  // 2. Key passed without value -> show current value notice + Config Panel
  if (value === undefined || value === null || value === "") {
    let noticeDesc = "";
    if (key === "auto_dm") {
      const modeLabel =
        currentConfig.autoDmMode === "inherit"
          ? "상속 (서버 설정 따름)"
          : currentConfig.autoDmMode === "on"
            ? "항상 켬 (전체 채널)"
            : "항상 끔";
      noticeDesc = `현재 \`auto_dm\` 설정값은 **${currentConfig.autoDmMode}** (${modeLabel}) 입니다.`;
    } else if (key === "dm_format") {
      const fmtLabel =
        currentConfig.dmFormat === "replace"
          ? "본문 치환 (기본값)"
          : "URL 목록 나열";
      noticeDesc = `현재 \`dm_format\` 설정값은 **${currentConfig.dmFormat}** (${fmtLabel}) 입니다.`;
    } else {
      noticeDesc = `알 수 없는 설정 키입니다: \`${key}\` (지원 키: \`auto_dm\`, \`dm_format\`)`;
    }

    const view = ui.createConfigPanelView(interaction.user, currentConfig, {
      title: "현재 설정 조회",
      description: noticeDesc,
      type: key === "auto_dm" || key === "dm_format" ? "info" : "error",
    });
    await interaction.editReply(view);
    return;
  }

  // 3. Both key and value passed -> validate and update
  if (key === "auto_dm") {
    const normalized = normalizeAutoDmMode(value);
    if (!normalized) {
      const view = ui.createConfigPanelView(interaction.user, currentConfig, {
        title: "잘못된 설정 값",
        description: `\`auto_dm\` 설정 값은 \`inherit\`, \`on\`(또는 \`true\`), \`off\`(또는 \`false\`) 중 하나여야 합니다.\n입력값: \`${value}\``,
        type: "error",
      });
      await interaction.editReply(view);
      return;
    }

    const res = await userConfigService.setUserConfig(interaction.user.id, {
      autoDmMode: normalized,
    });
    if (!res.success) {
      const view = ui.createConfigPanelView(interaction.user, res.config, {
        title: "설정 변경 실패",
        description: res.error || "데이터베이스 저장 중 오류가 발생했습니다.",
        type: "error",
      });
      await interaction.editReply(view);
      return;
    }

    const view = ui.createConfigPanelView(interaction.user, res.config, {
      title: "설정 변경 완료",
      description: `자동 DM 모드가 **${normalized}** (으)로 성공적으로 변경되었습니다.`,
      type: "success",
    });
    await interaction.editReply(view);
    return;
  }

  if (key === "dm_format") {
    const normalized = normalizeDmFormat(value);
    if (!normalized) {
      const view = ui.createConfigPanelView(interaction.user, currentConfig, {
        title: "잘못된 설정 값",
        description: `\`dm_format\` 설정 값은 \`replace\`(본문 치환) 또는 \`list\`(단축 URL 목록) 이어야 합니다.\n입력값: \`${value}\``,
        type: "error",
      });
      await interaction.editReply(view);
      return;
    }

    const res = await userConfigService.setUserConfig(interaction.user.id, {
      dmFormat: normalized,
    });
    if (!res.success) {
      const view = ui.createConfigPanelView(interaction.user, res.config, {
        title: "설정 변경 실패",
        description: res.error || "데이터베이스 저장 중 오류가 발생했습니다.",
        type: "error",
      });
      await interaction.editReply(view);
      return;
    }

    const view = ui.createConfigPanelView(interaction.user, res.config, {
      title: "설정 변경 완료",
      description: `DM 메시지 포맷이 **${normalized}** (으)로 성공적으로 변경되었습니다.`,
      type: "success",
    });
    await interaction.editReply(view);
    return;
  }

  // Unknown key
  const view = ui.createConfigPanelView(interaction.user, currentConfig, {
    title: "알 수 없는 설정 키",
    description: `지원하지 않는 설정 키입니다: \`${key}\` (지원 키: \`auto_dm\`, \`dm_format\`)`,
    type: "error",
  });
  await interaction.editReply(view);
}

/**
 * Handles Autocomplete for /link config command
 */
export async function handleConfigAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);

  if (focused.name === "key") {
    const keyChoices = [
      {
        name: "auto_dm (자동 DM 수신 모드: inherit / on / off)",
        value: "auto_dm",
      },
      {
        name: "dm_format (DM 메시지 포맷: replace / list)",
        value: "dm_format",
      },
    ];
    const filtered = keyChoices.filter(
      (c) =>
        c.name.toLowerCase().includes(focused.value.toLowerCase()) ||
        c.value.toLowerCase().includes(focused.value.toLowerCase()),
    );
    await interaction.respond(filtered.slice(0, 25));
    return;
  }

  if (focused.name === "value") {
    const selectedKey = interaction.options
      .getString("key")
      ?.trim()
      .toLowerCase();

    let valueChoices: Array<{ name: string; value: string }> = [];

    if (selectedKey === "auto_dm") {
      valueChoices = [
        { name: "inherit - 서버 설정 따름 (기본값)", value: "inherit" },
        { name: "on - 모든 채널에서 항상 켬 (전역)", value: "on" },
        { name: "off - 항상 끔 (완전 비활성화)", value: "off" },
        { name: "true - 켜기 (on)", value: "true" },
        { name: "false - 끄기 (off)", value: "false" },
      ];
    } else if (selectedKey === "dm_format") {
      valueChoices = [
        { name: "replace - 메시지 본문 치환 (기본값)", value: "replace" },
        { name: "list - 단축 URL 목록 나열 (모바일 최적화)", value: "list" },
      ];
    } else {
      valueChoices = [
        { name: "auto_dm: inherit (서버 설정 따름)", value: "inherit" },
        { name: "auto_dm: on (항상 켬)", value: "on" },
        { name: "auto_dm: off (항상 끔)", value: "off" },
        { name: "dm_format: replace (본문 치환)", value: "replace" },
        { name: "dm_format: list (URL 목록)", value: "list" },
      ];
    }

    const filtered = valueChoices.filter(
      (c) =>
        c.name.toLowerCase().includes(focused.value.toLowerCase()) ||
        c.value.toLowerCase().includes(focused.value.toLowerCase()),
    );
    await interaction.respond(filtered.slice(0, 25));
    return;
  }
}
