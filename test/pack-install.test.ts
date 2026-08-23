import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
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

/**
 * The unit suite imports `src/`, so it cannot see a defect introduced by the build, by `files`
 * in package.json, or by anything that only exists in the tarball. These run the SAME
 * behavioural claims 0.3.4 is being released for, through the installed binary.
 */
describe.skipIf(!existsSync(distCli))('packed artifact behaviour', () => {
  let bin = ''

  beforeAll(() => {
    const packDir = mkdtempSync(join(tmpdir(), 'apiwatch-pack-b-'))
    execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })
    const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith('.tgz')) as string)
    const consumer = tmpDir()
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'apiwatch-consumer', version: '0.0.0', private: true }),
    )
    execFileSync('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: consumer })
    bin = join(consumer, 'node_modules/.bin/apiwatch')
  }, 180_000)

  const audit = (root: string, ...extra: string[]) => {
    const r = spawnSync(bin, ['audit', '--root', root, '--json', ...extra], { encoding: 'utf8' })
    return { code: r.status, model: r.stdout.trim() ? JSON.parse(r.stdout) : undefined }
  }
  const fixture = (name: string) => join(repoRoot, 'test/fixtures', name)

  it('reports no call sites for non-client named exports', () => {
    const { model } = audit(fixture('non-client-exports'))
    // prop-default.js is the one genuine client in that fixture: `require('axios').default`.
    expect(model.callSiteCount).toBe(1)
    expect(model.findings.every((f: { file: string }) => f.file.endsWith('prop-default.js'))).toBe(
      true,
    )
  })

  it('reports a factory-derived instance on its calls, not on the create() call', () => {
    const { model } = audit(fixture('client-factories'))
    const lines = model.findings
      .filter((f: { rule: string; file: string }) => f.rule === 'no-timeout')
      .map((f: { line: number }) => f.line)
    expect(lines.length).toBeGreaterThan(0)
    // `const api = create({...})` sits on line 2 of axios-create.ts; findings belong to the
    // calls on 3 and 4. A finding on line 2 means the factory itself was reported.
    expect(lines).not.toContain(2)
  })

  it('resolves a client re-exported under a quoted CommonJS key', () => {
    const { model } = audit(fixture('quoted-reexport'))
    expect(model.callSiteCount).toBe(1)
  })

  // The spread false positive was the widest-reaching defect in 0.3.5 and it lives entirely in
  // option resolution, so prove it through the shipped binary rather than only through src/.
  it('does not report a timeout absent behind an opaque spread', () => {
    const { model } = audit(fixture('spread-config'))
    const lines = model.findings
      .filter((f: { rule: string; file: string }) => f.rule === 'no-timeout')
      .map((f: { file: string }) => f.file)
    expect(lines).not.toContain('src/axios-spread-only.ts')
    // The twin must still fire, or this passes for the wrong reason: an analyser that abstained
    // everywhere would satisfy the assertion above.
    expect(lines).toContain('src/axios-empty-object.ts')
  })

  it('reports a missing timeout on the callback overload, and keeps the verb', () => {
    const { model } = audit(fixture('method-matrix'))
    const nt = model.findings.filter((f: { rule: string }) => f.rule === 'no-timeout')
    expect(nt.map((f: { file: string }) => f.file)).toContain('src/nhs-namespace-url-callback.js')
    const post = nt.find((f: { file: string }) =>
      f.file.endsWith('rp-cjs-destructured-post-opts-absent.js'),
    )
    expect(post?.evidence).toContain('request-promise.post')
    // A POST is not idempotent, so no-retry must stay silent on it.
    const retries = model.findings.filter(
      (f: { rule: string; file: string }) =>
        f.rule === 'no-retry' && f.file.endsWith('rp-cjs-destructured-post-opts-absent.js'),
    )
    expect(retries).toHaveLength(0)
  })

  it('completes a baseline round trip that can return to green', () => {
    const dir = tmpDir()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 't', version: '1.0.0', dependencies: { axios: '^1.7.0' } }),
    )
    const call = "  axios.get('https://api.vendor.dev/one')\n"
    const src = (n: number) =>
      `import axios from 'axios'\nexport const load = () => {\n${call.repeat(n)}}\n`
    const bl = join(dir, 'bl.json')
    writeFileSync(join(dir, 'svc.ts'), src(1))

    const run = (...argv: string[]) => spawnSync(bin, argv, { encoding: 'utf8' })
    expect(run('baseline', '--root', dir, '--out', bl).status).toBe(0)

    writeFileSync(join(dir, 'svc.ts'), src(2))
    const gate = ['audit', '--root', dir, '--baseline', bl, '--fail-on', 'error']
    expect(run(...gate).status).toBe(1)

    const accepted = run('baseline', 'accept', '--root', dir, '--out', bl)
    expect(accepted.status).toBe(0)
    expect(accepted.stdout).not.toMatch(/nothing new to accept/)
    expect(run(...gate).status).toBe(0)

    writeFileSync(join(dir, 'svc.ts'), src(1))
    expect(run('baseline', 'prune', '--root', dir, '--out', bl).status).toBe(0)
    expect(run(...gate).status).toBe(0)
  }, 60_000)
})
