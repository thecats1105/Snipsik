import { ActivityType, Client, REST, Routes } from "discord.js";
import { config } from "@/config";
import { linkCommand } from "@/commands/link";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { testDbConnection } from "@/db";
import { logger } from "@/utils/logger";

/**
 * Handles the Discord client ready event.
 * Initializes presence, warms up database caches, and syncs application slash commands.
 *
 * @param client - Ready Discord client instance
 */
export async function onReady(client: Client<true>): Promise<void> {
  logger.success(`Logged in as ${client.user.tag} (ID: ${client.user.id})`);

  // Set activity
  client.user.setPresence({
    activities: [
      {
        name: "/link dashboard",
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });

  // Initialize DB and load Watcher, UserConfig, and GuildConfig cache
  const dbOk = await testDbConnection();
  if (dbOk) {
    await watchService.loadCache();
    try {
      await userConfigService.loadCache();
    } catch (err) {
      logger.error(
        "Failed to load UserConfig cache on startup; failing closed for auto-DM until cache is loaded:",
        err,
      );
    }
    try {
      await guildConfigService.loadCache();
    } catch (err) {
      logger.error(
        "Failed to load GuildConfig cache on startup; failing back to ENV defaults:",
        err,
      );
    }
  }

  // Register Slash Commands
  try {
    logger.info("Registering slash commands with Discord REST API...");
    const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

    const commands = [linkCommand.data.toJSON()];

    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
      body: commands,
    });

    logger.success(
      `Successfully registered ${commands.length} application commands globally.`,
    );
  } catch (error) {
    logger.error("Failed to register application commands:", error);
  }
}
