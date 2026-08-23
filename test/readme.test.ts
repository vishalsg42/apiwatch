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
})
