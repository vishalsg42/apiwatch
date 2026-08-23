import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.js'

const readme = () => readFileSync(join(repoRoot, 'README.md'), 'utf8')

describe('readme', () => {
  it('shows the install line and a before/after block', () => {
    expect(readme()).toMatch(/npx apiwatch audit/)
    expect(readme()).toMatch(/## Before/)
    expect(readme()).toMatch(/## After/)
  })
  it('states plainly that it is static-only', () =>
    expect(readme()).toMatch(/static[^\n]*only|does not run your (app|code)/i))
  it('documents the known limitations honestly', () => expect(readme()).toMatch(/## Limitations/))
  it('documents the CI guard with a copy-pasteable workflow', () => {
    expect(readme()).toMatch(/## CI guard/)
    expect(readme()).toMatch(/apiwatch baseline/)
    expect(readme()).toMatch(/--baseline \.apiwatch-baseline\.json/)
  })

  // The workflow pins an exact version so a copied CI job cannot silently drift onto a
  // release it was never tested against. Publishing does not rewrite this line, and it has
  // already gone stale once: 0.3.3 shipped while the README still pinned an older tag, so
  // every copied workflow stayed on the buggy version.
  it('pins the CI workflow to the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    const pinned = readme().match(/npx apiwatch@([\d.]+) audit/)
    expect(pinned, 'README CI workflow must pin an exact apiwatch version').not.toBeNull()
    expect(pinned?.[1]).toBe(pkg.version)
  })
})
