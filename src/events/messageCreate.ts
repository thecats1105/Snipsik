import { Message, MessageFlags } from "discord.js";
import { config } from "@/config";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { generateSlug, verifyOwnership } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";
import { ui } from "@/utils/ui";
import { logger } from "@/utils/logger";

// URL extraction regex (permits query string pipes | while excluding whitespace, angle/curly brackets, backticks, quotes, and backslashes)
const URL_REGEX = /https?:\/\/[^\s<>"^`{}\\]+/gi;

/**
 * Trims trailing delimiters and formatting characters from extracted URLs.
 * Handles Discord spoiler tags (||), unbalanced closing parentheses/brackets,
 * while preserving valid query parameters and path structures.
 *
 * @param rawUrl - The raw extracted URL candidate.
 * @returns The sanitized URL string.
 */
export function cleanExtractedUrl(rawUrl: string): string {
  let url = rawUrl;

  // 1. Strip trailing pipe characters (e.g. from Discord || spoiler tags)
  while (url.endsWith("|")) {
    url = url.slice(0, -1);
  }

  // 2. Strip unbalanced closing parentheses or brackets (e.g. "(https://...)" or "[https://...]")
  while (url.endsWith(")") || url.endsWith("]")) {
    const lastChar = url.slice(-1);
    const openChar = lastChar === ")" ? "(" : "[";
    const openCount = (url.match(new RegExp(`\\${openChar}`, "g")) || [])
      .length;
    const closeCount = (url.match(new RegExp(`\\${lastChar}`, "g")) || [])
      .length;
    if (closeCount > openCount) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }

  return url;
}

/**
 * Sanitizes a URL for logging by removing sensitive query parameters and fragments.
 *
 * @param rawUrl - The raw target URL.
 * @returns The sanitized URL string containing only the origin and pathname.
 */
function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

/**
 * In-flight short link lookups/creations keyed by `${userId}:${originalUrl}`
 * to prevent duplicate link generation during concurrent messages.
 */
const inFlightShortens = new Map<
  string,
  Promise<{ slug: string; isReused: boolean } | null>
>();

/**
 * Resolves a short link for a given URL and user, either by reusing an existing
 * active link owned by the user or creating a new one. Deduplicates concurrent calls.
 *
 * @param userId - Discord user snowflake ID
 * @param userTag - Discord user display tag for logging
 * @param originalUrl - Target URL to shorten or reuse
 * @returns The resolved slug and whether it was reused, or null on failure
 */
async function resolveShortLink(
  userId: string,
  userTag: string,
  originalUrl: string,
): Promise<{ slug: string; isReused: boolean } | null> {
  const inFlightKey = `${userId}:${originalUrl}`;
  const existingPromise = inFlightShortens.get(inFlightKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
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
          verifyOwnership(l.slug, userId),
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
              `Reusing existing short link /${resolvedSlug} for ${userTag} (${sanitizeUrlForLog(originalUrl)})`,
            );
          }
        }
      }
    } catch (searchErr) {
      logger.warn(
        `Failed to search existing links for URL ${sanitizeUrlForLog(originalUrl)}, falling back to creation:`,
        searchErr,
      );
    }

    // 2. If no existing active link was found, create a new one
    if (!resolvedSlug) {
      const slug = generateSlug(userId);
      const res = await sinkClient.createLink({
        url: originalUrl,
        slug,
      });

      if (res.success && res.link) {
        resolvedSlug = res.link.slug || slug;
        isReused = false;
      } else {
        logger.warn(`Failed to auto-shorten URL for ${userTag}: ${res.error}`);
      }
    }

    if (resolvedSlug) {
      return { slug: resolvedSlug, isReused };
    }
    return null;
  })();

  inFlightShortens.set(inFlightKey, promise);
  try {
    return await promise;
  } finally {
    inFlightShortens.delete(inFlightKey);
  }
}

/**
 * Handles the `messageCreate` Discord event.
 * Detects URLs in watched channels, reuses or creates short links via Sink API,
 * and sends direct messages (DM) with shortened URLs according to user preferences.
 *
 * @param message - The Discord message event payload.
 */
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
  const effectiveMinLength = guildConfigService.resolveEffectiveMinUrlLength(
    message.guildId,
    message.author.id,
  );

  // 1. Extract valid URLs in order of appearance (deduplicating identical URLs while preserving order)
  const seenUrls = new Set<string>();
  const validUrls: string[] = [];

  for (const rawMatch of matches) {
    const rawUrl = cleanExtractedUrl(rawMatch);
    try {
      const parsedUrl = new URL(rawUrl);

      // Skip if URL is already pointing to our Sink instance (prevent loop)
      if (parsedUrl.hostname.toLowerCase() === sinkHostname) {
        continue;
      }

      // Skip URLs shorter than effective minimum length
      if (rawUrl.length < effectiveMinLength) {
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
      const result = await resolveShortLink(
        message.author.id,
        message.author.tag,
        originalUrl,
      );

      if (result) {
        const shortenedUrl = sinkClient.getFullShortUrl(result.slug);
        shortenedItems.push({
          originalUrl,
          shortenedUrl,
          slug: result.slug,
          isReused: result.isReused,
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
