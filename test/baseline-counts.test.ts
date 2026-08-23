import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/index.js'

/**
 * `audit` compares baseline COUNTS, but `accept` and `prune` compared only key existence, so a
 * repo with two structurally identical calls could reach a state with no way back to green:
 * the second call is correctly reported as new, and `accept` then says "nothing new to accept".
 *
 * These assert the AUDIT EXIT CODE after each maintenance command, not just the file contents.
 * The file being right is not the property that matters; being able to return to green is.
 */
const repo = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-count-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', dependencies: { axios: '^1.7.0' } }),
  )
  writeFileSync(join(dir, 'svc.ts'), body)
  return dir
}
const edit = (dir: string, body: string) => writeFileSync(join(dir, 'svc.ts'), body)

const run = async (argv: string[]) => {
  const out: string[] = []
  const code = await runCli(argv, { write: (s) => out.push(s) })
  return { code, out: out.join('') }
}
const bl = (dir: string) => join(dir, 'bl.json')
const makeBaseline = (dir: string) => run(['baseline', '--root', dir, '--out', bl(dir)])
const accept = (dir: string) => run(['baseline', 'accept', '--root', dir, '--out', bl(dir)])
const prune = (dir: string) => run(['baseline', 'prune', '--root', dir, '--out', bl(dir)])
const audit = (dir: string) =>
  run(['audit', '--root', dir, '--baseline', bl(dir), '--fail-on', 'error'])

const countOf = (dir: string, rule: string): number | undefined =>
  JSON.parse(readFileSync(bl(dir), 'utf8')).accepted.find((e: { rule: string }) => e.rule === rule)
    ?.count

// Two calls that are byte-identical inside one function share a fingerprint by design
// (fingerprints are position-independent), so they collapse to one entry with count 2.
const call = "  axios.get('https://api.vendor.dev/one')\n"
const src = (n: number) =>
  `import axios from 'axios'\nexport const load = () => {\n${call.repeat(n)}}\n`

describe('baseline accept and prune are count-aware', () => {
  it('accepts a second identical call, and the audit returns to green', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    edit(dir, src(2))
    expect((await audit(dir)).code).toBe(1)

    const a = await accept(dir)
    expect(a.code).toBe(0)
    expect(countOf(dir, 'no-timeout')).toBe(2)
    expect((await audit(dir)).code).toBe(0)
  })

  it('lowers the stored count when one of two identical calls is removed', async () => {
    const dir = repo(src(2))
    await makeBaseline(dir)
    edit(dir, src(1))
    const p = await prune(dir)
    expect(p.code).toBe(0)
    expect(countOf(dir, 'no-timeout')).toBe(1)
    expect((await audit(dir)).code).toBe(0)
  })

  // Monotonicity, first half: accept must never DECREASE a count, or it silently prunes.
  it('accept leaves a count alone when the baseline exceeds the current run', async () => {
    const dir = repo(src(2))
    await makeBaseline(dir)
    edit(dir, src(1))
    await accept(dir)
    expect(countOf(dir, 'no-timeout')).toBe(2)
  })

  // Monotonicity, second half: prune must never INCREASE a count, or it silently accepts.
  it('prune leaves a count alone when the current run exceeds the baseline, staying red', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    edit(dir, src(2))
    await prune(dir)
    expect(countOf(dir, 'no-timeout')).toBe(1)
    expect((await audit(dir)).code).toBe(1)
  })

  it('reports occurrences, not entries, when a duplicated finding disappears entirely', async () => {
    const dir = repo(src(2))
    await makeBaseline(dir)
    edit(dir, "export const load = () => 'no calls here'\n")
    const p = await prune(dir)
    // Four rules fired on each of the two calls: 8 occurrences across 4 entries.
    expect(p.out).toMatch(/8 occurrence/)
    expect(countOf(dir, 'no-timeout')).toBeUndefined()
  })

  it('names the occurrence bump it is absorbing rather than only new keys', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    edit(dir, src(2))
    const a = await accept(dir)
    expect(a.out).toMatch(/no-timeout/)
    expect(a.out).not.toMatch(/nothing new to accept/)
  })

  it('is idempotent: accepting twice changes nothing', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    edit(dir, src(2))
    await accept(dir)
    const first = readFileSync(bl(dir), 'utf8')
    const second = await accept(dir)
    expect(readFileSync(bl(dir), 'utf8')).toBe(first)
    expect(second.out).toMatch(/nothing new to accept/)
  })

  // Identity is `rule:fingerprint`, so a call whose findings change RULE produces a new key and
  // strands the old one. Adding a timeout resolves no-timeout without touching the call's
  // other findings.
  it('treats a changed rule as a new key and leaves the old one stale until pruned', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    edit(
      dir,
      `import axios from 'axios'\nexport const load = () => {\n  axios.get('https://api.vendor.dev/one', { timeout: 2000 })\n}\n`,
    )
    expect(countOf(dir, 'no-timeout')).toBe(1)
    await prune(dir)
    expect(countOf(dir, 'no-timeout')).toBeUndefined()
    expect(countOf(dir, 'hardcoded-host')).toBe(1)
  })
})

describe('baseline count validation', () => {
  const withCount = (count: unknown) => {
    const dir = repo(src(1))
    return { dir, count }
  }

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '2'],
    ['missing', undefined],
  ])('rejects a %s count rather than computing with it', async (_label, count) => {
    const { dir } = withCount(count)
    await makeBaseline(dir)
    const parsed = JSON.parse(readFileSync(bl(dir), 'utf8'))
    parsed.accepted[0].count = count
    writeFileSync(bl(dir), JSON.stringify(parsed))
    const r = await audit(dir)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/invalid count/)
  })
})

/**
 * Before this was fixed the recovery path was a closed loop, verified end to end: `audit` said
 * to regenerate with `apiwatch baseline`; `baseline` refused to overwrite and pointed at
 * `accept`/`prune`; both of those re-threw the same version mismatch. No message anywhere
 * mentioned deleting the file, so a FP_VERSION bump left every baselined repo permanently red.
 */
describe('a baseline from an older fingerprintVersion can be regenerated', () => {
  const staleBaseline = async (dir: string) => {
    await makeBaseline(dir)
    const b = JSON.parse(readFileSync(bl(dir), 'utf8'))
    b.fingerprintVersion = b.fingerprintVersion - 1
    writeFileSync(bl(dir), JSON.stringify(b, null, 2))
  }

  it('refuses accept and prune, which cannot rewrite a stale identity', async () => {
    const dir = repo(src(1))
    await staleBaseline(dir)
    expect((await accept(dir)).code).toBe(2)
    expect((await prune(dir)).code).toBe(2)
  })

  it('regenerates rather than refusing, and returns the audit to green', async () => {
    const dir = repo(src(1))
    await staleBaseline(dir)
    const r = await run(['baseline', '--root', dir, '--out', bl(dir)])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/regenerating/)
    expect((await audit(dir)).code).toBe(0)
  })

  // Regenerating accepts everything visible, so a genuine build-failing finding must not pass
  // as one number in a count.
  it('names the error-severity findings it just absorbed', async () => {
    const dir = repo(src(1))
    await staleBaseline(dir)
    const r = await run(['baseline', '--root', dir, '--out', bl(dir)])
    expect(r.out).toMatch(/error severity/)
  })

  it('still refuses to clobber a baseline whose version matches', async () => {
    const dir = repo(src(1))
    await makeBaseline(dir)
    const r = await run(['baseline', '--root', dir, '--out', bl(dir)])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/already exists/)
  })
})
