import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const watchChannels = pgTable("watch_channels", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const guildConfigs = pgTable("guild_configs", {
  guildId: text("guild_id").primaryKey(),
  autoShortenEnabled: boolean("auto_shorten_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userConfigs = pgTable("user_configs", {
  userId: text("user_id").primaryKey(),
  autoDmMode: text("auto_dm_mode").default("inherit").notNull(),
  dmFormat: text("dm_format").default("replace").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type WatchChannel = typeof watchChannels.$inferSelect;
export type NewWatchChannel = typeof watchChannels.$inferInsert;
export type GuildConfig = typeof guildConfigs.$inferSelect;
export type NewGuildConfig = typeof guildConfigs.$inferInsert;
export type UserConfig = typeof userConfigs.$inferSelect;
export type NewUserConfig = typeof userConfigs.$inferInsert;
