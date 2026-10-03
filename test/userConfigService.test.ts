import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_USER_CONFIG,
  normalizeAutoDmMode,
  normalizeDmFormat,
  normalizeFixupxEnabled,
  normalizeIgnoredDomains,
  normalizeMinUrlLength,
  userConfigService
} from '@/services/userConfigService'
import { MAX_CUSTOM_IGNORED_DOMAINS } from '@/utils/domain'

describe('UserConfigService Unit Tests', () => {
  describe('Normalization Helpers', () => {
    it('should normalize auto DM mode properly', () => {
      expect(normalizeAutoDmMode('inherit')).toBe('inherit')
      expect(normalizeAutoDmMode('DEFAULT')).toBe('inherit')
      expect(normalizeAutoDmMode('on')).toBe('on')
      expect(normalizeAutoDmMode('TRUE')).toBe('on')
      expect(normalizeAutoDmMode('enable')).toBe('on')
      expect(normalizeAutoDmMode('enabled')).toBe('on')
      expect(normalizeAutoDmMode('off')).toBe('off')
      expect(normalizeAutoDmMode('FALSE')).toBe('off')
      expect(normalizeAutoDmMode('disable')).toBe('off')
      expect(normalizeAutoDmMode('disabled')).toBe('off')

      expect(normalizeAutoDmMode('invalid')).toBeNull()
      expect(normalizeAutoDmMode(123)).toBeNull()
      expect(normalizeAutoDmMode(null)).toBeNull()
      expect(normalizeAutoDmMode(undefined)).toBeNull()
    })

    it('should normalize DM format properly', () => {
      expect(normalizeDmFormat('replace')).toBe('replace')
      expect(normalizeDmFormat('MESSAGE')).toBe('replace')
      expect(normalizeDmFormat('list')).toBe('list')
      expect(normalizeDmFormat('URLS')).toBe('list')

      expect(normalizeDmFormat('unknown')).toBeNull()
      expect(normalizeDmFormat(456)).toBeNull()
      expect(normalizeDmFormat(null)).toBeNull()
    })

    it('should normalize fixupx enabled properly', () => {
      expect(normalizeFixupxEnabled(true)).toBe(true)
      expect(normalizeFixupxEnabled(false)).toBe(false)
      expect(normalizeFixupxEnabled('on')).toBe(true)
      expect(normalizeFixupxEnabled('TRUE')).toBe(true)
      expect(normalizeFixupxEnabled('enable')).toBe(true)
      expect(normalizeFixupxEnabled('enabled')).toBe(true)
      expect(normalizeFixupxEnabled('1')).toBe(true)

      expect(normalizeFixupxEnabled('off')).toBe(false)
      expect(normalizeFixupxEnabled('FALSE')).toBe(false)
      expect(normalizeFixupxEnabled('disable')).toBe(false)
      expect(normalizeFixupxEnabled('disabled')).toBe(false)
      expect(normalizeFixupxEnabled('0')).toBe(false)

      expect(normalizeFixupxEnabled('unknown')).toBeNull()
      expect(normalizeFixupxEnabled(123)).toBeNull()
      expect(normalizeFixupxEnabled(null)).toBeNull()
    })

    it('should normalize min URL length properly', () => {
      // Inherit / Reset to null
      expect(normalizeMinUrlLength(-1)).toEqual({ valid: true, value: null })
      expect(normalizeMinUrlLength('-1')).toEqual({ valid: true, value: null })
      expect(normalizeMinUrlLength('inherit')).toEqual({
        valid: true,
        value: null
      })
      expect(normalizeMinUrlLength('DEFAULT')).toEqual({
        valid: true,
        value: null
      })
      expect(normalizeMinUrlLength('reset')).toEqual({
        valid: true,
        value: null
      })
      expect(normalizeMinUrlLength(null)).toEqual({ valid: true, value: null })
      expect(normalizeMinUrlLength(undefined)).toEqual({
        valid: true,
        value: null
      })

      // All URLs (0)
      expect(normalizeMinUrlLength(0)).toEqual({ valid: true, value: 0 })
      expect(normalizeMinUrlLength('0')).toEqual({ valid: true, value: 0 })
      expect(normalizeMinUrlLength('all')).toEqual({ valid: true, value: 0 })

      // Specific length (1 ~ 2048)
      expect(normalizeMinUrlLength(1)).toEqual({ valid: true, value: 1 })
      expect(normalizeMinUrlLength(70)).toEqual({ valid: true, value: 70 })
      expect(normalizeMinUrlLength('70')).toEqual({ valid: true, value: 70 })
      expect(normalizeMinUrlLength(2048)).toEqual({ valid: true, value: 2048 })
      expect(normalizeMinUrlLength('2048')).toEqual({
        valid: true,
        value: 2048
      })

      // Invalid inputs
      expect(normalizeMinUrlLength(-2)).toEqual({ valid: false, value: null })
      expect(normalizeMinUrlLength('-2')).toEqual({
        valid: false,
        value: null
      })
      expect(normalizeMinUrlLength(2049)).toEqual({
        valid: false,
        value: null
      })
      expect(normalizeMinUrlLength('2049')).toEqual({
        valid: false,
        value: null
      })
      expect(normalizeMinUrlLength(3.14)).toEqual({
        valid: false,
        value: null
      })
      expect(normalizeMinUrlLength('invalid')).toEqual({
        valid: false,
        value: null
      })
      expect(normalizeMinUrlLength({})).toEqual({ valid: false, value: null })
    })

    it('should normalize ignored domains properly', () => {
      // Empty / Reset / Inherit
      expect(normalizeIgnoredDomains(null)).toEqual({ valid: true, value: [] })
      expect(normalizeIgnoredDomains(undefined)).toEqual({
        valid: true,
        value: []
      })
      expect(normalizeIgnoredDomains('')).toEqual({ valid: true, value: [] })
      expect(normalizeIgnoredDomains('reset')).toEqual({
        valid: true,
        value: []
      })
      expect(normalizeIgnoredDomains('clear')).toEqual({
        valid: true,
        value: []
      })
      expect(normalizeIgnoredDomains('inherit')).toEqual({
        valid: true,
        value: []
      })

      // Valid string list
      expect(
        normalizeIgnoredDomains('tenor.com, GIPHY.COM, https://example.com/')
      ).toEqual({
        valid: true,
        value: ['tenor.com', 'giphy.com', 'example.com']
      })

      // Valid array
      expect(normalizeIgnoredDomains(['tenor.com', 'discordapp.com'])).toEqual({
        valid: true,
        value: ['tenor.com', 'discordapp.com']
      })

      // Invalid domain inside list
      const invalidRes = normalizeIgnoredDomains('valid.com, not a domain')
      expect(invalidRes.valid).toBe(false)
      expect(invalidRes.error).toContain('유효하지 않은 도메인')

      // Exceeds maximum unique count
      const tooMany = Array.from(
        { length: MAX_CUSTOM_IGNORED_DOMAINS + 1 },
        (_, i) => `d${i}.example.com`
      )
      const limitRes = normalizeIgnoredDomains(tooMany)
      expect(limitRes.valid).toBe(false)
      expect(limitRes.value).toEqual([])
      expect(limitRes.error).toContain('최대')
    })
  })

  describe('Tri-state Processing Decision (shouldProcessUser)', () => {
    it('should fail closed (return false) when cache is not loaded', () => {
      userConfigService.setCacheLoadedForTest(false)
      expect(userConfigService.isCacheLoaded()).toBe(false)

      const userId = 'test-fail-closed-user'
      // Regardless of channel watch status or config, always false
      expect(userConfigService.shouldProcessUser(userId, true)).toBe(false)
      expect(userConfigService.shouldProcessUser(userId, false)).toBe(false)
    })

    it('should default to inherit when user has no custom config', () => {
      userConfigService.setCacheLoadedForTest(true)
      const nonExistentUserId = 'unconfigured-user-999999'
      const config = userConfigService.getUserConfig(nonExistentUserId)
      expect(config.autoDmMode).toBe(DEFAULT_USER_CONFIG.autoDmMode)
      expect(config.dmFormat).toBe(DEFAULT_USER_CONFIG.dmFormat)
      expect(config.fixupxEnabled).toBe(true)

      // Inherit mode: follows isChannelWatched
      expect(userConfigService.shouldProcessUser(nonExistentUserId, true)).toBe(
        true
      )
      expect(
        userConfigService.shouldProcessUser(nonExistentUserId, false)
      ).toBe(false)
    })

    it('should respect on and off overrides', () => {
      userConfigService.setCacheLoadedForTest(true)
      const onUserId = 'user-override-always-on'
      const offUserId = 'user-override-always-off'

      // Mock cache directly for testing decision logic
      // @ts-expect-error accessing private cache for test
      userConfigService.cache.set(onUserId, {
        userId: onUserId,
        autoDmMode: 'on',
        dmFormat: 'replace',
        autoShortenMinUrlLength: null,
        ignoredDomains: [],
        fixupxEnabled: true
      })

      // @ts-expect-error accessing private cache for test
      userConfigService.cache.set(offUserId, {
        userId: offUserId,
        autoDmMode: 'off',
        dmFormat: 'replace',
        autoShortenMinUrlLength: null,
        ignoredDomains: [],
        fixupxEnabled: true
      })

      // ON: Always true regardless of channel watch status
      expect(userConfigService.shouldProcessUser(onUserId, true)).toBe(true)
      expect(userConfigService.shouldProcessUser(onUserId, false)).toBe(true)

      // OFF: Always false regardless of channel watch status
      expect(userConfigService.shouldProcessUser(offUserId, true)).toBe(false)
      expect(userConfigService.shouldProcessUser(offUserId, false)).toBe(false)
    })
  })

  describe('URL Message Replacement (replaceUrlsInText)', () => {
    it('should replace single URL in message', () => {
      const original =
        '이 링크 한번 확인해봐: https://example.com/very/long/url/path/test'
      const replacements = [
        {
          originalUrl: 'https://example.com/very/long/url/path/test',
          shortenedUrl: 'https://s.japsik.com/abc-021i3v9'
        }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '이 링크 한번 확인해봐: https://s.japsik.com/abc-021i3v9'
      )
    })

    it('should replace multiple URLs in message accurately', () => {
      const original =
        '링크1: https://site-a.com/long/path/1 링크2: https://site-b.org/article/2'
      const replacements = [
        {
          originalUrl: 'https://site-a.com/long/path/1',
          shortenedUrl: 'https://s.japsik.com/a1-021i3v9'
        },
        {
          originalUrl: 'https://site-b.org/article/2',
          shortenedUrl: 'https://s.japsik.com/b2-021i3v9'
        }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '링크1: https://s.japsik.com/a1-021i3v9 링크2: https://s.japsik.com/b2-021i3v9'
      )
    })

    it('should prevent substring collision by replacing longer URLs first', () => {
      // Shorter URL is a prefix/substring of the longer URL
      const shortUrl = 'https://example.com'
      const longUrl = 'https://example.com/sub/detail'

      const original = `체크: ${longUrl} 및 메인: ${shortUrl}`
      const replacements = [
        { originalUrl: shortUrl, shortenedUrl: 'https://s.japsik.com/short' },
        { originalUrl: longUrl, shortenedUrl: 'https://s.japsik.com/long' }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '체크: https://s.japsik.com/long 및 메인: https://s.japsik.com/short'
      )
    })

    it('should replace identical URLs appearing multiple times', () => {
      const url = 'https://example.com/common/target'
      const original = `앞에도 ${url} 뒤에도 ${url} 중복 등장`
      const replacements = [
        { originalUrl: url, shortenedUrl: 'https://s.japsik.com/target' }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '앞에도 https://s.japsik.com/target 뒤에도 https://s.japsik.com/target 중복 등장'
      )
    })

    it('should preserve surrounding Discord markdown and formatting', () => {
      const original =
        '마크다운 [문서](https://example.com/docs) 및 감싸기 <https://example.com/embed>'
      const replacements = [
        {
          originalUrl: 'https://example.com/docs',
          shortenedUrl: 'https://s.japsik.com/doc'
        },
        {
          originalUrl: 'https://example.com/embed',
          shortenedUrl: 'https://s.japsik.com/emb'
        }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '마크다운 [문서](https://s.japsik.com/doc) 및 감싸기 <https://s.japsik.com/emb>'
      )
    })

    it('should return original content when content is empty or replacements array is empty', () => {
      expect(userConfigService.replaceUrlsInText('', [])).toBe('')
      expect(userConfigService.replaceUrlsInText('그냥 일반 텍스트', [])).toBe(
        '그냥 일반 텍스트'
      )
    })

    it('does not corrupt unshortened prefix-sharing URLs (R06)', () => {
      const shortUrl = 'https://example.com/aaa'
      const longUrl = 'https://example.com/aaa/bbb'
      const original = `두 개 링크: ${shortUrl} 그리고 ${longUrl}`

      // Only the prefix URL was shortened (e.g. shortening the second URL failed)
      const replacements = [
        {
          originalUrl: shortUrl,
          targetUrl: 'https://s.japsik.com/aaa-short'
        }
      ]

      const result = userConfigService.replaceUrlsInText(original, replacements)
      expect(result).toBe(
        '두 개 링크: https://s.japsik.com/aaa-short 그리고 https://example.com/aaa/bbb'
      )
    })

    it('tracks [start, end] spans of replaced URLs in reconstructed text (R06)', () => {
      const original =
        '앞 링크 https://example.com/1 뒤 링크 https://example.com/2 끝'
      const replacements = [
        {
          originalUrl: 'https://example.com/1',
          targetUrl: 'https://s.japsik.com/short1'
        },
        {
          originalUrl: 'https://example.com/2',
          targetUrl: 'https://s.japsik.com/short2'
        }
      ]

      const { text, spans } = userConfigService.replaceUrlsInTextWithSpans(
        original,
        replacements
      )

      expect(text).toBe(
        '앞 링크 https://s.japsik.com/short1 뒤 링크 https://s.japsik.com/short2 끝'
      )
      expect(spans).toHaveLength(2)
      expect(text.slice(spans[0][0], spans[0][1])).toBe(
        'https://s.japsik.com/short1'
      )
      expect(text.slice(spans[1][0], spans[1][1])).toBe(
        'https://s.japsik.com/short2'
      )
    })
  })

  describe('Discord Message Chunking (chunkText)', () => {
    it('should not chunk text smaller than limit', () => {
      const text = '짧은 텍스트 메시지입니다.'
      const chunks = userConfigService.chunkText(text, 2000)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })

    it('should cleanly split long text exceeding limit', () => {
      const line = '가나다라마바사아자차카타파하 1234567890\n'
      const longText = line.repeat(100) // ~3700 chars
      const chunks = userConfigService.chunkText(longText, 1000)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(1000)
      }
    })

    it('preserves all newlines without loss so chunks.join("") === text (R19)', () => {
      const text = 'Line 1\n\nLine 2\n\n\nLine 3\nLine 4\n'
      const chunks = userConfigService.chunkText(text, 10)
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.join('')).toBe(text)
    })

    it('avoids splitting URLs across chunk boundaries using protectedSpans (R19)', () => {
      const url =
        'https://s.japsik.com/very-long-shortened-url-that-would-otherwise-be-cut'
      const text = `This is prefix text. ${url} This is suffix text.`
      const urlStart = text.indexOf(url)
      const urlEnd = urlStart + url.length
      const protectedSpans: Array<[number, number]> = [[urlStart, urlEnd]]

      // Set maxLength so that splitIndex without protectedSpans would fall right in the middle of url
      const maxLength = 80
      const chunks = userConfigService.chunkText(
        text,
        maxLength,
        protectedSpans
      )

      expect(chunks.join('')).toBe(text)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(maxLength)
      }
      // URL must not be split across chunks: one of the chunks must contain the full URL
      const hasFullUrl = chunks.some(chunk => chunk.includes(url))
      expect(hasFullUrl).toBe(true)
    })
  })

  describe('setUserConfig Validation', () => {
    it('rejects invalid autoShortenMinUrlLength values outside 0..2048', async () => {
      const res = await userConfigService.setUserConfig(
        'test-user-validation',
        {
          autoShortenMinUrlLength: 3000
        }
      )
      expect(res.success).toBe(false)
      expect(res.error).toContain('Invalid autoShortenMinUrlLength')
    })
  })
})
