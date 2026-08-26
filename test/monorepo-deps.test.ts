import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'
import { fx } from './helpers.js'

/**
 * A file's dependency versions come from the package that owns it.
 *
 * `legacy-client` reports node-fetch v2 as superseded by the global fetch. It used to read a
 * single map built by merging every package.json in filesystem walk order, so in a monorepo
 * holding both majors the answer was whichever file the walk happened to reach last. Walk order
 * is filesystem order, so macOS and Linux could disagree, and a baseline committed on one
 * disagreed with CI on the other. See #9.
 *
 * The fixture is built so the two behaviours give visibly different answers rather than merely
 * different reasoning: `zzz` sorts after `aaa`, so a last-one-wins merge lands on v3 and reports
 * NOTHING, while resolving per file reports exactly the v2 package and leaves v3 alone.
 */
describe('dependency versions resolve against the package that owns the file', () => {
  it('reports the v2 package and not the v3 one', async () => {
    const { model } = await runAudit({ root: fx('monorepo-node-fetch'), json: true })
    const legacy = model.findings.filter((f) => f.rule === 'legacy-client')
    expect(legacy.map((f) => f.file).sort()).toEqual(['packages/aaa/src/a.ts'])
  })

  it('both packages are analysed, so the v3 silence is a verdict and not an absence', async () => {
    const { sites } = await runAudit({ root: fx('monorepo-node-fetch'), json: true })
    expect(sites.map((s) => s.file).sort()).toEqual([
      'packages/aaa/src/a.ts',
      'packages/zzz/src/z.ts',
    ])
  })
})
