import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { SinkLink } from "@/types/sink";

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface UserDashboardStats {
  totalLinks: number;
  activeLinks: number;
  expiredLinks: number;
  totalClicks: number;
  links: SinkLink[];
}

export const CustomId = {
  DASHBOARD_CREATE_BTN: "dash:create_btn",
  DASHBOARD_SELECT_LINK: "dash:select_link",
  DASHBOARD_EDIT_BTN: "dash:edit_btn",
  DASHBOARD_DELETE_BTN: "dash:delete_btn",
  DASHBOARD_REFRESH_BTN: "dash:refresh_btn",
  DASHBOARD_CONFIG_BTN: "dash:config_btn",
  DASHBOARD_CONFIRM_DELETE_BTN: "dash:confirm_del_btn",
  DASHBOARD_CANCEL_DELETE_BTN: "dash:cancel_del_btn",
  CONFIG_DM_INHERIT: "cfg:dm:inherit",
  CONFIG_DM_ON: "cfg:dm:on",
  CONFIG_DM_OFF: "cfg:dm:off",
  CONFIG_FMT_REPLACE: "cfg:fmt:replace",
  CONFIG_FMT_LIST: "cfg:fmt:list",
  CONFIG_NAV_DASHBOARD: "cfg:nav:dash",
  MODAL_CREATE_LINK: "modal:create_link",
  MODAL_EDIT_LINK: "modal:edit_link",
} as const;
