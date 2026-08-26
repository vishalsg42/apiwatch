import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * `const { get } = require('axios')` used to bind nothing, so the call was invisible: no call
 * site, no finding, no diagnostic. See #7.
 *
 * The fix is a widening of the export allowlist, which is the change that caused the 0.3.3
 * regression: `createServer` was added to node:http and server construction started reporting as
 * outbound traffic. So the allowlist is not widened blindly here, and this file is the negative
 * matrix that says so. Every name that must NOT bind is asserted alongside every name that must,
 * because a rule that binds everything would satisfy the positive half on its own.
 *
 * The widening is also narrower than it looks. axios's declaration exports the client as
 * `export default` and names no verb among its named exports, so `const { get } = require(...)`
 * destructures the module object and gets a working client while `import { get } from 'axios'`
 * imports something that does not exist. Only the CJS path is widened; the ESM path is asserted
 * to stay closed. test/export-conformance.test.ts checks that asymmetry against axios's own
 * declarations rather than trusting this comment.
 */
const audit = async (src: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-cjs-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(
    join(dir, 'package.json'),
    '{"name":"c","dependencies":{"axios":"^1.7.0","request-promise":"^4.2.6","lodash":"^4"}}',
  )
  writeFileSync(join(dir, 'src', 'a.ts'), src)
  const { sites, model } = await runAudit({ root: dir, json: true })
  return {
    sites: sites.map((s) => ({ client: s.client, method: s.method })),
    rules: model.findings.map((f) => f.rule),
  }
}

/** Verb plus resolved timeout, which is what the config-index tests turn on. */
const auditSites = async (src: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-cjs-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"c","dependencies":{"axios":"^1.7.0"}}')
  writeFileSync(join(dir, 'src', 'a.ts'), src)
  const { sites } = await runAudit({ root: dir, json: true })
  return sites.map((s) => ({ method: s.method, timeoutMs: s.options.timeoutMs }))
}

describe('a verb destructured from a CJS client module binds that verb', () => {
  it('binds the verb and records it, so a POST is not treated as idempotent', async () => {
    const r = await audit(
      [
        "const { get } = require('axios')",
        "const { post } = require('axios')",
        "export const g = () => get('https://v.dev/a')",
        "export const p = () => post('https://v.dev/b', { x: 1 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([
      { client: 'axios', method: 'get' },
      { client: 'axios', method: 'post' },
    ])
    // The verb is the point. Without it the method is undefined, which counts as idempotent by
    // design, and no-retry would fire on the POST.
    expect(r.rules.filter((x) => x === 'no-retry')).toHaveLength(1)
  })

  it('binds through an alias and a quoted key', async () => {
    const r = await audit(
      [
        "const { get: fetchIt } = require('axios')",
        "const { 'post': send } = require('axios')",
        "export const a = () => fetchIt('https://v.dev/a')",
        "export const b = () => send('https://v.dev/b', { x: 1 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([
      { client: 'axios', method: 'get' },
      { client: 'axios', method: 'post' },
    ])
  })

  it('binds a verb pulled off an existing binding, not just off the require', async () => {
    const r = await audit(
      [
        "const rp = require('request-promise')",
        'const { get } = rp',
        "export const g = () => get('https://v.dev/a')",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'request-promise', method: 'get' }])
  })

  it("carries an instance's timeout onto a verb destructured from it", async () => {
    const r = await audit(
      [
        "const axios = require('axios')",
        'const api = axios.create({ timeout: 5000 })',
        'const { get } = api',
        "export const g = () => get('https://v.dev/a')",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'axios', method: 'get' }])
    // the instance sets a deadline, so the destructured verb must not report one missing
    expect(r.rules).not.toContain('no-timeout')
  })
})

/**
 * A destructured verb must also name itself to the config reader, because axios decides WHICH
 * argument is the config from the method: `get(url, config)` puts it at 1, `post(url, data,
 * config)` at 2.
 *
 * Binding the verbs without threading the verb into that decision made `post`, `put` and `patch`
 * fall through to the shape probe, which expects the two-argument form and picked argument 1: the
 * request BODY. `post(url, data, { timeout: 2000 })` then resolved to a PROVEN-ABSENT timeout and
 * reported no-timeout at error severity on a call that plainly sets one. That is the worst
 * failure this project has, and it was introduced by the commit that added the verbs.
 */
