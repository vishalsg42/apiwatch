import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * A KNOWN GAP, pinned rather than fixed.
 *
 * `findCallSites` resolves a call's client by matching the callee's source text against a binding
 * name. A client chosen by an expression produces text like `(insecure ? http : https)`, which
 * matches nothing, so the call is skipped. Nothing records it: not the call-site count, not the
 * unresolved-host count, not the skipped-file count, and the file still reports as analysed. It is
 * the only limitation in the README with no visible symptom whatsoever, which is exactly why it
 * needs a test: a silent gap cannot be noticed by using the tool.
 *
 * Measured on stripe-node, whose client is `(isInsecureConnection ? http : https).request({...})`
 * and which therefore reports zero call sites for its entire HTTP layer.
 *
 * These tests assert TODAY'S behaviour, not desired behaviour. If someone teaches the resolver to
 * follow an expression, they will fail, and that is the point: the README claims this gap exists,
 * so the claim must break when it stops being true. Each case carries a named-client control, so a
 * failure means the gap moved rather than the fixture rotting.
 */
describe('a client selected by an expression', () => {
  it('is invisible when chosen by a ternary, while the named control is found', async () => {
    const sites = await sitesFor('expression-client', 'ternary.ts')
    expect(sites).toHaveLength(1)
    expect(sites[0].line).toBe(12) // viaName, not viaTernary
    expect(sites[0].client).toBe('node:http')
  })

  it('is invisible when read out of a map, while the named control is found', async () => {
    const sites = await sitesFor('expression-client', 'indexed.ts')
    expect(sites).toHaveLength(1)
    expect(sites[0].line).toBe(6) // viaName, not viaIndex
    expect(sites[0].client).toBe('axios')
  })
})
