import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * `pickUrlArg` fell through to "the first non-object argument" when an options object carried
 * neither `url` nor `uri`, which for node:http's `{ host, path }` convention is the CALLBACK.
 * `urlKeyOf` feeds the fingerprint, so two calls to different hosts in one function collapsed
 * into a single identity: 2 findings, 1 fingerprint, stored as one baseline entry with count 2.
 * Fix one call, add another to a third host, and the audit stays green.
 */
describe('url selection for options-object calls', () => {
  it('gives two calls to different hosts two distinct fingerprints', async () => {
    const sites = await sitesFor('url-arg', 'two-hosts.js')
    expect(sites).toHaveLength(2)
    expect(new Set(sites.map((s) => s.fingerprint)).size).toBe(2)
  })

  it('does not treat the callback as the url', async () => {
    const [s] = await sitesFor('url-arg', 'single-host.js')
    expect(s.url).not.toMatchObject({ expr: expect.stringContaining('=>') })
  })

  // Still distinct when the hosts differ only via `hostname`, node:http's other spelling.
  it('reads hostname as well as host', async () => {
    const sites = await sitesFor('url-arg', 'hostname-variant.js')
    expect(new Set(sites.map((s) => s.fingerprint)).size).toBe(2)
  })
})