describe('a destructured verb resolves its config from the right argument', () => {
  const cases = [
    { verb: 'get', call: "get('https://v.dev/a', { timeout: 1000 })", ms: 1000 },
    { verb: 'head', call: "head('https://v.dev/c', { timeout: 6000 })", ms: 6000 },
    { verb: 'post', call: "post('https://v.dev/d', { x: 1 }, { timeout: 2000 })", ms: 2000 },
    { verb: 'put', call: "put('https://v.dev/e', { x: 1 }, { timeout: 3000 })", ms: 3000 },
    { verb: 'patch', call: "patch('https://v.dev/f', { x: 1 }, { timeout: 4000 })", ms: 4000 },
  ] as const

  for (const c of cases) {
    it(`${c.verb} reads its timeout, not the request body`, async () => {
      const r = await auditSites(
        [`const { ${c.verb} } = require('axios')`, `export const f = () => ${c.call}`].join('\n'),
      )
      expect(r).toEqual([{ method: c.verb, timeoutMs: c.ms }])
    })
  }

  it('the same holds for a verb pulled off a create() instance', async () => {
    const r = await auditSites(
      [
        "const axios = require('axios')",
        "const api = axios.create({ baseURL: 'https://v.dev' })",
        'const { post } = api',
        "export const f = () => post('/d', { x: 1 }, { timeout: 7000 })",
      ].join('\n'),
    )
    expect(r).toEqual([{ method: 'post', timeoutMs: 7000 }])
  })

  /**
   * axios has `delete`, not `del`. `del` is the request family's spelling, so binding it for axios
   * would invent a client that does not exist.
   */
  it('axios has no `del`, so destructuring one binds nothing', async () => {
    const r = await auditSites(
      ["const { del } = require('axios')", "export const f = () => del('https://v.dev/b')"].join(
        '\n',
      ),
    )
    expect(r).toEqual([])
  })
})

describe('the negative matrix: what must still bind nothing', () => {
  const nothing = async (label: string, src: string) => {
    const r = await audit(src)
    expect(r.sites, label).toEqual([])
  }

  // The 0.3.3 regression, in the exact shape that caused it. node:http exports servers AND
  // clients from one module, which is why its allowlist can never be widened to "any property".
  it('http.createServer is not an outbound client', () =>
    nothing(
      'createServer',
      [
        "const { createServer } = require('http')",
        'export const s = () => createServer(() => {})',
      ].join('\n'),
    ))

  it('http.Server is not an outbound client', () =>
    nothing(
      'Server',
      ["const { Server } = require('http')", 'export const s = () => new Server()'].join('\n'),
    ))

  // Real axios exports that are not verbs. These are the names the widening must not catch.
  for (const name of ['isAxiosError', 'all', 'spread', 'toFormData', 'AxiosHeaders'])
    it(`axios.${name} is not a request`, () =>
      nothing(
        name,
        [`const { ${name} } = require('axios')`, `export const x = () => ${name}('a')`].join('\n'),
      ))

  // The ESM half of the asymmetry. axios declares no named `get`, so this imports undefined and
  // binding it would report findings against a call that cannot run.
  it('a named ESM import of a verb does not bind, because axios does not export one', () =>
    nothing(
      'esm named verb',
      ["import { get } from 'axios'", "export const g = () => get('https://v.dev/a')"].join('\n'),
    ))

  // A verb name is only meaningful once the module is known to be a client.
  for (const mod of ['lodash', 'express', './local-helpers'])
    it(`a verb destructured from ${mod} binds nothing`, () =>
      nothing(
        mod,
        [`const { get } = require('${mod}')`, "export const g = () => get('https://v.dev/a')"].join(
          '\n',
        ),
      ))

  it('a verb destructured from an unrelated object binds nothing', () =>
    nothing(
      'unrelated object',
      [
        'const helpers = { get: (_u: string) => undefined }',
        'const { get } = helpers',
        "export const g = () => get('https://v.dev/a')",
      ].join('\n'),
    ))
})
