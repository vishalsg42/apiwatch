import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/index.js'

const repo = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-drift-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', dependencies: { axios: '^1.7.0' } }),
  )
  writeFileSync(join(dir, 'svc.ts'), source)
  return dir
}
const edit = (dir: string, source: string) => writeFileSync(join(dir, 'svc.ts'), source)

const run = async (argv: string[]) => {
  const out: string[] = []
  const code = await runCli(argv, { write: (s) => out.push(s) })
  return { code, out: out.join('') }
}
const makeBaseline = (dir: string) =>
  run(['baseline', '--root', dir, '--out', join(dir, 'bl.json')])
const audit = (dir: string, ...extra: string[]) =>
  run(['audit', '--root', dir, '--baseline', join(dir, 'bl.json'), ...extra])

const ONE = `import axios from 'axios'
export const load = () => axios.get('https://api.vendor.dev/one')
`

describe('audit --baseline', () => {
  it('reports nothing new against its own baseline, even with --fail-on error', async () => {
    const dir = repo(ONE)
    await makeBaseline(dir)
    const r = await audit(dir, '--fail-on', 'error')
    expect(r.code).toBe(0)
  })

  it('fails on a genuinely new call', async () => {
    const dir = repo(ONE)
    await makeBaseline(dir)
    edit(dir, `${ONE}export const probe = () => axios.get('https://api.vendor.dev/two')\n`)
    const r = await audit(dir, '--fail-on', 'error')
    expect(r.code).toBe(1)
    // The new call is on line 3; the accepted one on line 2 must not resurface.
    expect(r.out).toMatch(/svc\.ts:3/)
    expect(r.out).not.toMatch(/svc\.ts:2/)
    expect(r.out).toMatch(/baseline: 4 accepted/)
  })

  // The regression the reviewers found: keying on fingerprint alone hides this, because the
  // aggregate count is unchanged and the "new" finding surfaced is an info that already existed.
  it('fails when a timeout is removed from an already accepted call', async () => {
    const dir = repo(`import axios from 'axios'
export const load = () => axios.get('https://api.vendor.dev/one', { timeout: 5000 })
`)
    await makeBaseline(dir)
    edit(dir, ONE)
    const r = await audit(dir, '--fail-on', 'error')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no-timeout/)
  })

  it('leaves an accepted finding accepted when a different call is inserted before it', async () => {
    const dir = repo(`import axios from 'axios'
export const load = () => {
  return axios.get('https://api.vendor.dev/accepted')
}
`)
    await makeBaseline(dir)
    edit(
      dir,
      `import axios from 'axios'
export const load = () => {
  axios.get('https://api.vendor.dev/new-risk')
  return axios.get('https://api.vendor.dev/accepted')
}
`,
    )
    const r = await audit(dir, '--fail-on', 'error')
    expect(r.code).toBe(1)
    // The inserted call is line 3; the accepted one moved to line 4 and must stay accepted.
    expect(r.out).toMatch(/svc\.ts:3/)
    expect(r.out).not.toMatch(/svc\.ts:4/)
    expect(r.out).toMatch(/baseline: 4 accepted/)
  })

  // Fixing something must never turn CI red, or the gate gets disabled.
  it('reports a resolved finding but still exits 0', async () => {
    const dir = repo(ONE)
    await makeBaseline(dir)
    edit(
      dir,
      `import axios from 'axios'
export const load = () => axios.get('https://api.vendor.dev/one', { timeout: 5000 })
`,
    )
    const r = await audit(dir, '--fail-on', 'error')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/resolved|stale/i)
  })

  it('exits 2 when the baseline file does not exist', async () => {
    const dir = repo(ONE)
    const r = await run(['audit', '--root', dir, '--baseline', join(dir, 'missing.json')])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/not found/i)
  })

  it('exits 2 when the baseline was recorded against a different root', async () => {
    const dir = repo(ONE)
    await makeBaseline(dir)
    const sub = mkdtempSync(join(dir, 'sub-'))
    writeFileSync(join(sub, 'package.json'), '{"name":"s","version":"1.0.0"}')
    const r = await run(['audit', '--root', sub, '--baseline', join(dir, 'bl.json')])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/root/i)
  })
})
