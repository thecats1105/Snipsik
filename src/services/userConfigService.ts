import { db } from "@/db";
import { userConfigs } from "@/db/schema";
import { logger } from "@/utils/logger";

export type AutoDmMode = "inherit" | "on" | "off";
export type DmFormat = "replace" | "list";

export interface UserConfigData {
  userId?: string;
  autoDmMode: AutoDmMode;
  dmFormat: DmFormat;
  autoShortenMinUrlLength: number | null;
}

export const DEFAULT_USER_CONFIG: Readonly<UserConfigData> = {
  autoDmMode: "inherit",
  dmFormat: "replace",
  autoShortenMinUrlLength: null,
};

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
  valid: boolean;
  value: number | null;
} {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value)) return { valid: false, value: null };
    if (value === -1) return { valid: true, value: null };
    if (value === 0) return { valid: true, value: 0 };
    if (value >= 1 && value <= 2048) return { valid: true, value };
    return { valid: false, value: null };
  }

  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (
      lower === "inherit" ||
      lower === "default" ||
      lower === "reset" ||
      lower === "-1"
    ) {
      return { valid: true, value: null };
    }
    if (lower === "all" || lower === "0") {
      return { valid: true, value: 0 };
    }
    const parsed = parseInt(lower, 10);
    if (String(parsed) === lower) {
      if (parsed === -1) return { valid: true, value: null };
      if (parsed === 0) return { valid: true, value: 0 };
      if (parsed >= 1 && parsed <= 2048) return { valid: true, value: parsed };
    }
  }

  return { valid: false, value: null };
}

/**
 * Normalizes an unknown value to a valid AutoDmMode or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized AutoDmMode or null if invalid.
 */
export function normalizeAutoDmMode(value: unknown): AutoDmMode | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === "inherit" || lower === "default") return "inherit";
  if (
    lower === "on" ||
    lower === "true" ||
    lower === "enable" ||
    lower === "enabled"
  )
    return "on";
  if (
    lower === "off" ||
    lower === "false" ||
    lower === "disable" ||
    lower === "disabled"
  )
    return "off";
  return null;
}

/**
 * Normalizes an unknown value to a valid DmFormat or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized DmFormat or null if invalid.
 */
export function normalizeDmFormat(value: unknown): DmFormat | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === "replace" || lower === "message") return "replace";
  if (lower === "list" || lower === "urls") return "list";
  return null;
}

class UserConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, UserConfigData> = new Map();
  private cacheLoaded: boolean = false;
  private isReloadingCache: boolean = false;

  /**
   * Triggers a non-blocking background attempt to reload user configs cache if currently unloaded.
   */
  triggerBackgroundReload(): void {
    if (this.isReloadingCache || this.cacheLoaded) return;
    this.isReloadingCache = true;
    this.loadCache()
      .catch((err) => {
        logger.warn("Background retry loading user configs cache failed:", err);
      })
      .finally(() => {
        this.isReloadingCache = false;
      });
  }

  /**
   * Sets cache loaded status (used for testing or manual state control).
   *
   * @param loaded - Cache loaded status flag.
   */
  setCacheLoadedForTest(loaded: boolean): void {
    this.cacheLoaded = loaded;
  }

  /**
   * Whether the cache has been successfully loaded from database.
   *
   * @returns True if cache is loaded, false otherwise.
   */
  isCacheLoaded(): boolean {
    return this.cacheLoaded;
  }

  /**
   * Loads all user configs into memory on bot startup.
   */
  async loadCache(): Promise<void> {
    try {
      const records = await db.select().from(userConfigs);
      this.cache.clear();
      for (const record of records) {
        const autoDmMode = normalizeAutoDmMode(record.autoDmMode) ?? "inherit";
        const dmFormat = normalizeDmFormat(record.dmFormat) ?? "replace";
        this.cache.set(record.userId, {
          userId: record.userId,
          autoDmMode,
          dmFormat,
          autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
        });
      }
      this.cacheLoaded = true;
      logger.info(`Loaded ${records.length} user config(s) into memory cache.`);
    } catch (error) {
      this.cacheLoaded = false;
      logger.error("Failed to load user configs cache from DB:", error);
      throw error;
    }
  }

  /**
   * Returns the current config for a user (from memory cache or default).
   *
   * @param userId - Discord user snowflake ID.
   * @returns User configuration data.
   */
  getUserConfig(userId: string): UserConfigData {
    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached };
    }
    return {
      userId,
      ...DEFAULT_USER_CONFIG,
    };
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
        "autoDmMode" | "dmFormat" | "autoShortenMinUrlLength"
      >
    >,
  ): Promise<{ success: boolean; error?: string; config: UserConfigData }> {
    const current = this.getUserConfig(userId);

    const setClause: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const insertValues: {
      userId: string;
      autoDmMode?: AutoDmMode;
      dmFormat?: DmFormat;
      autoShortenMinUrlLength?: number | null;
      updatedAt: Date;
    } = {
      userId,
      updatedAt: new Date(),
    };

    if (updates.autoDmMode !== undefined) {
      const normalized = normalizeAutoDmMode(updates.autoDmMode);
      if (normalized) {
        setClause.autoDmMode = normalized;
        insertValues.autoDmMode = normalized;
      }
    }

    if (updates.dmFormat !== undefined) {
      const normalized = normalizeDmFormat(updates.dmFormat);
      if (normalized) {
        setClause.dmFormat = normalized;
        insertValues.dmFormat = normalized;
      }
    }

    if (updates.autoShortenMinUrlLength !== undefined) {
      const normalizedLen = normalizeMinUrlLength(
        updates.autoShortenMinUrlLength,
      );
      if (!normalizedLen.valid) {
        return {
          success: false,
          error:
            "Invalid autoShortenMinUrlLength. Must be -1 (inherit), 0 (all), or an integer between 1 and 2048.",
          config: current,
        };
      }
      setClause.autoShortenMinUrlLength = normalizedLen.value;
      insertValues.autoShortenMinUrlLength = normalizedLen.value;
    }

    try {
      const [saved] = await db
        .insert(userConfigs)
        .values(insertValues)
        .onConflictDoUpdate({
          target: userConfigs.userId,
          set: setClause,
        })
        .returning();

      if (!saved) {
        throw new Error("Failed to persist user configuration.");
      }

      const savedConfig: UserConfigData = {
        userId: saved.userId,
        autoDmMode: normalizeAutoDmMode(saved.autoDmMode) ?? "inherit",
        dmFormat: normalizeDmFormat(saved.dmFormat) ?? "replace",
        autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
      };

      this.cache.set(userId, savedConfig);
      if (!this.cacheLoaded) {
        this.triggerBackgroundReload();
      }
      logger.info(
        `Updated user config for ${userId}: autoDmMode=${savedConfig.autoDmMode}, dmFormat=${savedConfig.dmFormat}, autoShortenMinUrlLength=${savedConfig.autoShortenMinUrlLength}`,
      );
      return { success: true, config: savedConfig };
    } catch (error) {
      logger.error(`Failed to update user config for ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
        config: current,
      };
    }
  }

  /**
   * Determines whether the bot should auto-shorten URLs and send DM to the user.
   * Fails closed (returns false) if the cache is not loaded to prevent privacy leaks.
   * Schedules a background cache reload if cache is currently not loaded.
   */
  shouldProcessUser(userId: string, isChannelWatched: boolean): boolean {
    if (!this.cacheLoaded) {
      this.triggerBackgroundReload();
      logger.warn(
        `UserConfig cache not loaded; failing closed for user ${userId} and scheduled background reload`,
      );
      return false;
    }

    const cfg = this.getUserConfig(userId);
    if (cfg.autoDmMode === "off") return false;
    if (cfg.autoDmMode === "on") return true;
    return isChannelWatched;
  }

  /**
   * Replaces original URLs with shortened URLs in the original message content.
   * Sorts URLs by descending length (longest first) to prevent substring collision.
   */
  replaceUrlsInText(
    content: string,
    replacements: Array<{ originalUrl: string; shortenedUrl: string }>,
  ): string {
    if (!content || replacements.length === 0) return content;

    // Deduplicate replacements by originalUrl
    const map = new Map<string, string>();
    for (const r of replacements) {
      if (!map.has(r.originalUrl)) {
        map.set(r.originalUrl, r.shortenedUrl);
      }
    }

    // Sort by descending URL length
    const sorted = Array.from(map.entries()).sort(
      ([urlA], [urlB]) => urlB.length - urlA.length,
    );

    let result = content;
    for (const [origUrl, shortUrl] of sorted) {
      result = result.split(origUrl).join(shortUrl);
    }

    return result;
  }

  /**
   * Splits text into safe chunks under Discord's 2,000 character limit.
   */
  chunkText(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to break at a newline or space
      let splitIndex = remaining.lastIndexOf("\n", maxLength);
      if (splitIndex <= 0) {
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitIndex <= 0) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).replace(/^\n+/, "");
    }

    return chunks;
  }
}

export const userConfigService = new UserConfigService();
