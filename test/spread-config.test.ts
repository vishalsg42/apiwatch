import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * `prop()` reads a config object's OWN top-level properties, so it cannot see through a
 * `SpreadAssignment`. An object literal containing one was nonetheless treated as fully
 * readable, and an absent `timeout` was reported as PROVEN ABSENT rather than unknown. That is
 * an error-severity false positive on `{ ...defaults }`, which is ordinary code.
 *
 * The giveaway that this was an oversight and not a policy: an Identifier config
 * (`axios.get(url, cfg)`) correctly abstains, while `{ ...cfg }` did not.
 *
 * The contract this restores: a spread makes ABSENCE and DISABLEMENT unprovable. An explicitly
 * present property is still read, because that only ever leads to silence or a concrete value,
 * never to a finding.
 */
const opt = async (file: string) => (await sitesFor('spread-config', file))[0].options

describe('a spread makes absence unprovable', () => {
  it('does not claim a timeout is absent when a spread could supply it', async () =>
    expect((await opt('axios-spread-only.ts')).timeoutMs).toBe('unknown'))

  it('still reads an explicit timeout written after the spread', async () =>
    expect((await opt('axios-spread-then-timeout.ts')).timeoutMs).toBe(5000))

  // Position-independent by choice. A later spread could overwrite the key at runtime, but
  // reading the explicit value only ever keeps no-timeout silent, so the extra precision would
  // change no finding. What a spread must never do is let apiwatch PROVE absence.
  it('reads an explicit timeout written before the spread', async () =>
    expect((await opt('axios-timeout-then-spread.ts')).timeoutMs).toBe(5000))

  it('still proves absence for an empty object, which hides nothing', async () =>
    expect((await opt('axios-empty-object.ts')).timeoutMs).toBeNull())

  it('leaves an identifier config unknown, as it always did', async () =>
    expect((await opt('axios-identifier-config.ts')).timeoutMs).toBe('unknown'))

  // `timeout: 0` means "no timeout" and normally proves absence. With a spread present it
  // cannot, because the spread may itself carry a timeout that this key then zeroes, or not.
  it('does not let timeout: 0 prove absence alongside a spread', async () =>
    expect((await opt('axios-spread-zero-timeout.ts')).timeoutMs).toBe('unknown'))

  it('does not let retry: 0 prove disablement alongside a spread', async () =>
    expect((await opt('axios-spread-retry-disabled.ts')).retry).toBe('unknown'))

  it('applies to retry absence too, not only timeout', async () =>
    expect((await opt('axios-spread-only.ts')).retry).toBe('unknown'))

  it('applies to a request-family bare call, not only axios', async () => {
    const o = await opt('rp-spread-bare.js')
    expect(o.timeoutMs).toBe('unknown')
    expect(o.retry).toBe('unknown')
  })
})

/**
 * The coarse rule "any spread means unknown" cost a genuine error-severity finding on real code:
 * `axios({ method, url, headers, ...(body && { data }), responseType })` really does set no
 * timeout, and the spread can only ever contribute `data`. A spread whose keys are statically
 * visible hides nothing, so absence stays provable.
 */
describe('a spread whose keys are visible hides nothing', () => {
  it('still proves absence through a conditional spread of an object literal', async () =>
    expect((await opt('axios-conditional-spread.ts')).timeoutMs).toBeNull())

  it('reads a value supplied by a conditional spread', async () =>
    expect((await opt('axios-conditional-spread-timeout.ts')).timeoutMs).toBe(5000))

  it('reads a value supplied through a ternary spread', async () =>
    expect((await opt('axios-ternary-spread.ts')).timeoutMs).toBe(5000))

  // Only one branch is readable, so the other could carry anything.
  it('stays unknown when a ternary spread has one opaque branch', async () =>
    expect((await opt('axios-ternary-half-opaque.ts')).timeoutMs).toBe('unknown'))
})
