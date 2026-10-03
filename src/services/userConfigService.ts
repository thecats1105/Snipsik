import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { userConfigs } from '@/db/schema'
import {
  CacheRecoveryController,
  type CacheStatus
} from '@/services/cacheRecovery'
import { MAX_CUSTOM_IGNORED_DOMAINS, normalizeDomain } from '@/utils/domain'
import { logger } from '@/utils/logger'
import { keyedMutex } from '@/utils/mutex'

export type AutoDmMode = 'inherit' | 'on' | 'off'
export type DmFormat = 'replace' | 'list'

export interface UserConfigData {
  userId?: string
  autoDmMode: AutoDmMode
  dmFormat: DmFormat
  autoShortenMinUrlLength: number | null
  ignoredDomains: string[]
  fixupxEnabled: boolean
}

export const DEFAULT_USER_CONFIG: Readonly<UserConfigData> = {
  autoDmMode: 'inherit',
  dmFormat: 'replace',
  autoShortenMinUrlLength: null,
  ignoredDomains: [],
  fixupxEnabled: true
}

/**
 * Normalizes input value for custom ignored domains.
 * Accepts comma-separated string or array of strings.
 * - "reset", "clear", "inherit", "default", "", null, undefined, []: returns { valid: true, value: [] }
 * - Otherwise parses and normalizes each domain via normalizeDomain().
 * - Rejects if any domain is invalid or if unique count exceeds MAX_CUSTOM_IGNORED_DOMAINS.
 *
 * @param value - The raw input value to normalize.
 * @returns An object indicating validity, normalized string array, and optional error message.
 */
export function normalizeIgnoredDomains(value: unknown): {
  valid: boolean
  value: string[]
  error?: string
} {
  if (value === null || value === undefined) {
    return { valid: true, value: [] }
  }

  let candidates: string[] = []

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      !trimmed ||
      trimmed.toLowerCase() === 'reset' ||
      trimmed.toLowerCase() === 'clear' ||
      trimmed.toLowerCase() === 'inherit' ||
      trimmed.toLowerCase() === 'default'
    ) {
      return { valid: true, value: [] }
    }
    candidates = trimmed.split(/[\s,]+/)
  } else if (Array.isArray(value)) {
    candidates = value.map(v => String(v))
  } else {
    return {
      valid: false,
      value: [],
      error: '도메인 목록은 쉼표로 구분된 문자열 또는 배열이어야 합니다.'
    }
  }

  const result = new Set<string>()
  for (const raw of candidates) {
    const item = raw.trim()
    if (!item) continue
    const normalized = normalizeDomain(item)
    if (!normalized) {
      return {
        valid: false,
        value: [],
        error: `유효하지 않은 도메인 형식입니다: '${item}'`
      }
    }
    result.add(normalized)
  }

  if (result.size > MAX_CUSTOM_IGNORED_DOMAINS) {
    return {
      valid: false,
      value: [],
      error: `제외 도메인은 최대 ${MAX_CUSTOM_IGNORED_DOMAINS}개까지 등록할 수 있습니다. (입력: ${result.size}개)`
    }
  }

  return { valid: true, value: Array.from(result) }
}

/**
 * Normalizes input value for minimum URL length threshold.
 * - null, undefined, -1, "inherit", "default", "reset": returns { valid: true, value: null } (inherit)
 * - 0, "0", "all": returns { valid: true, value: 0 } (all URLs)
 * - 1..2048 (or numeric string): returns { valid: true, value: N }
 * - anything else: returns { valid: false, value: null }
 *
 * @param value - The raw input value to normalize.
 * @returns An object indicating validity and the normalized number or null.
 */
export function normalizeMinUrlLength(value: unknown): {
  valid: boolean
  value: number | null
} {
  if (value === null || value === undefined) {
    return { valid: true, value: null }
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return { valid: false, value: null }
    if (value === -1) return { valid: true, value: null }
    if (value === 0) return { valid: true, value: 0 }
    if (value >= 1 && value <= 2048) return { valid: true, value }
    return { valid: false, value: null }
  }

  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (
      lower === 'inherit' ||
      lower === 'default' ||
      lower === 'reset' ||
      lower === '-1'
    ) {
      return { valid: true, value: null }
    }
    if (lower === 'all' || lower === '0') {
      return { valid: true, value: 0 }
    }
    const parsed = parseInt(lower, 10)
    if (String(parsed) === lower) {
      if (parsed === -1) return { valid: true, value: null }
      if (parsed === 0) return { valid: true, value: 0 }
      if (parsed >= 1 && parsed <= 2048) return { valid: true, value: parsed }
    }
  }

  return { valid: false, value: null }
}

