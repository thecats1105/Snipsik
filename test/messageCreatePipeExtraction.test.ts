import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  extractUrlsFromDiscordMarkdown,
  onMessageCreate
} from '@/events/messageCreate'
import { guildConfigService } from '@/services/guildConfigService'
import { sinkClient } from '@/services/sinkClient'
import { getUserHash } from '@/services/slugManager'
import { userConfigService } from '@/services/userConfigService'
import { watchService } from '@/services/watchService'

describe('MessageCreate Pipe URL Extraction and Replacement', () => {
  const originalIsWatched = watchService.isWatched
  const originalGetUserConfig = userConfigService.getUserConfig
  const originalShouldProcessUser = userConfigService.shouldProcessUser
  const originalResolveEffectiveMinUrlLength =
    guildConfigService.resolveEffectiveMinUrlLength
  const originalSearchLinks = sinkClient.searchLinks
  const originalCreateLink = sinkClient.createLink
  const originalGetFullShortUrl = sinkClient.getFullShortUrl

  const testUserId = '723319776407191633'
  const testUserHash = getUserHash(testUserId)
  const testGuildId = 'guild-pipe-test'
  const testChannelId = 'channel-pipe-test'

  beforeEach(() => {
    watchService.setCacheLoadedForTest(true)
    userConfigService.setCacheLoadedForTest(true)
    guildConfigService.setCacheLoadedForTest(true)
    watchService.isWatched = () => true
    userConfigService.shouldProcessUser = () => true
    userConfigService.getUserConfig = () => ({
      autoDmMode: 'inherit',
      dmFormat: 'replace',
      autoShortenMinUrlLength: 0
    })
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`
    sinkClient.searchLinks = async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200
    })
    guildConfigService.resolveEffectiveMinUrlLength = () => 0
  })

  afterEach(() => {
    watchService.setCacheLoadedForTest(false)
    userConfigService.setCacheLoadedForTest(false)
    guildConfigService.setCacheLoadedForTest(false)
    watchService.isWatched = originalIsWatched
    userConfigService.getUserConfig = originalGetUserConfig
    userConfigService.shouldProcessUser = originalShouldProcessUser
    guildConfigService.resolveEffectiveMinUrlLength =
      originalResolveEffectiveMinUrlLength
    sinkClient.searchLinks = originalSearchLinks
    sinkClient.createLink = originalCreateLink
    sinkClient.getFullShortUrl = originalGetFullShortUrl
  })

  describe('extractUrlsFromDiscordMarkdown URL extraction and boundaries', () => {
    it('preserves query string pipes while stripping trailing Discord spoiler pipes', () => {
      const spoilerContent = '||https://example.com/search?a=1|2||'
      expect(
        extractUrlsFromDiscordMarkdown(spoilerContent).map(m => m.url)
      ).toEqual(['https://example.com/search?a=1|2'])
    })

    it('preserves legitimate trailing single pipe on URLs outside spoiler', () => {
      const trailingPipeUrl = 'https://example.com/query?filter=|'
      expect(
        extractUrlsFromDiscordMarkdown(trailingPipeUrl).map(m => m.url)
      ).toEqual(['https://example.com/query?filter=|'])
    })

    it('preserves legitimate trailing double pipe on URLs outside spoiler', () => {
      const trailingDoublePipeUrl = 'https://example.com/query?filter=||'
      expect(
        extractUrlsFromDiscordMarkdown(trailingDoublePipeUrl).map(m => m.url)
      ).toEqual(['https://example.com/query?filter=||'])
    })

    it('preserves legitimate trailing single pipe on URLs inside spoiler', () => {
      const trailingPipeInsideSpoiler = '||https://example.com/query?filter=|||'
      expect(
        extractUrlsFromDiscordMarkdown(trailingPipeInsideSpoiler).map(
          m => m.url
        )
      ).toEqual(['https://example.com/query?filter=|'])
    })

    it('strips unbalanced closing parenthesis and brackets', () => {
      expect(
        extractUrlsFromDiscordMarkdown('https://example.com/path)').map(
          m => m.url
        )
      ).toEqual(['https://example.com/path'])
      expect(
        extractUrlsFromDiscordMarkdown('https://example.com/path]').map(
          m => m.url
        )
      ).toEqual(['https://example.com/path'])
    })

    it('preserves balanced parentheses in URLs', () => {
      const wikiUrl = 'https://en.wikipedia.org/wiki/Function_(mathematics)'
      expect(extractUrlsFromDiscordMarkdown(wikiUrl).map(m => m.url)).toEqual([
        wikiUrl
      ])
    })

    it('preserves valid dots in query parameters and trims trailing dots', () => {
      const urlWithDots = 'https://example.com/test?_gl=token.with.dots&param=1'
      expect(
        extractUrlsFromDiscordMarkdown(urlWithDots).map(m => m.url)
      ).toEqual([urlWithDots])

      const urlWithTrailingDots = 'https://example.com/test?_gl=token..'
      expect(
        extractUrlsFromDiscordMarkdown(urlWithTrailingDots).map(m => m.url)
      ).toEqual(['https://example.com/test?_gl=token'])
    })

    it('handles multiple URLs where the first URL contains || without corrupting subsequent URL spoiler status (R11)', () => {
      const content =
        'https://ex.com/a||b https://ex.com/second?q=1||2 ||https://ex.com/spoiled|| https://ex.com/normal'
      expect(extractUrlsFromDiscordMarkdown(content).map(m => m.url)).toEqual([
        'https://ex.com/a||b',
        'https://ex.com/second?q=1||2',
        'https://ex.com/spoiled',
        'https://ex.com/normal'
      ])
    })

    it('trims trailing punctuation, CJK punctuation, and markdown delimiters from URLs (R12)', () => {
      const punctuationCases = [
        ['https://example.com/period.', 'https://example.com/period'],
        ['https://example.com/comma,', 'https://example.com/comma'],
        ['https://example.com/exclamation!', 'https://example.com/exclamation'],
        ['https://example.com/question?', 'https://example.com/question'],
        ['https://example.com/semicolon;', 'https://example.com/semicolon'],
        ['https://example.com/colon:', 'https://example.com/colon'],
        ["https://example.com/quote'", 'https://example.com/quote'],
        ['https://example.com/dquote"', 'https://example.com/dquote'],
        ['https://example.com/rquote’', 'https://example.com/rquote'],
        ['https://example.com/rdquote”', 'https://example.com/rdquote'],
        ['https://example.com/cjk-dot。', 'https://example.com/cjk-dot'],
        ['https://example.com/cjk-comma、', 'https://example.com/cjk-comma'],
        ['https://example.com/cjk-excl！', 'https://example.com/cjk-excl'],
        ['https://example.com/cjk-quest？', 'https://example.com/cjk-quest'],
        [
          'https://example.com/cjk-ellipsis…',
          'https://example.com/cjk-ellipsis'
        ],
        ['https://example.com/cjk-colon：', 'https://example.com/cjk-colon'],
        [
          'https://example.com/cjk-semicolon；',
          'https://example.com/cjk-semicolon'
        ],
        ['*https://example.com/asterisk*', 'https://example.com/asterisk'],
        ['_https://example.com/underscore_', 'https://example.com/underscore'],
        ['~https://example.com/tilde~', 'https://example.com/tilde'],
        [
          '~~https://example.com/strikethrough~~',
          'https://example.com/strikethrough'
        ],
        [
          'https://en.wikipedia.org/wiki/Foo_(mathematics).',
          'https://en.wikipedia.org/wiki/Foo_(mathematics)'
        ]
      ]

      for (const [input, expected] of punctuationCases) {
        expect(extractUrlsFromDiscordMarkdown(input).map(m => m.url)).toEqual([
          expected
        ])
      }
    })
  })

  describe('extractUrlsFromDiscordMarkdown', () => {
    it('separates spoiler, bold, and adjacent markdown-link boundaries', () => {
      expect(
        extractUrlsFromDiscordMarkdown(
          '||see https://example.com/path|| **https://example.com/bold** [a](https://example.com/a)[b](https://example.com/b)'
        ).map(match => match.url)
      ).toEqual([
        'https://example.com/path',
        'https://example.com/bold',
        'https://example.com/a',
        'https://example.com/b'
      ])
    })

    it('removes closing markdown in the combined spoiler-parenthesis case', () => {
      expect(
        extractUrlsFromDiscordMarkdown('(||https://example.com/path||)').map(
          match => match.url
        )
      ).toEqual(['https://example.com/path'])
    })

    it('preserves balanced URL parentheses and legal query pipes', () => {
      const url = 'https://example.com/wiki/Function_(math)?filter=one|two'
      expect(extractUrlsFromDiscordMarkdown(url)[0]?.url).toBe(url)
    })
  })

  it('extracts full URL containing unencoded pipes in query string and replaces without fragments', async () => {
    const fullAliexpressUrl =
      'https://www.aliexpress.com/ssr/300000512/kr2024update?spm=a2g0o.home.pcJustForYou.3.617752d1HcX0kK&productIds=1005008077639347%3A12000043565570669&pha_manifest=ssr&_immersiveMode=true&disableNav=YES&sourceName=RECOMMENDProduct&utparam-url=scene%3ApcJustForYou|query_from%3A|x_object_id%3A1005010155247711|_p_origin_prod%3A1005006744716576&pvid=0059031a-cef1-4336-af29-96f1b3454437&_gl=1*ilk28o*_gcl_au*MTE3NzA4OTg3Mi4xNzg3OTI5ODQw*_ga*OTE1Njc5NjkyLjE3ODc5Mjk4NDA.*_ga_VED1YSGNC7*czE3ODg3MDI4NTgkbzEyJGcwJHQxNzg4NzAyODU4JGo2MCRsMCRoMA'

    const createdSlug = `mek-${testUserHash}`
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: fullAliexpressUrl }
    }))
    sinkClient.createLink = createLinkMock

    const sentPayloads: any[] = []
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload)
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {}
        }
      })
    }

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: 'Tester#0001',
        createDM: async () => mockDmChannel
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: 'test-channel' },
      content: `Here is the product: ${fullAliexpressUrl}`,
      url: 'https://discord.com/channels/1/2/3'
    }

    await onMessageCreate(mockMessage as any)

    // 1. Entire AliExpress URL must be passed to createLink, not truncated at |
    expect(createLinkMock).toHaveBeenCalledTimes(1)
    expect(createLinkMock.mock.calls[0][0].url).toBe(fullAliexpressUrl)

    // 2. Replaced text must contain short URL and NO leftover pipe parameter fragment
    expect(sentPayloads.length).toBe(2)
    expect(sentPayloads[1].content).toBe(
      `Here is the product: https://s.japsik.com/${createdSlug}`
    )
    expect(sentPayloads[1].content).not.toContain('|query_from')
  })

  it('handles URLs inside Discord spoiler tags without breaking spoiler syntax', async () => {
    const targetUrl = 'https://example.com/spoiler?param=1|2'
    const createdSlug = `spoil-${testUserHash}`
    sinkClient.createLink = async () => ({
      success: true,
      link: { slug: createdSlug, url: targetUrl }
    })

    const sentPayloads: any[] = []
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload)
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {}
        }
      })
    }

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: 'Tester#0001',
        createDM: async () => mockDmChannel
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: 'test-channel' },
      content: `Secret: ||${targetUrl}|| check it`,
      url: 'https://discord.com/channels/1/2/3'
    }

    await onMessageCreate(mockMessage as any)

    expect(sentPayloads.length).toBe(2)
    expect(sentPayloads[1].content).toBe(
      `Secret: ||https://s.japsik.com/${createdSlug}|| check it`
    )
  })

  it('shortens and replaces trailing-pipe URLs outside spoiler without stripping trailing pipe', async () => {
    const trailingPipeUrl = 'https://example.com/query?filter=|'
    const createdSlug = `pipeout-${testUserHash}`
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: trailingPipeUrl }
    }))
    sinkClient.createLink = createLinkMock

    const sentPayloads: any[] = []
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload)
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {}
        }
      })
    }

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: 'Tester#0001',
        createDM: async () => mockDmChannel
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: 'test-channel' },
      content: `Check this link: ${trailingPipeUrl}`,
      url: 'https://discord.com/channels/1/2/3'
    }

    await onMessageCreate(mockMessage as any)

    expect(createLinkMock).toHaveBeenCalledTimes(1)
    expect(createLinkMock.mock.calls[0][0].url).toBe(trailingPipeUrl)
    expect(sentPayloads[1].content).toBe(
      `Check this link: https://s.japsik.com/${createdSlug}`
    )
  })

  it('shortens and replaces trailing-pipe URLs inside spoiler preserving both trailing pipe and spoiler markup', async () => {
    const trailingPipeUrl = 'https://example.com/query?filter=|'
    const createdSlug = `pipein-${testUserHash}`
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: trailingPipeUrl }
    }))
    sinkClient.createLink = createLinkMock

    const sentPayloads: any[] = []
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload)
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {}
        }
      })
    }

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: 'Tester#0001',
        createDM: async () => mockDmChannel
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: 'test-channel' },
      content: `Secret: ||${trailingPipeUrl}||`,
      url: 'https://discord.com/channels/1/2/3'
    }

    await onMessageCreate(mockMessage as any)

    expect(createLinkMock).toHaveBeenCalledTimes(1)
    expect(createLinkMock.mock.calls[0][0].url).toBe(trailingPipeUrl)
    expect(sentPayloads[1].content).toBe(
      `Secret: ||https://s.japsik.com/${createdSlug}||`
    )
  })
})
