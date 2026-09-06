import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

export const watchChannels = pgTable("watch_channels", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const guildConfigs = pgTable(
  "guild_configs",
  {
    guildId: text("guild_id").primaryKey(),
    autoShortenEnabled: boolean("auto_shorten_enabled").default(true).notNull(),
    autoShortenMinUrlLength: integer("auto_shorten_min_url_length"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "guild_configs_min_url_len_check",
      sql`${table.autoShortenMinUrlLength} >= 0 AND ${table.autoShortenMinUrlLength} <= 2048`,
    ),
  ],
);

export const userConfigs = pgTable(
  "user_configs",
  {
    userId: text("user_id").primaryKey(),
    autoDmMode: text("auto_dm_mode").default("inherit").notNull(),
    dmFormat: text("dm_format").default("replace").notNull(),
    autoShortenMinUrlLength: integer("auto_shorten_min_url_length"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "user_configs_min_url_len_check",
      sql`${table.autoShortenMinUrlLength} >= 0 AND ${table.autoShortenMinUrlLength} <= 2048`,
    ),
  ],
);

export type WatchChannel = typeof watchChannels.$inferSelect;
export type NewWatchChannel = typeof watchChannels.$inferInsert;
export type GuildConfig = typeof guildConfigs.$inferSelect;
export type NewGuildConfig = typeof guildConfigs.$inferInsert;
export type UserConfig = typeof userConfigs.$inferSelect;
export type NewUserConfig = typeof userConfigs.$inferInsert;
