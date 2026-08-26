import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * A client selected by an expression.
 *
 * `findCallSites` resolves a call's client by matching the callee's source text against a binding
 * name, so a client chosen by an expression produced text like `(insecure ? http : https)`, which
 * matched nothing and the call was skipped. Nothing recorded it: not the call-site count, not the
 * unresolved-host count, not the skipped-file count, and the file still reported as analysed. It
 * was the only limitation in the README with no visible symptom whatsoever. See #6.
 *
 * This file used to pin that gap and said so: "if someone teaches the resolver to follow an
 * expression, they will fail, and that is the point." They now do follow one, so the assertions
 * moved, and the controls are what prove the gap closed rather than the fixtures rotting.
 *
 * The gap did not close everywhere, and the second test is the part that remains. A ternary can be
 * resolved because both arms are visible and can be required to agree; an element access cannot,
 * because which client `clients[name]` returns is a runtime fact. Guessing there would invent a
 * call site rather than find one, so it still abstains, and the zero-callsite diagnostic is what
 * makes that abstention visible.
 */
describe('a client selected by an expression', () => {
  it('is found when chosen by a ternary whose arms agree', async () => {
    const sites = await sitesFor('expression-client', 'ternary.ts')
    expect(sites).toHaveLength(2)
    expect(sites.map((s) => s.line).sort((a, b) => a - b)).toEqual([8, 12])
    for (const s of sites) expect(s.client).toBe('node:http')
    // the ternary call's own config is still read normally: it names a host and no timeout
    const viaTernary = sites.find((s) => s.line === 8)
    expect(viaTernary?.method).toBe('request')
    expect(viaTernary?.options.timeoutMs).toBeNull()
  })

  it('still abstains when the client is read out of a map, and the control is found', async () => {
    const sites = await sitesFor('expression-client', 'indexed.ts')
    expect(sites).toHaveLength(1)
    expect(sites[0].line).toBe(6) // viaName, not viaIndex
    expect(sites[0].client).toBe('axios')
  })
})
