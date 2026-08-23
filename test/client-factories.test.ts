import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * `create` (axios, got) and `defaults` (request) are REAL named exports, so an allowlist that
 * merely rejected them would turn a loud false positive into total silence. Measured on 0.3.3:
 * `import { create } from 'axios'` reported one finding on the `create()` call itself, at the
 * wrong line, while the two genuine calls on the derived instance were already invisible.
 *
 * A factory must be BOUND so the instance derives, and must not itself be a call site. That
 * turns one misplaced finding into the correct ones.
 */
describe('factory exports derive a client rather than being a call site', () => {
  it('reports the derived instance calls, not create() itself', async () => {
    const sites = await sitesFor('client-factories', 'axios-create.ts')
    expect(sites.map((s) => s.line).sort((a, b) => a - b)).toEqual([3, 4])
    expect(sites.every((s) => s.client === 'axios')).toBe(true)
  })

  it('carries the instance timeout onto the derived calls', async () => {
    const sites = await sitesFor('client-factories', 'axios-create-timeout.ts')
    expect(sites).toHaveLength(1)
    expect(sites[0].options.timeoutMs).toBe('instance-default')
  })

  it('treats request-promise defaults() the same way', async () => {
    const sites = await sitesFor('client-factories', 'rp-defaults.js')
    expect(sites.map((s) => s.line)).toEqual([3])
  })
})
