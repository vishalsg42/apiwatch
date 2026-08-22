import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'
import { discoverWorkspace } from '../src/workspace/discover.js'
import { fx, tmpCopyOf } from './helpers.js'

const rel = (root: string, files: string[]) => files.map((f) => f.slice(root.length + 1)).sort()

describe('non-shipping directories', () => {
  it('leaves example, benchmark and doc code out of the audited set', async () => {
    const root = fx('non-shipping')
    const w = await discoverWorkspace(root)
    expect(rel(root, w.sourceFiles)).toEqual(['scripts/release.js', 'src/svc.js'])
  })

  it('keeps scripts/ in scope, since real runtime code lives there', async () => {
    const w = await discoverWorkspace(fx('non-shipping'))
    expect(w.sourceFiles.some((f) => f.endsWith('scripts/release.js'))).toBe(true)
  })

  it('counts what it excluded rather than dropping it silently', async () => {
    const w = await discoverWorkspace(fx('non-shipping'))
    expect(w.nonShippingFilesExcluded).toBe(3)
  })

  it('audits everything under --include-non-shipping, and then excludes nothing', async () => {
    const root = fx('non-shipping')
    const w = await discoverWorkspace(root, { includeNonShipping: true })
    expect(rel(root, w.sourceFiles)).toEqual([
      'benchmark/bench.js',
      'docs/snippet.js',
      'examples/quickstart.js',
      'scripts/release.js',
      'src/svc.js',
    ])
    expect(w.nonShippingFilesExcluded).toBe(0)
  })

  it('reports only shipped call sites by default', async () => {
    const r = await runAudit({ root: tmpCopyOf('non-shipping'), json: true })
    expect(r.model.callSiteCount).toBe(2)
    expect(r.model.findings.every((f) => !f.file.includes('examples/'))).toBe(true)
  })

  it('finds the example call sites when asked to', async () => {
    const r = await runAudit({
      root: tmpCopyOf('non-shipping'),
      json: true,
      includeNonShipping: true,
    })
    expect(r.model.callSiteCount).toBe(5)
  })

  it('tells the reader what it skipped', async () => {
    const r = await runAudit({ root: tmpCopyOf('non-shipping') })
    expect(r.output).toMatch(/skipped 3 files in example\/benchmark\/doc dirs/)
  })

  it('says nothing about exclusions when there are none', async () => {
    const r = await runAudit({ root: tmpCopyOf('simple-express') })
    expect(r.output).not.toMatch(/skipped \d+ files/)
  })
})
