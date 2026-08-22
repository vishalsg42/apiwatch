import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../src/cli/index.js'
import { repoRoot } from './helpers.js'

describe('cli', () => {
  it('prints the version and exits 0', async () => {
    const out: string[] = []
    expect(await runCli(['--version'], { write: s => out.push(s) })).toBe(0)
    expect(out.join('')).toMatch(/^\d+\.\d+\.\d+/)
  })
  it('exits 1 on an unknown command', async () =>
    expect(await runCli(['nonsense'], { write: () => {} })).toBe(1))
  it('the cli entry starts with a shebang so npx works', () =>
    expect(readFileSync(join(repoRoot, 'src/cli/index.ts'), 'utf8'))
      .toMatch(/^#!\/usr\/bin\/env node\n/))
})
