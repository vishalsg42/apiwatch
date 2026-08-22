import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/index.js'
import { repoRoot } from './helpers.js'

describe('cli', () => {
  it('prints the version and exits 0', async () => {
    const out: string[] = []
    expect(await runCli(['--version'], { write: (s) => out.push(s) })).toBe(0)
    expect(out.join('')).toMatch(/^\d+\.\d+\.\d+/)
  })
  it('exits 1 on an unknown command', async () =>
    expect(await runCli(['nonsense'], { write: () => {} })).toBe(1))
  it('the cli entry starts with a shebang so npx works', () =>
    expect(readFileSync(join(repoRoot, 'src/cli/index.ts'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node\n/,
    ))

  // The built bin used to export runCli but never invoke it, so `node dist/cli.js --version`
  // printed nothing and exited 0 silently; the `bin` entry was inert. This guards the
  // entrypoint fix by actually spawning the built artifact. Skipped when dist/cli.js hasn't
  // been built yet (`pnpm vitest run` alone does not build); run `pnpm build` first to cover it.
  const distCli = join(repoRoot, 'dist/cli.js')
  it.skipIf(!existsSync(distCli))('the built binary actually produces output', () => {
    const out = execFileSync('node', [distCli, '--version'], { encoding: 'utf8' })
    expect(out).toMatch(/^\d+\.\d+\.\d+/)
  })
})
