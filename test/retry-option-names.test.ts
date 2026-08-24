import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * A config key only proves retry if the client it is passed to implements it.
 *
 * `retry` and `retries` were accepted as proof for every client. Only `got` actually has such an
 * option: `AxiosRequestConfig` declares no `retry` key, and neither does `RequestInit`, so
 * `axios.get(url, { retry: 3 })` is inert. The key does nothing, the call is never re-attempted,
 * and apiwatch reported it as protected. A silent suppression of a real finding, which this
 * project treats as seriously as a false positive.
 *
 * Found by a judge qualification set built for the no-retry precision audit: two reviewers,
 * shown the fixture blind and asked only whether anything re-attempts the request, both said no.
 * They were right and apiwatch was wrong. See issue #5.
 */
const of_ = async (file: string) => {
  const s = (await sitesFor('retry-option-names', file))[0]
  return { retry: s.options.retry, reason: s.options.retryReason }
}

describe('a retry option counts only for a client that implements it', () => {
  // The defect. These now report, where before they were silently suppressed.
  it('axios `retry` is inert, so the call has no retry', async () =>
    expect(await of_('axios-inert-retry.ts')).toEqual({ retry: 'none', reason: 'absent' }))

  it('axios `retries` is inert too', async () =>
    expect(await of_('axios-inert-retries.ts')).toEqual({ retry: 'none', reason: 'absent' }))

  it('fetch `retry` is inert, since RequestInit has no such key', async () =>
    expect(await of_('fetch-inert-retry.ts')).toEqual({ retry: 'none', reason: 'absent' }))

  // The other half. Narrowing must not swallow the shapes that ARE real retry, or the fix trades
  // one silent wrong answer for a loud one.
  it("axios-retry's own `axios-retry` key does count", async () =>
    expect(await of_('axios-real-retry.ts')).toEqual({ retry: 'library', reason: 'explicit' }))

  it('got `retry` counts, because got implements it', async () =>
    expect(await of_('got-real-retry.ts')).toEqual({ retry: 'library', reason: 'explicit' }))

  it('got `retry: { limit: 0 }` still reads as deliberately disabled', async () =>
    expect(await of_('got-disabled-retry.ts')).toEqual({ retry: 'none', reason: 'disabled' }))
})
