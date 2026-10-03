import { type Message, MessageFlags } from 'discord.js'
import { z } from 'zod'
import { config } from '@/config'
import { ensureAutomaticProcessingReadiness } from '@/services/cacheReadiness'
import { guildConfigService } from '@/services/guildConfigService'
import { findOwnedLink } from '@/services/ownedLinkCatalog'
import { sinkClient } from '@/services/sinkClient'
import {
  generateSlug,
  getUserHash,
  verifyOwnership
} from '@/services/slugManager'
import { userConfigService } from '@/services/userConfigService'
import { watchService } from '@/services/watchService'
import { isDomainIgnored } from '@/utils/domain'
import { logger } from '@/utils/logger'
import { timestampToMilliseconds } from '@/utils/time'
import { convertToFixupxUrl, isTwitterDomain } from '@/utils/twitter'
import { ui } from '@/utils/ui'

const URL_START_REGEX = /https?:\/\//gi
const URL_TERMINATORS = new Set([
  '<',
  '>',
  '"',
  '^',
  '`',
  '{',
  '}',
  '\\',
  '’',
  '”',
  '。',
  '、',
  '！',
  '？',
  '…',
  '：',
  '；'
])
const TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  "'",
  '"',
  '’',
  '”',
  '。',
  '、',
  '！',
  '？',
  '…',
  '：',
  '；'
])
const UNMATCHED_MARKDOWN_DELIMITERS = new Set(['*', '_', '~'])
const SearchLimitSchema = z.number().int().min(1).max(1_000)
const EXISTING_LINK_SEARCH_LIMIT = SearchLimitSchema.parse(1_000)

export interface ExtractedDiscordUrl {
  url: string
  start: number
  end: number
}

function isInsideSpoiler(
  content: string,
  position: number,
  extractedRanges: Array<{ start: number; end: number }> = []
): boolean {
  let delimiterCount = 0
  let cursor = 0
  while ((cursor = content.indexOf('||', cursor)) !== -1 && cursor < position) {
    const isInsideExtractedUrl = extractedRanges.some(
      r => cursor >= r.start && cursor + 2 <= r.end
    )
    if (!isInsideExtractedUrl) {
      delimiterCount++
    }
    cursor += 2
  }
  return delimiterCount % 2 === 1
}

/** Extracts exact URL spans without consuming surrounding Discord markdown. */
export function extractUrlsFromDiscordMarkdown(
  content: string
): ExtractedDiscordUrl[] {
  const results: ExtractedDiscordUrl[] = []
  const regex = new RegExp(URL_START_REGEX.source, URL_START_REGEX.flags)
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const start = match.index
    const spoiler = isInsideSpoiler(content, start, results)
    let cursor = regex.lastIndex
    let parenDepth = 0
    let bracketDepth = 0

    while (cursor < content.length) {
      const char = content[cursor]
      if (
        !char ||
        /\s/.test(char) ||
        URL_TERMINATORS.has(char) ||
        (char === '*' && content[cursor + 1] === '*')
      ) {
        break
      }
      if (spoiler && char === '|') {
        let pipeCount = 1
        while (content[cursor + pipeCount] === '|') pipeCount++
        if (pipeCount >= 2) {
          cursor += pipeCount - 2
          break
        }
      }

      if (char === '(') parenDepth++
      else if (char === ')') {
        if (parenDepth === 0) break
        parenDepth--
      } else if (char === '[') bracketDepth++
      else if (char === ']') {
        if (bracketDepth === 0) break
        bracketDepth--
      }
      cursor++
    }

    // Trim trailing punctuation and unmatched markdown delimiters
    while (cursor > start) {
      const lastChar = content[cursor - 1]
      if (
        lastChar &&
        (TRAILING_PUNCTUATION.has(lastChar) ||
          UNMATCHED_MARKDOWN_DELIMITERS.has(lastChar))
      ) {
        cursor--
      } else {
        break
      }
    }

    const url = content.slice(start, cursor)
    if (url.length > match[0].length) {
      results.push({ url, start, end: cursor })
    }
    regex.lastIndex = Math.max(cursor, regex.lastIndex)
  }

  return results
}

