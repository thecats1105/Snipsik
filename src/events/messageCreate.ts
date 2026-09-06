import { Message, MessageFlags } from "discord.js";
import { config } from "@/config";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { generateSlug, verifyOwnership } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";
import { ui } from "@/utils/ui";
import { logger } from "@/utils/logger";

// URL extraction regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export async function onMessageCreate(message: Message): Promise<void> {
  // Ignore bot messages and webhooks
  if (message.author.bot || message.webhookId) return;

  // Only check guild messages
  if (!message.guildId || !message.guild) return;

  // Fast O(1) in-memory check if user wants DM (tri-state override + channel watch)
  const isChannelWatched = watchService.isWatched(
    message.guildId,
    message.channelId,
  );
  if (
    !userConfigService.shouldProcessUser(message.author.id, isChannelWatched)
  ) {
    return;
  }

  const content = message.content;
  if (!content) return;

  const matches = content.match(URL_REGEX);
  if (!matches || matches.length === 0) return;

  const sinkHostname = new URL(config.SINK_BASE_URL).hostname.toLowerCase();

  // 1. Extract valid URLs in order of appearance (deduplicating identical URLs while preserving order)
  const seenUrls = new Set<string>();
  const validUrls: string[] = [];

  for (const rawUrl of matches) {
    try {
      const parsedUrl = new URL(rawUrl);

      // Skip if URL is already pointing to our Sink instance (prevent loop)
      if (parsedUrl.hostname.toLowerCase() === sinkHostname) {
        continue;
      }

      // Skip very short URLs (e.g. less than 15 chars) to avoid unnecessary shortening
      if (rawUrl.length < 15) {
        continue;
      }

      if (!seenUrls.has(rawUrl)) {
        seenUrls.add(rawUrl);
        validUrls.push(rawUrl);
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  if (validUrls.length === 0) return;

  logger.info(
    `Watched channel detected ${validUrls.length} URL(s) from user ${message.author.tag} in #${(message.channel as { name?: string }).name || message.channelId}`,
  );

  // 2. Shorten URLs sequentially to strictly guarantee order
  const shortenedItems: Array<{
    originalUrl: string;
    shortenedUrl: string;
    slug: string;
    isReused?: boolean;
  }> = [];

  for (const originalUrl of validUrls) {
    try {
      let resolvedSlug: string | null = null;
      let isReused = false;

      // 1. Check if an active short link already exists for this user and URL
      try {
        const searchRes = await sinkClient.searchLinks({
          url: originalUrl,
          status: "active",
          limit: 20,
        });

        if (searchRes.success && searchRes.list && searchRes.list.length > 0) {
          const userLinks = searchRes.list.filter((l) =>
            verifyOwnership(l.slug, message.author.id),
          );

          if (userLinks.length > 0) {
            userLinks.sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return timeB - timeA;
            });

            const existingLink = userLinks[0];
            if (existingLink && existingLink.slug) {
              resolvedSlug = existingLink.slug;
              isReused = true;
              logger.info(
                `Reusing existing short link /${resolvedSlug} for ${message.author.tag} (${originalUrl})`,
              );
            }
          }
        }
      } catch (searchErr) {
        logger.warn(
          `Failed to search existing links for URL ${originalUrl}, falling back to creation:`,
          searchErr,
        );
      }

      // 2. If no existing active link was found, create a new one
      if (!resolvedSlug) {
        const slug = generateSlug(message.author.id);
        const res = await sinkClient.createLink({
          url: originalUrl,
          slug,
        });

        if (res.success && res.link) {
          resolvedSlug = res.link.slug || slug;
          isReused = false;
        } else {
          logger.warn(
            `Failed to auto-shorten URL for ${message.author.tag}: ${res.error}`,
          );
        }
      }

      if (resolvedSlug) {
        const shortenedUrl = sinkClient.getFullShortUrl(resolvedSlug);
        shortenedItems.push({
          originalUrl,
          shortenedUrl,
          slug: resolvedSlug,
          isReused,
        });
      }
    } catch (err) {
      logger.error("Error auto-shortening URL:", err);
    }
  }

  if (shortenedItems.length === 0) return;

  try {
    const userConfig = userConfigService.getUserConfig(message.author.id);
    const dmChannel = await message.author.createDM();
    let embedSent = false;
    let textSentCount = 0;

    // 1. Send DM Card (Components v2 Container Card)
    try {
      const dmView = ui.createWatchDmCard(
        shortenedItems,
        message.url,
        userConfig.dmFormat,
      );
      const cardMsg = await dmChannel.send(dmView);
      if (!cardMsg.flags.has(MessageFlags.SuppressEmbeds)) {
        await cardMsg.suppressEmbeds(true);
      }
      embedSent = true;
    } catch (embedErr) {
      logger.warn(
        `Failed to send watch DM card to ${message.author.tag}:`,
        embedErr,
      );
    }

    // 2. Send 2nd message based on user format preference
    if (userConfig.dmFormat === "replace") {
      // Reconstructed message with URLs replaced
      const reconstructed = userConfigService.replaceUrlsInText(
        content,
        shortenedItems,
      );
      const chunks = userConfigService.chunkText(reconstructed, 2000);

      for (const chunk of chunks) {
        try {
          const sentMsg = await dmChannel.send({
            content: chunk,
            flags: MessageFlags.SuppressEmbeds,
          });
          if (!sentMsg.flags.has(MessageFlags.SuppressEmbeds)) {
            await sentMsg.suppressEmbeds(true);
          }
          textSentCount++;
        } catch (textErr) {
          logger.warn(
            `Failed to send replaced message chunk to ${message.author.tag}:`,
            textErr,
          );
        }
      }

      if (embedSent && textSentCount === chunks.length) {
        logger.success(
          `Successfully sent replaced message DM (${chunks.length} chunk(s)) to ${message.author.tag}`,
        );
      } else if (embedSent || textSentCount > 0) {
        logger.warn(
          `Partially sent replaced message DM to ${message.author.tag} (Embed: ${embedSent ? "OK" : "Failed"}, Chunks: ${textSentCount}/${chunks.length})`,
        );
      } else {
        logger.error(
          `Failed to deliver replaced message DM to ${message.author.tag}`,
        );
      }
    } else {
      // Legacy: Send Pure Plain Text URLs sequentially (Mobile Long-press copy optimization)
      for (const item of shortenedItems) {
        try {
          const sentMsg = await dmChannel.send({
            content: item.shortenedUrl,
            flags: MessageFlags.SuppressEmbeds,
          });
          if (!sentMsg.flags.has(MessageFlags.SuppressEmbeds)) {
            await sentMsg.suppressEmbeds(true);
          }
          textSentCount++;
        } catch (textErr) {
          logger.warn(
            `Failed to send plain text URL ${item.shortenedUrl} to ${message.author.tag}:`,
            textErr,
          );
        }
      }

      if (embedSent && textSentCount === shortenedItems.length) {
        logger.success(
          `Successfully sent all ${shortenedItems.length} auto-shortened link(s) DM to ${message.author.tag}`,
        );
      } else if (embedSent || textSentCount > 0) {
        logger.warn(
          `Partially sent auto-shortened link(s) DM to ${message.author.tag} (Embed: ${embedSent ? "OK" : "Failed"}, URLs: ${textSentCount}/${shortenedItems.length})`,
        );
      } else {
        logger.error(
          `Failed to deliver any auto-shortened link(s) DM to ${message.author.tag}`,
        );
      }
    }
  } catch (err) {
    logger.error(`Failed to open DM channel with ${message.author.tag}:`, err);
  }
}
