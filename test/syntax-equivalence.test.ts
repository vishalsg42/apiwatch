import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * Equivalence testing, not example testing.
 *
 * Every example test asks "does this ONE shape work". That only ever covers shapes somebody
 * thought of, and two real defects slipped through exactly there:
 *
 *  - a quoted key (`{ "timeout": 5000 }`) was invisible, so a protected call reported no-timeout
 *    at error severity. No test used a quoted key. Nobody imagined one. (#13)
 *  - `{ retry }` on axios was read as proof of retry, though axios has no such option. A test DID
 *    cover that shape, and asserted the wrong answer, so the suite defended the bug. (#5)
 *
 * The second is the interesting one: adding more examples cannot help when the example encodes
 * the defect. So this asserts a PROPERTY instead. Writings of the same config that JavaScript
 * treats identically must produce identical analysis, whatever the analyser happens to do with
 * any one of them. It needs no oracle for the right answer, only that the answers agree, which is
 * why it can catch a defect nobody predicted.
 */
const write = (src: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-eq-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(
    join(dir, 'package.json'),
    '{"name":"eq","dependencies":{"axios":"^1.7.0","got":"^14.0.0"}}',
  )
  writeFileSync(join(dir, 'src', 'a.ts'), src)
  return dir
}

const optionsFor = async (src: string) => {
  const { sites } = await runAudit({ root: write(src), json: true })
  return sites.map((s) => ({ timeoutMs: s.options.timeoutMs, retry: s.options.retry }))
}

/** The same object, written every way JavaScript allows. */
const spellings = (key: string, value: string) => [
  `{ ${key}: ${value} }`,
  `{ "${key}": ${value} }`,
  `{ '${key}': ${value} }`,
  `{ ${key}: ${value}, }`, // trailing comma
  `{\n  ${key}: ${value},\n}`, // multiline
]

describe('spellings of one config object are analysed identically', () => {
  for (const [label, call] of [
    [
      'axios timeout',
      (cfg: string) =>
        `import axios from 'axios'\nexport const f = () => axios.get('https://v.dev/a', ${cfg})`,
    ],
    ['fetch timeout', (cfg: string) => `export const f = () => fetch('https://v.dev/a', ${cfg})`],
  ] as const) {
    it(`${label}: quoting and formatting never change the verdict`, async () => {
      const results = await Promise.all(
        spellings('timeout', '5000').map(async (cfg) => ({
          cfg,
          got: await optionsFor(call(cfg)),
        })),
      )
      const first = JSON.stringify(results[0].got)
      for (const r of results)
        expect(JSON.stringify(r.got), `${r.cfg} disagreed with ${results[0].cfg}`).toBe(first)
      // and the shared answer must be the RIGHT one, or agreeing on nonsense would pass
      expect(results[0].got[0]?.timeoutMs).toBe(5000)
    })
  }

  it('got retry: quoting never changes the verdict', async () => {
    const call = (cfg: string) =>
      `import got from 'got'\nexport const f = () => got('https://v.dev/a', ${cfg})`
    const results = await Promise.all(
      spellings('retry', '{ limit: 3 }').map((cfg) => optionsFor(call(cfg))),
    )
    for (const r of results) expect(JSON.stringify(r)).toBe(JSON.stringify(results[0]))
    expect(results[0][0]?.retry).toBe('library')
  })

  // The inverse property: two objects JavaScript treats DIFFERENTLY must not be conflated.
  // Without this, an analyser that ignored every key would pass everything above.
  it('a different key is not the same key', async () => {
    const call = (cfg: string) =>
      `import axios from 'axios'\nexport const f = () => axios.get('https://v.dev/a', ${cfg})`
    const withTimeout = await optionsFor(call('{ "timeout": 5000 }'))
    const withOther = await optionsFor(call('{ "timeoutish": 5000 }'))
    expect(withTimeout[0]?.timeoutMs).toBe(5000)
    expect(withOther[0]?.timeoutMs).toBeNull()
  })
})

/**
 * The same property, applied to module specifiers and CLI arguments. Both were violated the same
 * way: one spelling analysed, an equivalent spelling not.
 */
describe('spellings of one module specifier are treated identically', () => {
  const cjs = (q: string) =>
    [
      `const axios = require(${q}axios${q})`,
      `const { z } = require(${q}zod${q})`,
      'const S = z.object({})',
      "module.exports.f = async () => { const r = await axios.get('https://v.dev/a', { timeout: 100 }); return S.parse(r.data) }",
    ].join('\n')

  it('a backtick require is the same import as a quoted one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiwatch-eq-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"eq","dependencies":{"axios":"^1.7.0","zod":"^3"}}',
    )
    writeFileSync(join(dir, 'src', 'tick.js'), cjs('`'))
    writeFileSync(join(dir, 'src', 'quote.js'), cjs("'"))
    const { sites } = await runAudit({ root: dir, json: true })
    const by = (n: string) => sites.find((s) => s.file.endsWith(n))?.options.validated
    expect(by('quote.js')).toBe(true) // control: this already worked
    expect(by('tick.js')).toBe(by('quote.js'))
  })
})
