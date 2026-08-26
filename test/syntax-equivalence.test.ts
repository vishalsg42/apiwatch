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

/** The resolved verb, plus the rules that fired, which is where a dropped verb shows up. */
const methodsFor = async (src: string) => {
  const { sites, model } = await runAudit({ root: write(src), json: true })
  return sites.map((s) => ({
    method: s.method,
    rules: model.findings
      .filter((f) => f.callSiteId === s.id)
      .map((f) => f.rule)
      .sort(),
  }))
}

/** Position-independent identity, which must not depend on how a route label is quoted. */
const fingerprintsFor = async (src: string) => {
  const { sites } = await runAudit({ root: write(src), json: true })
  return sites.map((s) => s.fingerprint)
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
  for (const [label, call, expected] of [
    [
      'axios timeout',
      (cfg: string) =>
        `import axios from 'axios'\nexport const f = () => axios.get('https://v.dev/a', ${cfg})`,
      // `AxiosRequestConfig.timeout` is real, so this one really is a 5s deadline.
      5000,
    ],
    [
      'fetch timeout',
      (cfg: string) => `export const f = () => fetch('https://v.dev/a', ${cfg})`,
      // `RequestInit` has no `timeout`. The standard fetch ignores the key, so the call has no
      // deadline at all and null (PROVEN ABSENT) is the right answer.
      //
      // This line read 5000 until the conformance check found otherwise, which makes it the
      // second instance of the trap named at the top of this file: the oracle of the test written
      // to catch defects nobody imagined had itself encoded one. An equivalence property needs no
      // oracle; only this one extra assertion did, and only this one extra assertion was wrong.
      null,
    ],
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
      expect(results[0].got[0]?.timeoutMs).toBe(expected)
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

  /**
   * The same property applied to a config VALUE rather than a config key.
   *
   * `method: `post`` is a NoSubstitutionTemplateLiteral, and only StringLiteral was read, so the
   * verb was dropped. That is not a quiet loss: a call with no method counts as idempotent by
   * design, so no-retry fired on the backtick POST and stayed silent on the quoted one. Two
   * spellings of one POST, two different verdicts, and the louder one was the wrong one.
   */
  it('method: a backtick verb is the same verb as a quoted one', async () => {
    const call = (v: string) =>
      `import axios from 'axios'\nexport const f = () => axios({ method: ${v}, url: 'https://v.dev/a' })`
    const results = await Promise.all(
      ["'post'", '"post"', '`post`'].map(async (v) => ({ v, got: await methodsFor(call(v)) })),
    )
    for (const r of results)
      expect(JSON.stringify(r.got), `${r.v} disagreed with ${results[0].v}`).toBe(
        JSON.stringify(results[0].got),
      )
    // and the shared answer is the right one: a POST, so no-retry must not fire
    expect(results[0].got[0]?.method).toBe('post')
    expect(results[0].got[0]?.rules).not.toContain('no-retry')
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

/**
 * Two more `require` readers, both parsing source TEXT with a regex that assumed quotes and no
 * whitespace. Fixing one of them last round and not its siblings is exactly the failure this
 * whole file exists to catch, so these are equivalence assertions rather than examples: whatever
 * a quoted require does, a backtick or spaced one must do too.
 */
describe('spellings of a CommonJS require are read identically', () => {
  const write = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'apiwatch-req-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"r","dependencies":{"axios":"^1.7.0","zod":"^3"}}',
    )
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, 'src', n), b)
    return dir
  }

  // collectImportedNames: a response handed to an imported helper must ABSTAIN, not be called
  // proven-unvalidated. The spelling of the require it came from cannot change that.
  it('a helper imported by backtick or spaced require still downgrades to unknown', async () => {
    const body = (spec: string) =>
      [
        "const axios = require('axios')",
        `const { handler } = require(${spec})`,
        "module.exports.f = async () => { const r = await axios.get('https://v.dev/a', { timeout: 100 }); return handler(r.data) }",
      ].join('\n')
    const { sites } = await runAudit({
      root: write({
        'quoted.js': body("'./helpers'"),
        'tick.js': body('`./helpers`'),
        'spaced.js': body('"./helpers" '),
        'helpers.js': 'module.exports.handler = (x) => x\n',
      }),
      json: true,
    })
    const by = (n: string) => sites.find((s) => s.file.endsWith(n))?.options.validated
    expect(by('quoted.js')).toBe('unknown') // control: this already worked
    expect(by('tick.js')).toBe(by('quoted.js'))
    expect(by('spaced.js')).toBe(by('quoted.js'))
  })

  // registry: a cross-module client consumed by backtick require must still resolve. This one was
  // never reported; it was found by sweeping for the same pattern after fixing its sibling.
  it('a cross-module client survives a backtick require in the consumer', async () => {
    const { sites } = await runAudit({
      root: write({
        'http.js': [
          "const axios = require('axios')",
          'module.exports.api = axios.create({ timeout: 5000 })',
        ].join('\n'),
        'quoted.js': [
          "const { api } = require('./http')",
          "module.exports.f = () => api.get('https://v.dev/a')",
        ].join('\n'),
        'tick.js': [
          'const { api } = require(`./http`)',
          "module.exports.g = () => api.get('https://v.dev/b')",
        ].join('\n'),
      }),
      json: true,
    })
    const seen = sites.map((s) => s.file.split('/').pop()).sort()
    expect(seen).toEqual(['quoted.js', 'tick.js'])
  })
})

/**
 * The property applied to identity rather than to analysis.
 *
 * A route handler's fingerprint includes the route it handles, because six byte-identical calls
 * in six anonymous handlers are otherwise indistinguishable. The label was read as StringLiteral
 * only, so `router.get(`/orders`, ...)` lost it, every backtick route in a file collapsed to a
 * bare `router.get`, and the fingerprint moved. Nothing about the request changed; a repo that
 * reformatted its routes to template literals would simply have found its committed baseline
 * stale, with old entries unmatched and the same findings reported as new.
 *
 * This is the one equivalence that a rule-level test could never catch: the finding is identical
 * either way. Only its identity differs.
 */
describe('a route label is the same label however it is quoted', () => {
  const route = (q: string) =>
    [
      'declare const router: any',
      `router.get(${q}/orders${q}, (_q: any, _s: any) => fetch('https://v.dev/a'))`,
    ].join('\n')

  it('quoting a route never moves the fingerprint', async () => {
    const [single, double, backtick] = await Promise.all(
      ["'", '"', '`'].map((q) => fingerprintsFor(route(q))),
    )
    expect(single).toHaveLength(1)
    expect(double).toEqual(single)
    expect(backtick).toEqual(single)
  })
})
