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

/**
 * The root is normalized once, at discovery, because everything downstream keys off its text.
 *
 * A trailing slash broke two things at the same time and neither loudly. File paths are made
 * repo-relative by stripping `${root}/`, so the failed prefix match fell back to the ABSOLUTE
 * path, which is machine-specific and is what a baseline stores; and dependenciesByDir is keyed
 * by directories beneath the root, so every per-package lookup missed and legacy-client silently
 * vanished.
 *
 * The CLI resolves --root before it gets here, so no command could reach this. It was reachable
 * by calling runAudit or discoverWorkspace directly, which is how it was found, and normalizing
 * at the single place that establishes the root closes it for both.
 */
describe('the workspace root is normalized however it is spelled', () => {
  const spellings = ['', '/', '//'] as const

  it('a trailing slash changes neither the findings nor the paths', async () => {
    const runs = await Promise.all(
      spellings.map(async (suffix) => {
        const { model, sites } = await runAudit({
          root: `${fx('monorepo-node-fetch')}${suffix}`,
          json: true,
        })
        return {
          legacy: model.findings
            .filter((f) => f.rule === 'legacy-client')
            .map((f) => f.file)
            .sort(),
          files: [...new Set(sites.map((s) => s.file))].sort(),
        }
      }),
    )
    for (const [i, r] of runs.entries())
      expect(JSON.stringify(r), `root with "${spellings[i]}" disagreed`).toBe(
        JSON.stringify(runs[0]),
      )
    // and the shared answer is the right one, not an agreed-on absence
    expect(runs[0].legacy).toEqual(['packages/aaa/src/a.ts'])
    // paths stay repo-relative; an absolute one here is machine-specific and ends up in baselines
    for (const f of runs[0].files) expect(f.startsWith('/')).toBe(false)
  })
})