/**
 * Normalizes an unknown value to a valid AutoDmMode or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized AutoDmMode or null if invalid.
 */
export function normalizeAutoDmMode(value: unknown): AutoDmMode | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  if (lower === 'inherit' || lower === 'default') return 'inherit'
  if (
    lower === 'on' ||
    lower === 'true' ||
    lower === 'enable' ||
    lower === 'enabled'
  )
    return 'on'
  if (
    lower === 'off' ||
    lower === 'false' ||
    lower === 'disable' ||
    lower === 'disabled'
  )
    return 'off'
  return null
}

/**
 * Normalizes an unknown value to a valid DmFormat or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized DmFormat or null if invalid.
 */
export function normalizeDmFormat(value: unknown): DmFormat | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  if (lower === 'replace' || lower === 'message') return 'replace'
  if (lower === 'list' || lower === 'urls') return 'list'
  return null
}

/**
 * Normalizes an unknown value to a boolean flag for fixupx conversion.
 *
 * @param value - Input string, boolean, or unknown value to normalize.
 * @returns Boolean value or null if invalid.
 */
export function normalizeFixupxEnabled(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  if (
    lower === 'on' ||
    lower === 'true' ||
    lower === 'enable' ||
    lower === 'enabled' ||
    lower === '1'
  ) {
    return true
  }
  if (
    lower === 'off' ||
    lower === 'false' ||
    lower === 'disable' ||
    lower === 'disabled' ||
    lower === '0'
  ) {
    return false
  }
  return null
}

class UserConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, UserConfigData> = new Map()
  private cacheEpoch: number = 0
  private cacheMutations = new Map<
    string,
    { epoch: number; value: UserConfigData }
  >()
  private readonly recovery = new CacheRecoveryController('UserConfig', () =>
    this.refreshCache()
  )

  /**
   * Triggers a non-blocking background attempt to reload user configs cache if currently unloaded.
   * Coalesced and retried with capped exponential backoff.
   */
  triggerBackgroundReload(): void {
    this.recovery.ensureLoading()
  }

  startCacheRecovery(): Promise<void> {
    return this.recovery.start()
  }

  stopCacheRecovery(): void {
    this.recovery.stop()
  }

  getCacheStatus(): CacheStatus {
    return this.recovery.getStatus()
  }

  /**
   * Sets cache loaded status (used for testing or manual state control).
   *
   * @param loaded - Cache loaded status flag.
   */
  setCacheLoadedForTest(loaded: boolean): void {
    this.recovery.setUsableForTest(loaded)
  }

  /**
   * Whether the cache has been successfully loaded from database.
   *
   * @returns True if cache is loaded, false otherwise.
   */
  isCacheLoaded(): boolean {
    return this.recovery.isUsable()
  }

  /**
   * Loads all user configs into memory on bot startup or retry.
   * Synchronizes with concurrent writes using cacheEpoch to avoid clobbering newer rows.
   */
  async loadCache(): Promise<void> {
    return this.recovery.loadNow()
  }

  private async refreshCache(): Promise<void> {
    const startEpoch = this.cacheEpoch
    try {
      const records = await db.select().from(userConfigs)
      const nextCache = new Map<string, UserConfigData>()
      for (const record of records) {
        nextCache.set(record.userId, {
          userId: record.userId,
          autoDmMode: normalizeAutoDmMode(record.autoDmMode) ?? 'inherit',
          dmFormat: normalizeDmFormat(record.dmFormat) ?? 'replace',
          autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
          ignoredDomains: record.ignoredDomains ?? [],
          fixupxEnabled: record.fixupxEnabled ?? true
        })
      }

      this.cache = nextCache
      const appliedEpoch = this.cacheEpoch
      for (const [userId, mutation] of this.cacheMutations) {
        if (mutation.epoch > startEpoch && mutation.epoch <= appliedEpoch) {
          this.cache.set(userId, mutation.value)
        }
      }

      this.pruneCacheMutations(appliedEpoch)
      logger.info(`Loaded ${records.length} user config(s) into memory cache.`)
    } catch (error) {
      logger.error('Failed to load user configs cache from DB:', error)
      throw error
    }
  }

  private recordCacheMutation(userId: string, value: UserConfigData): void {
    this.cacheEpoch += 1
    this.cacheMutations.set(userId, { epoch: this.cacheEpoch, value })
    this.cache.set(userId, value)
  }

  private pruneCacheMutations(appliedEpoch: number): void {
    for (const [userId, mutation] of this.cacheMutations) {
      if (mutation.epoch <= appliedEpoch) this.cacheMutations.delete(userId)
    }
  }

  /**
   * Returns the current config for a user (from memory cache or default).
   *
   * @param userId - Discord user snowflake ID.
   * @returns User configuration data.
   */
  getUserConfig(userId: string): UserConfigData {
    const cached = this.cache.get(userId)
    if (cached) {
      return { ...cached }
    }
    return {
      userId,
      ...DEFAULT_USER_CONFIG
    }
  }

  /**
   * Updates or creates a user config in both DB and memory cache.
   * Modifies only supplied fields on conflict and syncs cache from returned merged row.
   *
   * @param userId - Discord user snowflake ID.
   * @param updates - Partial configuration updates.
   * @returns Operation success status and updated config.
   */
  async setUserConfig(
    userId: string,
    updates: Partial<
      Pick<
        UserConfigData,
        | 'autoDmMode'
        | 'dmFormat'
        | 'autoShortenMinUrlLength'
        | 'ignoredDomains'
        | 'fixupxEnabled'
      >
    >
  ): Promise<{ success: boolean; error?: string; config: UserConfigData }> {
    const current = this.getUserConfig(userId)

    const setClause: Record<string, unknown> = {
      updatedAt: new Date()
    }
    const insertValues: {
      userId: string
      autoDmMode?: AutoDmMode
      dmFormat?: DmFormat
      autoShortenMinUrlLength?: number | null
      ignoredDomains?: string[]
      fixupxEnabled?: boolean
      updatedAt: Date
    } = {
      userId,
      updatedAt: new Date()
    }

    if (updates.autoDmMode !== undefined) {
      const normalized = normalizeAutoDmMode(updates.autoDmMode)
      if (normalized) {
        setClause.autoDmMode = normalized
        insertValues.autoDmMode = normalized
      }
    }

    if (updates.dmFormat !== undefined) {
      const normalized = normalizeDmFormat(updates.dmFormat)
      if (normalized) {
        setClause.dmFormat = normalized
        insertValues.dmFormat = normalized
      }
    }

    if (updates.autoShortenMinUrlLength !== undefined) {
      const normalizedLen = normalizeMinUrlLength(
        updates.autoShortenMinUrlLength
      )
      if (!normalizedLen.valid) {
        return {
          success: false,
          error:
            'Invalid autoShortenMinUrlLength. Must be -1 (inherit), 0 (all), or an integer between 1 and 2048.',
          config: current
        }
      }
      setClause.autoShortenMinUrlLength = normalizedLen.value
      insertValues.autoShortenMinUrlLength = normalizedLen.value
    }

    if (updates.ignoredDomains !== undefined) {
      const normalizedDomains = normalizeIgnoredDomains(updates.ignoredDomains)
      if (!normalizedDomains.valid) {
        return {
          success: false,
          error: normalizedDomains.error || 'Invalid ignoredDomains.',
          config: current
        }
      }
      setClause.ignoredDomains = normalizedDomains.value
      insertValues.ignoredDomains = normalizedDomains.value
    }

    if (updates.fixupxEnabled !== undefined) {
      const normalizedFixupx = normalizeFixupxEnabled(updates.fixupxEnabled)
      if (normalizedFixupx === null) {
        return {
          success: false,
          error: "Invalid fixupx setting. Must be 'on' or 'off'.",
          config: current
        }
      }
      setClause.fixupxEnabled = normalizedFixupx
      insertValues.fixupxEnabled = normalizedFixupx
    }

    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await keyedMutex.runExclusive(userId, async () => {
          return await db.transaction(async tx => {
            const [existing] = await tx
              .select()
              .from(userConfigs)
              .where(eq(userConfigs.userId, userId))

            let saved: typeof userConfigs.$inferSelect | undefined

            if (!existing) {
              const [inserted] = await tx
                .insert(userConfigs)
                .values(insertValues)
                .onConflictDoNothing()
                .returning()

              if (!inserted) {
                // Raced with concurrent insert
                return { retry: true as const }
              }
              saved = inserted
            } else {
              const [updated] = await tx
                .update(userConfigs)
                .set({
                  ...setClause,
                  version: existing.version + 1
                })
                .where(
                  and(
                    eq(userConfigs.userId, userId),
                    eq(userConfigs.version, existing.version)
                  )
                )
                .returning()

              if (!updated) {
                // Raced with concurrent update
                return { retry: true as const }
              }
              saved = updated
            }

            const savedConfig: UserConfigData = {
              userId: saved.userId,
              autoDmMode: normalizeAutoDmMode(saved.autoDmMode) ?? 'inherit',
              dmFormat: normalizeDmFormat(saved.dmFormat) ?? 'replace',
              autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
              ignoredDomains: saved.ignoredDomains ?? [],
              fixupxEnabled: saved.fixupxEnabled ?? true
            }

            return { success: true, config: savedConfig }
          })
        })

        if ('retry' in result) {
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 25 * attempt))
            continue
          }
          logger.warn(
            `Concurrent mutation conflict on user ${userId} exceeded max retries (${MAX_RETRIES}).`
          )
          return {
            success: false,
            error: 'Concurrent update conflict. Please try again.',
            config: current
          }
        }

        if (result.success) {
          this.recordCacheMutation(userId, result.config)
          if (!this.isCacheLoaded()) {
            this.triggerBackgroundReload()
          }
          logger.info(
            `Updated user config for ${userId}: autoDmMode=${result.config.autoDmMode}, dmFormat=${result.config.dmFormat}, autoShortenMinUrlLength=${result.config.autoShortenMinUrlLength}, ignoredDomains=${result.config.ignoredDomains.length}`
          )
        }

        return result
      } catch (error) {
        logger.error(
          `Failed to update user config for ${userId} (attempt ${attempt}/${MAX_RETRIES}):`,
          error
        )
        if (attempt >= MAX_RETRIES) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Database error',
            config: current
          }
        }
      }
    }

    return {
      success: false,
      error: 'Database update failed after retries.',
      config: current
    }
  }

  /**
   * Determines whether the bot should auto-shorten URLs and send DM to the user.
   * Fails closed (returns false) if the cache is not loaded to prevent privacy leaks.
   * Schedules a background cache reload if cache is currently not loaded.
   */
  shouldProcessUser(userId: string, isChannelWatched: boolean): boolean {
    if (!this.isCacheLoaded()) {
      this.triggerBackgroundReload()
      logger.warn(
        `UserConfig cache not loaded; failing closed for user ${userId} and scheduled background reload`
      )
      return false
    }

    const cfg = this.getUserConfig(userId)
    if (cfg.autoDmMode === 'off') return false
    if (cfg.autoDmMode === 'on') return true
    return isChannelWatched
  }

  /**
   * Replaces original URLs with shortened or transformed URLs in the original message content,
   * tracking the resulting [start, end] spans of the replaced URLs in the reconstructed text.
   * Performs replacement using exact URL matches or offsets, preventing substring/prefix corruption.
   */
  replaceUrlsInTextWithSpans(
    content: string,
    replacements: Array<{
      originalUrl: string
      shortenedUrl?: string
      targetUrl?: string
      start?: number
      end?: number
    }>,
    matches?: Array<{ url: string; start: number; end: number }>
  ): { text: string; spans: Array<[number, number]> } {
    if (!content || replacements.length === 0) {
      return { text: content, spans: [] }
    }

    // Build map of originalUrl -> targetUrl
    const urlToTarget = new Map<string, string>()
    for (const r of replacements) {
      const target = r.targetUrl || r.shortenedUrl
      if (target && !urlToTarget.has(r.originalUrl)) {
        urlToTarget.set(r.originalUrl, target)
      }
    }

    interface PlannedReplacement {
      start: number
      end: number
      targetUrl: string
    }

    const planned: PlannedReplacement[] = []

    // 1. If explicit valid offsets are provided on replacements
    const hasExplicitOffsets = replacements.some(
      r => typeof r.start === 'number' && typeof r.end === 'number'
    )

    if (hasExplicitOffsets) {
      for (const r of replacements) {
        const target = r.targetUrl || r.shortenedUrl
        if (
          target &&
          typeof r.start === 'number' &&
          typeof r.end === 'number'
        ) {
          planned.push({
            start: r.start,
            end: r.end,
            targetUrl: target
          })
        }
      }
    } else if (matches && matches.length > 0) {
      // 2. If matches with offsets are provided
      for (const m of matches) {
        const target = urlToTarget.get(m.url)
        if (target) {
          planned.push({
            start: m.start,
            end: m.end,
            targetUrl: target
          })
        }
      }
    } else {
      // 3. Fallback: find exact URL matches in content without corrupting prefixes
      const sortedEntries = Array.from(urlToTarget.entries()).sort(
        ([a], [b]) => b.length - a.length
      )

      const occupied = new Uint8Array(content.length)

      for (const [origUrl, targetUrl] of sortedEntries) {
        let searchIndex = 0
        while ((searchIndex = content.indexOf(origUrl, searchIndex)) !== -1) {
          const matchStart = searchIndex
          const matchEnd = matchStart + origUrl.length
          searchIndex += 1

          let isOccupied = false
          for (let i = matchStart; i < matchEnd; i++) {
            if (occupied[i]) {
              isOccupied = true
              break
            }
          }
          if (isOccupied) continue

          if (matchEnd < content.length) {
            const nextChar = content[matchEnd]
            if (nextChar && /[a-zA-Z0-9_\-/~%+=&#?]/.test(nextChar)) {
              continue
            }
          }

          if (matchStart > 0) {
            const prevChar = content[matchStart - 1]
            if (prevChar && /[a-zA-Z0-9]/.test(prevChar)) {
              continue
            }
          }

          for (let i = matchStart; i < matchEnd; i++) {
            occupied[i] = 1
          }

          planned.push({
            start: matchStart,
            end: matchEnd,
            targetUrl
          })
        }
      }
    }

    // Sort planned replacements by start ascending
    planned.sort((a, b) => a.start - b.start)

    // Filter out any overlaps (keeping earlier)
    const nonOverlapping: PlannedReplacement[] = []
    let lastEnd = -1
    for (const p of planned) {
      if (p.start >= lastEnd) {
        nonOverlapping.push(p)
        lastEnd = p.end
      }
    }

    let reconstructed = ''
    const spans: Array<[number, number]> = []
    let cursor = 0

    for (const item of nonOverlapping) {
      reconstructed += content.slice(cursor, item.start)
      const newStart = reconstructed.length
      reconstructed += item.targetUrl
      const newEnd = reconstructed.length
      spans.push([newStart, newEnd])
      cursor = item.end
    }
    reconstructed += content.slice(cursor)

    return { text: reconstructed, spans }
  }

  /**
   * Replaces original URLs with shortened or transformed URLs in the original message content.
   * Performs replacement using exact URL matches or offsets, preventing substring/prefix corruption.
   */
  replaceUrlsInText(
    content: string,
    replacements: Array<{
      originalUrl: string
      shortenedUrl?: string
      targetUrl?: string
      start?: number
      end?: number
    }>,
    matches?: Array<{ url: string; start: number; end: number }>,
    outSpans?: Array<[number, number]>
  ): string {
    const result = this.replaceUrlsInTextWithSpans(
      content,
      replacements,
      matches
    )
    if (outSpans) {
      outSpans.push(...result.spans)
    }
    return result.text
  }

  /**
   * Splits text into safe chunks under Discord's 2,000 character limit,
   * preserving all characters (chunks.join('') === text) and avoiding splitting
   * protected URL spans across chunk boundaries.
   */
  chunkText(
    text: string,
    maxLength = 2000,
    protectedSpans?: Array<[number, number]>
  ): string[] {
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let currentOffset = 0

    while (currentOffset < text.length) {
      const remainingLength = text.length - currentOffset
      if (remainingLength <= maxLength) {
        chunks.push(text.slice(currentOffset))
        break
      }

      const limit = currentOffset + maxLength

      // 1. Try to break after a newline within (currentOffset, limit]
      let splitIndex = -1
      const lastNewline = text.lastIndexOf('\n', limit - 1)
      if (lastNewline >= currentOffset) {
        splitIndex = lastNewline + 1
      }

      // 2. If no newline found, try to break after a space within (currentOffset, limit]
      if (splitIndex <= currentOffset) {
        const lastSpace = text.lastIndexOf(' ', limit - 1)
        if (lastSpace >= currentOffset) {
          splitIndex = lastSpace + 1
        }
      }

      // 3. Fallback: hard break at maxLength
      if (splitIndex <= currentOffset) {
        splitIndex = limit
      }

      // 4. Check protected spans: if splitIndex falls inside [start, end], adjust to start
      if (protectedSpans && protectedSpans.length > 0) {
        for (const [spanStart, spanEnd] of protectedSpans) {
          if (splitIndex > spanStart && splitIndex < spanEnd) {
            if (spanStart > currentOffset) {
              splitIndex = spanStart
            }
            break
          }
        }
      }

      // Safety check to guarantee forward progress
      if (splitIndex <= currentOffset) {
        splitIndex = limit
      }

      chunks.push(text.slice(currentOffset, splitIndex))
      currentOffset = splitIndex
    }

    return chunks
  }
}

export const userConfigService = new UserConfigService()
