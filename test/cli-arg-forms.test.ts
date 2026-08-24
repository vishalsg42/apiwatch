import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/index.js'

/**
 * `--root=value` is the GNU attached form, and it is what a CI script or a shell alias most often
 * produces. apiwatch accepted only the space-separated form, so the attached one was rejected as
 * an unknown flag and exited 2, which reads as a broken tool rather than a syntax it does not
 * take. Both forms mean the same thing and must behave the same way.
 */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-args-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"a"}')
  writeFileSync(join(dir, 'src', 'a.ts'), "export const f = () => fetch('https://v.dev/a')")
  return dir
}
const run = async (args: string[]) => {
  let out = ''
  const code = await runCli(args, {
    write: (s: string) => {
      out += s
    },
  })
  return { code, out }
}

describe('attached and separated flag forms agree', () => {
  it('--root=<dir> works like --root <dir>', async () => {
    const dir = repo()
    const attached = await run(['audit', `--root=${dir}`])
    const separated = await run(['audit', '--root', dir])
    expect(attached.out).toBe(separated.out)
    expect(attached.code).toBe(separated.code)
  })

  it('--fail-on=error works like --fail-on error', async () => {
    const dir = repo()
    const attached = await run(['audit', `--root=${dir}`, '--fail-on=error'])
    const separated = await run(['audit', '--root', dir, '--fail-on', 'error'])
    expect(attached.code).toBe(separated.code)
    expect(attached.code).toBe(1) // the fixture has an unprotected fetch, so this must breach
  })

  // The control: attached parsing must not turn a genuinely bad flag into a silent pass.
  it('still rejects an unknown attached flag', async () => {
    const dir = repo()
    const r = await run(['audit', `--root=${dir}`, '--nonsense=1'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/unknown flag/)
  })

  it('still rejects a bad --fail-on value in attached form', async () => {
    const dir = repo()
    const r = await run(['audit', `--root=${dir}`, '--fail-on=banana'])
    expect(r.code).toBe(2)
  })
})
