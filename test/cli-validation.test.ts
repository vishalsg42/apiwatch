import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/index.js'
import { fx } from './helpers.js'

const run = async (argv: string[]) => {
  const out: string[] = []
  const code = await runCli(argv, { write: (s) => out.push(s) })
  return { code, out: out.join('') }
}

describe('audit argument validation', () => {
  // The dangerous case: a mistyped path used to produce a clean zero-finding audit and exit 0,
  // so a CI job would go green precisely because nothing had been examined.
  it('fails when the root does not exist', async () => {
    const r = await run(['audit', '--root', '/path/that/does/not/exist', '--json'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/root does not exist/)
  })

  it('fails when the root is a file rather than a directory', async () => {
    const r = await run(['audit', '--root', `${fx('simple-express')}/package.json`])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/not a directory/)
  })

  // `--root --json` used to audit a directory literally named "--json".
  it('fails when a value flag is followed by another flag', async () => {
    const r = await run(['audit', '--root', '--json'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--root requires a value/)
  })

  it('fails when a value flag is last with no value', async () => {
    const r = await run(['audit', '--root', fx('simple-express'), '--fail-on'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--fail-on requires a value/)
  })

  it('rejects an invalid --fail-on value', async () => {
    const r = await run(['audit', '--root', fx('simple-express'), '--fail-on', 'banana'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/must be `error` or `warn`/)
  })

  it('rejects an unknown flag', async () => {
    const r = await run(['audit', '--root', fx('simple-express'), '--nonsense'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/unknown flag/)
  })

  it('rejects a stray positional argument', async () => {
    const r = await run(['audit', 'somewhere'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/unexpected argument/)
  })

  it('still accepts a valid invocation', async () => {
    const r = await run(['audit', '--root', fx('simple-express'), '--json'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out).schemaVersion).toBe(1)
  })
})