/**
 * Checks whether two target URLs are identical, performing exact string match
 * with WHATWG canonical fallback.
 *
 * @param urlA - First target URL candidate.
 * @param urlB - Second target URL candidate.
 * @returns True if both URLs refer to the exact same target URL.
 */
export function isSameTargetUrl(
  urlA: string | null | undefined,
  urlB: string | null | undefined
): boolean {
  if (!urlA || !urlB) return false
  if (urlA === urlB) return true
  try {
    const parsedA = new URL(urlA)
    const parsedB = new URL(urlB)
    return parsedA.href === parsedB.href
  } catch {
    return false
  }
}

/**
 * Sanitizes a URL for logging by removing sensitive query parameters and fragments.
 *
 * @param rawUrl - The raw target URL.
 * @returns The sanitized URL string containing only the origin and pathname.
 */
function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

/**
 * In-flight short link lookups/creations keyed by `${userId}:${originalUrl}`
 * to prevent duplicate link generation during concurrent messages.
 */
const inFlightShortens = new Map<
  string,
  Promise<{ slug: string; isReused: boolean } | null>
>()

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
  originalUrl: string
): Promise<{ slug: string; isReused: boolean } | null> {
  const inFlightKey = `${userId}:${originalUrl}`
  const existingPromise = inFlightShortens.get(inFlightKey)
  if (existingPromise) {
    return existingPromise
  }

  const promise = (async () => {
    let resolvedSlug: string | null = null
    let isReused = false

    // 1. Check if an active short link already exists for this user and URL
    try {
      const userHash = getUserHash(userId)
      const searchRes = await sinkClient.searchLinks({
        q: userHash,
        url: originalUrl,
        status: 'active',
        limit: EXISTING_LINK_SEARCH_LIMIT
      })

      const userLinks = searchRes.success
        ? searchRes.list.filter(
            l =>
              verifyOwnership(l.slug, userId) &&
              isSameTargetUrl(l.url, originalUrl)
          )
        : []
      userLinks.sort((a, b) => {
        const timeA = timestampToMilliseconds(a.createdAt)
        const timeB = timestampToMilliseconds(b.createdAt)
        return timeB - timeA
      })

      let existingLink = userLinks[0]
      const searchMayBeTruncated =
        searchRes.success &&
        (searchRes.listComplete === false ||
          (searchRes.listComplete !== true &&
            (searchRes.total > searchRes.list.length ||
              searchRes.list.length >= EXISTING_LINK_SEARCH_LIMIT)))
      if (!existingLink && searchMayBeTruncated) {
        const lookup = await findOwnedLink(
          userHash,
          link => isSameTargetUrl(link.url, originalUrl),
          { status: 'active' }
        )
        if (lookup.success) {
          existingLink = lookup.link ?? undefined
          if (!lookup.link && !lookup.complete) {
            logger.warn(
              `Owned-link lookup reached its scan limit after ${lookup.scannedRecords} records for ${userTag} (${sanitizeUrlForLog(originalUrl)})`
            )
          }
        } else {
          logger.warn(
            `Failed to scan owned links for ${userTag} (${sanitizeUrlForLog(originalUrl)}): ${lookup.error}`
          )
        }
      }

      if (existingLink?.slug) {
        resolvedSlug = existingLink.slug
        isReused = true
        logger.info(
          `Reusing existing short link /${resolvedSlug} for ${userTag} (${sanitizeUrlForLog(originalUrl)})`
        )
      }
    } catch (searchErr) {
      logger.warn(
        `Failed to search existing links for URL ${sanitizeUrlForLog(originalUrl)}, falling back to creation:`,
        searchErr
      )
    }

    // 2. If no existing active link was found, create a new one
    if (!resolvedSlug) {
      const slug = generateSlug(userId)
      const res = await sinkClient.createLink({
        url: originalUrl,
        slug
      })

      if (res.success && res.link) {
        resolvedSlug = res.link.slug || slug
        isReused = false
      } else {
        logger.warn(`Failed to auto-shorten URL for ${userTag}: ${res.error}`)
      }
    }

    if (resolvedSlug) {
      return { slug: resolvedSlug, isReused }
    }
    return null
  })()

  inFlightShortens.set(inFlightKey, promise)
  try {
    return await promise
  } finally {
    inFlightShortens.delete(inFlightKey)
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
  if (message.author.bot || message.webhookId) return

  // Only check guild messages
  if (!message.guildId || !message.guild) return

  // Fail closed until every policy cache has either a fresh or validated stale snapshot.
  if (!ensureAutomaticProcessingReadiness()) return

  // Fast in-memory check if user wants DM (tri-state override + channel/parent watch)
  const isChannelWatched = watchService.isChannelWatched(
    message.guildId,
    message.channel
  )
  if (
    !userConfigService.shouldProcessUser(message.author.id, isChannelWatched)
  ) {
    return
  }

  const content = message.content
  if (!content) return

  const rawMatches = extractUrlsFromDiscordMarkdown(content)

  if (rawMatches.length === 0) return

  const userConfig = userConfigService.getUserConfig(message.author.id)
  const sinkHostname = new URL(config.SINK_BASE_URL).hostname.toLowerCase()
  const effectiveMinLength = guildConfigService.resolveEffectiveMinUrlLength(
    message.guildId,
    message.author.id
  )
  const effectiveIgnoredDomains =
    guildConfigService.resolveEffectiveIgnoredDomains(
      message.guildId,
      message.author.id
    )

  // 1. Extract valid URLs in order of appearance (deduplicating identical URLs while preserving order)
  const seenUrls = new Set<string>()
  const candidates: Array<
    | { type: 'fixupx'; originalUrl: string; fixupxUrl: string }
    | { type: 'shorten'; originalUrl: string }
  > = []

  for (const match of rawMatches) {
    const rawUrl = match.url
    try {
      const parsedUrl = new URL(rawUrl)

      // Skip if URL is already pointing to our Sink instance (prevent loop)
      if (parsedUrl.hostname.toLowerCase() === sinkHostname) {
        continue
      }

      if (seenUrls.has(rawUrl)) {
        continue
      }

      // Skip URLs whose domain is in effective ignored domains (GIF / Discord CDN / custom ignored domains)
      if (isDomainIgnored(parsedUrl.hostname, effectiveIgnoredDomains)) {
        continue
      }

      // Check if Twitter fixupx conversion applies
      if (userConfig.fixupxEnabled && isTwitterDomain(parsedUrl.hostname)) {
        const fixupxUrl = convertToFixupxUrl(rawUrl)
        if (fixupxUrl) {
          seenUrls.add(rawUrl)
          candidates.push({
            type: 'fixupx',
            originalUrl: rawUrl,
            fixupxUrl
          })
          continue
        }
        // Exclude non-status Twitter links (e.g. profiles, search) when fixupx is enabled
        logger.debug(
          `Skipping non-status Twitter link for ${message.author.tag}: ${sanitizeUrlForLog(rawUrl)}`
        )
        continue
      }

      // Skip URLs shorter than effective minimum length
      if (rawUrl.length < effectiveMinLength) {
        continue
      }

      seenUrls.add(rawUrl)
      candidates.push({
        type: 'shorten',
        originalUrl: rawUrl
      })
    } catch {
      // Ignore malformed URLs
    }
  }

  if (candidates.length === 0) return

  logger.info(
    `Watched channel detected ${candidates.length} target URL(s) from user ${message.author.tag} in #${(message.channel as { name?: string }).name || message.channelId}`
  )

  // 2. Process candidates sequentially (shorten or use fixupx) to strictly guarantee order
  const processedItems: Array<{
    originalUrl: string
    targetUrl: string
    type: 'shorten' | 'fixupx'
    shortenedUrl?: string
    slug?: string
    isReused?: boolean
  }> = []

  for (const candidate of candidates) {
    if (candidate.type === 'fixupx') {
      processedItems.push({
        originalUrl: candidate.originalUrl,
        targetUrl: candidate.fixupxUrl,
        shortenedUrl: candidate.fixupxUrl,
        type: 'fixupx'
      })
      continue
    }

    try {
      const result = await resolveShortLink(
        message.author.id,
        message.author.tag,
        candidate.originalUrl
      )

      if (result) {
        const shortenedUrl = sinkClient.getFullShortUrl(result.slug)
        processedItems.push({
          originalUrl: candidate.originalUrl,
          targetUrl: shortenedUrl,
          shortenedUrl,
          slug: result.slug,
          isReused: result.isReused,
          type: 'shorten'
        })
      }
    } catch (err) {
      logger.error('Error auto-shortening URL:', err)
    }
  }

  if (processedItems.length === 0) return

  try {
    const dmChannel = await message.author.createDM()
    let embedSent = false
    let textSentCount = 0

    // 1. Send DM Card (Components v2 Container Card)
    try {
      const dmView = ui.createWatchDmCard(
        processedItems,
        message.url,
        userConfig.dmFormat
      )
      const cardMsg = await dmChannel.send(dmView)
      if (!cardMsg.flags.has(MessageFlags.SuppressEmbeds)) {
        await cardMsg.suppressEmbeds(true)
      }
      embedSent = true
    } catch (embedErr) {
      logger.warn(
        `Failed to send watch DM card to ${message.author.tag}:`,
        embedErr
      )
    }

    // 2. Send 2nd message based on user format preference
    if (userConfig.dmFormat === 'replace') {
      // Reconstructed message with URLs replaced
      const { text: reconstructed, spans } =
        userConfigService.replaceUrlsInTextWithSpans(
          content,
          processedItems,
          rawMatches
        )
      const chunks = userConfigService.chunkText(reconstructed, 2000, spans)

      for (const chunk of chunks) {
        try {
          const sentMsg = await dmChannel.send({
            content: chunk,
            flags: MessageFlags.SuppressEmbeds
          })
          if (!sentMsg.flags.has(MessageFlags.SuppressEmbeds)) {
            await sentMsg.suppressEmbeds(true)
          }
          textSentCount++
        } catch (textErr) {
          logger.warn(
            `Failed to send replaced message chunk to ${message.author.tag}:`,
            textErr
          )
        }
      }

      if (embedSent && textSentCount === chunks.length) {
        logger.success(
          `Successfully sent replaced message DM (${chunks.length} chunk(s)) to ${message.author.tag}`
        )
      } else if (embedSent || textSentCount > 0) {
        logger.warn(
          `Partially sent replaced message DM to ${message.author.tag} (Embed: ${embedSent ? 'OK' : 'Failed'}, Chunks: ${textSentCount}/${chunks.length})`
        )
      } else {
        logger.error(
          `Failed to deliver replaced message DM to ${message.author.tag}`
        )
      }
    } else {
      // Legacy: Send Pure Plain Text URLs sequentially (Mobile Long-press copy optimization)
      for (const item of processedItems) {
        try {
          const sentMsg = await dmChannel.send({
            content: item.targetUrl,
            flags: MessageFlags.SuppressEmbeds
          })
          if (!sentMsg.flags.has(MessageFlags.SuppressEmbeds)) {
            await sentMsg.suppressEmbeds(true)
          }
          textSentCount++
        } catch (textErr) {
          logger.warn(
            `Failed to send plain text URL ${item.targetUrl} to ${message.author.tag}:`,
            textErr
          )
        }
      }

      if (embedSent && textSentCount === processedItems.length) {
        logger.success(
          `Successfully sent all ${processedItems.length} processed link(s) DM to ${message.author.tag}`
        )
      } else if (embedSent || textSentCount > 0) {
        logger.warn(
          `Partially sent processed link(s) DM to ${message.author.tag} (Embed: ${embedSent ? 'OK' : 'Failed'}, URLs: ${textSentCount}/${processedItems.length})`
        )
      } else {
        logger.error(
          `Failed to deliver any processed link(s) DM to ${message.author.tag}`
        )
      }
    }
  } catch (err) {
    logger.error(`Failed to open DM channel with ${message.author.tag}:`, err)
  }
}
