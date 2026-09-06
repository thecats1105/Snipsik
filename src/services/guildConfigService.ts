import { db } from "@/db";
import { guildConfigs } from "@/db/schema";
import { config } from "@/config";
import {
  userConfigService,
  normalizeMinUrlLength,
} from "@/services/userConfigService";
import { logger } from "@/utils/logger";

export interface GuildConfigData {
  guildId?: string;
  autoShortenEnabled: boolean;
  autoShortenMinUrlLength: number | null;
}

export const DEFAULT_GUILD_CONFIG: Readonly<GuildConfigData> = {
  autoShortenEnabled: true,
  autoShortenMinUrlLength: null,
};

class GuildConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, GuildConfigData> = new Map();
  private cacheLoaded: boolean = false;

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
   * Loads all guild configs into memory on bot startup.
   */
  async loadCache(): Promise<void> {
    try {
      const records = await db.select().from(guildConfigs);
      this.cache.clear();
      for (const record of records) {
        this.cache.set(record.guildId, {
          guildId: record.guildId,
          autoShortenEnabled: record.autoShortenEnabled,
          autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
        });
      }
      this.cacheLoaded = true;
      logger.info(
        `Loaded ${records.length} guild config(s) into memory cache.`,
      );
    } catch (error) {
      this.cacheLoaded = false;
      logger.error("Failed to load guild configs cache from DB:", error);
      throw error;
    }
  }

  /**
   * Returns the current config for a guild (from memory cache or default).
   *
   * @param guildId - Discord guild snowflake ID.
   * @returns Guild configuration data.
   */
  getGuildConfig(guildId: string): GuildConfigData {
    const cached = this.cache.get(guildId);
    if (cached) {
      return { ...cached };
    }
    return {
      guildId,
      ...DEFAULT_GUILD_CONFIG,
    };
  }

  /**
   * Updates or creates a guild config in both DB and memory cache.
   * Modifies only supplied fields on conflict and syncs cache from returned merged row.
   *
   * @param guildId - Discord guild snowflake ID.
   * @param updates - Partial configuration updates.
   * @returns Operation success status and updated config.
   */
  async setGuildConfig(
    guildId: string,
    updates: Partial<
      Pick<GuildConfigData, "autoShortenEnabled" | "autoShortenMinUrlLength">
    >,
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    const current = this.getGuildConfig(guildId);

    const setClause: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const insertValues: {
      guildId: string;
      autoShortenEnabled?: boolean;
      autoShortenMinUrlLength?: number | null;
      updatedAt: Date;
    } = {
      guildId,
      updatedAt: new Date(),
    };

    if (updates.autoShortenEnabled !== undefined) {
      setClause.autoShortenEnabled = updates.autoShortenEnabled;
      insertValues.autoShortenEnabled = updates.autoShortenEnabled;
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
        .insert(guildConfigs)
        .values(insertValues)
        .onConflictDoUpdate({
          target: guildConfigs.guildId,
          set: setClause,
        })
        .returning();

      if (!saved) {
        throw new Error("Failed to persist guild configuration.");
      }

      const savedConfig: GuildConfigData = {
        guildId: saved.guildId,
        autoShortenEnabled: saved.autoShortenEnabled,
        autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
      };

      this.cache.set(guildId, savedConfig);
      logger.info(
        `Updated guild config for ${guildId}: autoShortenEnabled=${savedConfig.autoShortenEnabled}, autoShortenMinUrlLength=${savedConfig.autoShortenMinUrlLength}`,
      );
      return { success: true, config: savedConfig };
    } catch (error) {
      logger.error(`Failed to update guild config for ${guildId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
        config: current,
      };
    }
  }

  /**
   * Resolves the effective minimum URL length across the 3-tier hierarchy:
   * 1. User config override (if set and not null)
   * 2. Guild config override (if set and not null)
   * 3. Global ENV default (config.AUTO_SHORTEN_MIN_URL_LENGTH, default 70)
   *
   * @param guildId - Discord guild snowflake ID (or null/undefined)
   * @param userId - Discord user snowflake ID
   * @returns Effective minimum URL length threshold
   */
  resolveEffectiveMinUrlLength(
    guildId: string | null | undefined,
    userId: string,
  ): number {
    const userCfg = userConfigService.getUserConfig(userId);
    if (
      userCfg.autoShortenMinUrlLength !== null &&
      userCfg.autoShortenMinUrlLength !== undefined
    ) {
      return userCfg.autoShortenMinUrlLength;
    }

    if (guildId) {
      const guildCfg = this.getGuildConfig(guildId);
      if (
        guildCfg.autoShortenMinUrlLength !== null &&
        guildCfg.autoShortenMinUrlLength !== undefined
      ) {
        return guildCfg.autoShortenMinUrlLength;
      }
    }

    return config.AUTO_SHORTEN_MIN_URL_LENGTH;
  }
}

export const guildConfigService = new GuildConfigService();
