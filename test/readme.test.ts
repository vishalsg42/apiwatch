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
  it('states plainly that v0.1 is static-only', () =>
    expect(readme()).toMatch(/static[^\n]*only|does not run your (app|code)/i))
  it('documents the known limitations honestly', () => expect(readme()).toMatch(/## Limitations/))
  it('says drift detection is future work', () => expect(readme()).toMatch(/drift[^\n]*v0\.2/i))
})
