import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot, tmpDir } from './helpers.js'

// Regression for the bug that shipped in a real `npm pack` + `npm install`: npm links a bin as
// a SYMLINK, and `./node_modules/.bin/apiwatch --version` printed nothing and exited 0; the
// published binary did nothing. `test/cli.test.ts` runs `node dist/cli.js` by its direct path,
// which never exercises the symlink, so that test suite passed while the real install was
// broken. This test reproduces the real consumer path: pack the tarball, install it into a
// clean project, and invoke the SYMLINKED bin exactly as `npx apiwatch` / a project's own
// `node_modules/.bin/apiwatch` would.
const distCli = join(repoRoot, 'dist/cli.js')
describe.skipIf(!existsSync(distCli))('packed install', () => {
  it('the symlinked bin from a real npm install prints the version', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'apiwatch-pack-'))
    execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })
    const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith('.tgz')) as string)

    const consumer = tmpDir()
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'apiwatch-consumer', version: '0.0.0', private: true }),
    )
    execFileSync('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: consumer })

    const bin = join(consumer, 'node_modules/.bin/apiwatch')
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8' })
    expect(out).toMatch(/^\d+\.\d+\.\d+/)
  }, 120_000)
})
