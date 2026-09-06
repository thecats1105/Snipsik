import { type Interaction } from "discord.js";
import { CustomId } from "@/types/bot";
import {
  fetchUserDashboardStats,
  handleConfigAutocomplete,
  linkCommand,
} from "@/commands/link";
import { sinkClient } from "@/services/sinkClient";
import { generateSlug, verifyOwnership } from "@/services/slugManager";
import { userConfigService } from "@/services/userConfigService";
import { ui } from "@/utils/ui";
import { createEditLinkModal, createLinkModal } from "@/utils/modals";
import { parseExpiration } from "@/utils/time";
import { logger } from "@/utils/logger";

export async function onInteractionCreate(
  interaction: Interaction,
): Promise<void> {
  try {
    // 0. Autocomplete Interactions
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "link") {
        await handleConfigAutocomplete(interaction);
      }
      return;
    }

    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "link") {
        await linkCommand.execute(interaction);
      }
      return;
    }

    // 2. Button Interactions
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // Create Button -> Show Create Modal
      if (customId === CustomId.DASHBOARD_CREATE_BTN) {
        const modal = createLinkModal();
        await interaction.showModal(modal);
        return;
      }

      // Edit Button -> Show Edit Modal
      if (customId.startsWith(CustomId.DASHBOARD_EDIT_BTN)) {
        const slug = customId.includes(":")
          ? customId.substring(CustomId.DASHBOARD_EDIT_BTN.length + 1)
          : undefined;
        if (!slug) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "오류",
              "수정할 링크를 먼저 선택해주세요.",
            ),
            ephemeral: true,
          });
          return;
        }

        if (!verifyOwnership(slug, interaction.user.id)) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "권한 없음",
              "이 링크를 수정할 권한이 없습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const linkRes = await sinkClient.getLink(slug);
        if (!linkRes.success || !linkRes.link) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "오류",
              linkRes.error || "링크 정보를 가져올 수 없습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const modal = createEditLinkModal(linkRes.link);
        await interaction.showModal(modal);
        return;
      }

      // Delete Button -> Show Confirm Dialog
      if (customId.startsWith(CustomId.DASHBOARD_DELETE_BTN)) {
        const slug = customId.includes(":")
          ? customId.substring(CustomId.DASHBOARD_DELETE_BTN.length + 1)
          : undefined;
        if (!slug) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "오류",
              "삭제할 링크를 먼저 선택해주세요.",
            ),
            ephemeral: true,
          });
          return;
        }

        if (!verifyOwnership(slug, interaction.user.id)) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "권한 없음",
              "이 링크를 삭제할 권한이 없습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const confirmView = ui.createDeleteConfirmView(slug);
        await interaction.update(confirmView);
        return;
      }

      // Confirm Delete Button -> Execute Delete
      if (customId.startsWith(CustomId.DASHBOARD_CONFIRM_DELETE_BTN)) {
        const slug = customId.includes(":")
          ? customId.substring(CustomId.DASHBOARD_CONFIRM_DELETE_BTN.length + 1)
          : undefined;
        if (!slug || !verifyOwnership(slug, interaction.user.id)) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "권한 없음",
              "이 링크를 삭제할 권한이 없습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const delRes = await sinkClient.deleteLink(slug);
        if (!delRes.success) {
          await interaction.reply({
            ...ui.createErrorMessage(
              "삭제 실패",
              delRes.error || "오류가 발생했습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        // Refresh dashboard
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats);
        await interaction.update(view);
        return;
      }

      // Cancel Delete Button -> Return to Dashboard
      if (customId === CustomId.DASHBOARD_CANCEL_DELETE_BTN) {
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats);
        await interaction.update(view);
        return;
      }

      // Refresh Button -> Update Dashboard
      if (customId.startsWith(CustomId.DASHBOARD_REFRESH_BTN)) {
        const page = customId.includes(":")
          ? parseInt(
              customId.substring(CustomId.DASHBOARD_REFRESH_BTN.length + 1),
              10,
            ) || 1
          : 1;
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(
          interaction.user,
          stats,
          undefined,
          page,
        );
        await interaction.update(view);
        return;
      }

      // Open Config Panel from Dashboard
      if (customId === CustomId.DASHBOARD_CONFIG_BTN) {
        const userConfig = userConfigService.getUserConfig(interaction.user.id);
        const view = ui.createConfigPanelView(interaction.user, userConfig);
        await interaction.update(view);
        return;
      }

      // Config Toggle: Auto DM Mode
      if (
        customId === CustomId.CONFIG_DM_INHERIT ||
        customId === CustomId.CONFIG_DM_ON ||
        customId === CustomId.CONFIG_DM_OFF
      ) {
        const targetMode =
          customId === CustomId.CONFIG_DM_INHERIT
            ? "inherit"
            : customId === CustomId.CONFIG_DM_ON
              ? "on"
              : "off";

        const res = await userConfigService.setUserConfig(interaction.user.id, {
          autoDmMode: targetMode,
        });

        const notice = res.success
          ? undefined
          : {
              title: "설정 변경 실패",
              description:
                res.error || "데이터베이스 저장 중 오류가 발생했습니다.",
              type: "error" as const,
            };

        const view = ui.createConfigPanelView(
          interaction.user,
          res.config,
          notice,
        );
        await interaction.update(view);
        return;
      }

      // Config Toggle: DM Format
      if (
        customId === CustomId.CONFIG_FMT_REPLACE ||
        customId === CustomId.CONFIG_FMT_LIST
      ) {
        const targetFormat =
          customId === CustomId.CONFIG_FMT_REPLACE ? "replace" : "list";

        const res = await userConfigService.setUserConfig(interaction.user.id, {
          dmFormat: targetFormat,
        });

        const notice = res.success
          ? undefined
          : {
              title: "설정 변경 실패",
              description:
                res.error || "데이터베이스 저장 중 오류가 발생했습니다.",
              type: "error" as const,
            };

        const view = ui.createConfigPanelView(
          interaction.user,
          res.config,
          notice,
        );
        await interaction.update(view);
        return;
      }

      // Config Navigation: Return to Dashboard
      if (customId === CustomId.CONFIG_NAV_DASHBOARD) {
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats);
        await interaction.update(view);
        return;
      }
    }

    // 3. String Select Menu Interactions
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === CustomId.DASHBOARD_SELECT_LINK) {
        const val = interaction.values[0];

        // Case A: Page Navigation (nav:page:N)
        if (val && val.startsWith("nav:page:")) {
          const targetPage =
            parseInt(val.substring("nav:page:".length), 10) || 1;
          const stats = await fetchUserDashboardStats(interaction.user.id);
          const view = ui.createDashboardView(
            interaction.user,
            stats,
            undefined,
            targetPage,
          );
          await interaction.update(view);
          return;
        }

        // Case B: Link Selection (slug:slugName:page or raw slug)
        let selectedSlug = val || "";
        let currentPage = 1;

        if (val && val.startsWith("slug:")) {
          const parts = val.split(":");
          selectedSlug = parts[1] || "";
          currentPage = parseInt(parts[2] || "1", 10) || 1;
        }

        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(
          interaction.user,
          stats,
          selectedSlug,
          currentPage,
        );
        await interaction.update(view);
        return;
      }
    }

    // 4. Modal Submit Interactions
    if (interaction.isModalSubmit()) {
      // Modal: Create Link
      if (interaction.customId === CustomId.MODAL_CREATE_LINK) {
        await interaction.deferUpdate();

        const url = interaction.fields.getTextInputValue("url");
        const expStr = interaction.fields.getTextInputValue("expiration");
        const password = interaction.fields.getTextInputValue("password");
        const tag = interaction.fields.getTextInputValue("tag");
        const title = interaction.fields.getTextInputValue("title");

        if (url && url.length > 2048) {
          await interaction.followUp({
            ...ui.createErrorMessage(
              "URL 길이 초과",
              "URL 길이는 최대 2,048자까지 허용됩니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const slug = generateSlug(interaction.user.id);
        const expiration = parseExpiration(expStr);

        const res = await sinkClient.createLink({
          url,
          slug,
          expiration,
          password: password || undefined,
          tag: tag || undefined,
          title: title || undefined,
        });

        if (!res.success) {
          await interaction.followUp({
            ...ui.createErrorMessage(
              "링크 생성 실패",
              res.error || "오류가 발생했습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        // Re-render dashboard with newly created link selected
        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats, slug);
        await interaction.editReply(view);
        return;
      }

      // Modal: Edit Link
      if (interaction.customId.startsWith(CustomId.MODAL_EDIT_LINK)) {
        await interaction.deferUpdate();
        const slug = interaction.customId.includes(":")
          ? interaction.customId.substring(CustomId.MODAL_EDIT_LINK.length + 1)
          : undefined;

        if (!slug || !verifyOwnership(slug, interaction.user.id)) {
          await interaction.followUp({
            ...ui.createErrorMessage(
              "권한 없음",
              "이 링크를 수정할 권한이 없습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const url = interaction.fields.getTextInputValue("url");
        const rawPassword = interaction.fields
          .getTextInputValue("password")
          ?.trim();
        const tag = interaction.fields.getTextInputValue("tag");
        const title = interaction.fields.getTextInputValue("title");
        const description = interaction.fields.getTextInputValue("description");

        if (url && url.length > 2048) {
          await interaction.followUp({
            ...ui.createErrorMessage(
              "URL 길이 초과",
              "URL 길이는 최대 2,048자까지 허용됩니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        let passwordPayload: string | null | undefined = undefined;
        if (
          rawPassword &&
          (rawPassword.toLowerCase() === "none" ||
            rawPassword.toLowerCase() === "clear" ||
            rawPassword === "삭제" ||
            rawPassword === "해제")
        ) {
          passwordPayload = null; // Clear password
        } else if (rawPassword && rawPassword.length > 0) {
          passwordPayload = rawPassword;
        }

        const res = await sinkClient.updateLink(slug, {
          url,
          password: passwordPayload,
          tag: tag || undefined,
          title: title || undefined,
          description: description || undefined,
        });

        if (!res.success) {
          await interaction.followUp({
            ...ui.createErrorMessage(
              "링크 수정 실패",
              res.error || "오류가 발생했습니다.",
            ),
            ephemeral: true,
          });
          return;
        }

        const stats = await fetchUserDashboardStats(interaction.user.id);
        const view = ui.createDashboardView(interaction.user, stats, slug);
        await interaction.editReply(view);
        return;
      }
    }
  } catch (error) {
    logger.error("Error in onInteractionCreate:", error);
    try {
      const errView = ui.createErrorMessage(
        "인터랙션 처리 오류",
        error instanceof Error
          ? error.message
          : "알 수 없는 오류가 발생했습니다.",
      );
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ ...errView, ephemeral: true });
        } else {
          await interaction.reply({ ...errView, ephemeral: true });
        }
      }
    } catch {
      // Ignore secondary errors
    }
  }
}
