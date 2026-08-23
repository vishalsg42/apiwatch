import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * The negative half of the client matrix, which 0.3.3 shipped without.
 *
 * 0.3.3 made destructured `require` work by binding EVERY named export of a supported module as
 * an HTTP client. `createServer` is a server, the opposite of an outbound call, and it fired
 * `no-timeout` at error severity. The matrix added at the time proved supported shapes are
 * DETECTED; nothing proved unrelated exports stay SILENT.
 */
const SILENT: [string, string][] = [
  ['createServer, ESM', 'esm-create-server.ts'],
  ['createServer, CJS destructured', 'cjs-create-server.js'],
  ['createServer, require().prop', 'prop-create-server.js'],
  ['isAxiosError, ESM', 'esm-is-axios-error.ts'],
  ['isAxiosError, require().prop', 'prop-is-axios-error.js'],
  ['http.Agent', 'esm-agent.ts'],
  ['node-fetch Headers', 'esm-headers.ts'],
]

describe('non-client exports are not HTTP clients', () => {
  for (const [label, file] of SILENT) {
    it(`stays silent: ${label}`, async () => {
      expect(await sitesFor('non-client-exports', file)).toHaveLength(0)
    })
  }

  // The counterpart: `default` really is the client, and must survive the allowlist.
  it('still detects require(spec).default', async () =>
    expect(await sitesFor('non-client-exports', 'prop-default.js')).toHaveLength(1))
})
