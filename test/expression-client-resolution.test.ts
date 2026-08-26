import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * Resolving a client that is reached through an expression. See #6.
 *
 * A call's client was found by matching the callee's SOURCE TEXT against a binding name, so
 * anything that was not a plain name matched nothing and the call was skipped in silence.
 * stripe-node needs two separate layers of this at once, which is why the issue's own diagnosis
 * was incomplete: it named the conditional, but the conditional's arms are themselves derived
 * locals, so resolving only the conditional would still have found nothing.
 *
 *   const http = ((http_ as unknown) as {default: typeof http_}).default || http_   <- layer 1
 *   (isInsecureConnection ? http : https).request({...})                            <- layer 2
 *
 * The rule throughout is that every branch which could be taken must resolve to the SAME client.
 * Where it cannot, the call goes on being skipped, because guessing which arm runs would invent a
 * call site rather than find one.
 */
const audit = async (src: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-expr-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(
    join(dir, 'package.json'),
    '{"name":"e","dependencies":{"axios":"^1.7.0","got":"^14.0.0"}}',
  )
  writeFileSync(join(dir, 'src', 'a.ts'), src)
  const { sites, model } = await runAudit({ root: dir, json: true })
  return {
    sites: sites.map((s) => ({
      client: s.client,
      method: s.method,
      timeoutMs: s.options.timeoutMs,
    })),
    rules: model.findings.map((f) => f.rule),
  }
}

describe('a client reached through an expression resolves when the branches agree', () => {
  it('resolves a parenthesized conditional whose arms are the same client', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        "import https from 'node:https'",
        'declare const insecure: boolean',
        "export const f = () => (insecure ? http : https).request({ host: 'v.dev', timeout: 5000 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 5000 }])
  })

  it('resolves through casts, a .default interop hop and a || fallback', async () => {
    const r = await audit(
      [
        "import * as http_ from 'node:http'",
        'const http = ((http_ as unknown) as { default: typeof http_ }).default || http_',
        "export const f = () => http.request({ host: 'v.dev', timeout: 1000 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 1000 }])
  })

  /** stripe-node's shape, both layers at once, which is the actual reproduction. */
  it('resolves stripe-node: a derived binding chosen by a conditional', async () => {
    const r = await audit(
      [
        "import * as http_ from 'node:http'",
        "import * as https_ from 'node:https'",
        'const http = ((http_ as unknown) as { default: typeof http_ }).default || http_',
        'const https = ((https_ as unknown) as { default: typeof https_ }).default || https_',
        'declare const insecure: boolean',
        "export const f = () => (insecure ? http : https).request({ host: 'v.dev' })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: null }])
  })

  it('resolves a ?? fallback and a non-null assertion when both sides are the client', async () => {
    const r = await audit(
      [
        "import axios from 'axios'",
        'const primary = axios',
        'const client = primary ?? axios',
        "export const f = () => client!.get('https://v.dev/a', { timeout: 2000 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'axios', method: 'get', timeoutMs: 2000 }])
  })

  /**
   * Shapes surfaced by an independent review of this change. All but the last already worked;
   * they are pinned here so that stays true, since each is a different node kind on the unwrap
   * path and a refactor could drop one without any other test noticing.
   */
  it('resolves nested conditionals', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        "import https from 'node:https'",
        'declare const c1: boolean',
        'declare const c2: boolean',
        "export const f = () => (c1 ? (c2 ? http : https) : http).request({ host: 'v.dev' })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: null }])
  })

  for (const [label, head] of [
    ['a cast to any', '(axios as any)'],
    ['a non-null assertion', '(axios!)'],
    ['redundant parentheses', '(((axios)))'],
  ] as const) {
    it(`resolves through ${label}`, async () => {
      const r = await audit(
        [
          "import axios from 'axios'",
          `export const f = () => ${head}.get('https://v.dev/a', { timeout: 1000 })`,
        ].join('\n'),
      )
      expect(r.sites).toEqual([{ client: 'axios', method: 'get', timeoutMs: 1000 }])
    })
  }

  it('resolves a variable initialised from a conditional', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        "import https from 'node:https'",
        'declare const secure: boolean',
        'const client = secure ? https : http',
        "export const f = () => client.request({ host: 'v.dev', timeout: 3000 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 3000 }])
  })

  /**
   * An inline require in each arm, which is how a CommonJS file can pick a client without ever
   * naming it. The review reported this as already working; it was not, and abstained. It is the
   * one row of that matrix that did not reproduce, so it is a fix rather than a pin.
   */
  it('resolves an inline require in each arm', async () => {
    const r = await audit(
      [
        'declare const secure: boolean',
        'export const f = () =>',
        "  (secure ? require('node:https') : require('node:http')).request({ host: 'v.dev', timeout: 6000 })",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 6000 }])
  })
})

/**
 * Reconciling instance-level protection across two branches.
 *
 * The flags are OR-ed, not AND-ed. If either arm carries a timeout the call may well be
 * protected, and reporting no-timeout on it would be an error-severity false positive against
 * correct code, which this project ranks above the silent suppression the other choice causes.
 *
 * The second case is what stops that from being a blanket excuse: when NEITHER arm has a timeout
 * there is nothing to reconcile and the finding still fires.
 */
describe('instance protection across two branches', () => {
  const twoInstances = (first: string, second: string) =>
    [
      "import axios from 'axios'",
      `const a1 = axios.create(${first})`,
      `const a2 = axios.create(${second})`,
      'declare const prod: boolean',
      "export const f = () => (prod ? a1 : a2).get('https://v.dev/a')",
    ].join('\n')

  it('abstains when only one arm sets a timeout', async () => {
    const r = await audit(twoInstances('{ timeout: 5000 }', "{ baseURL: 'https://v.dev' }"))
    expect(r.sites).toEqual([{ client: 'axios', method: 'get', timeoutMs: 'instance-default' }])
    expect(r.rules).not.toContain('no-timeout')
  })

  it('still reports when neither arm sets one', async () => {
    const r = await audit(
      twoInstances("{ baseURL: 'https://v.dev' }", "{ baseURL: 'https://w.dev' }"),
    )
    expect(r.sites).toEqual([{ client: 'axios', method: 'get', timeoutMs: null }])
    expect(r.rules).toContain('no-timeout')
  })
})

describe('the negative matrix: expressions that must still resolve to nothing', () => {
  const nothing = async (label: string, src: string) => {
    const r = await audit(src)
    expect(r.sites, label).toEqual([])
  }

  /** Which client a map returns is a runtime fact. No syntactic rule can decide it. */
  it('an element access binds nothing', () =>
    nothing(
      'element access',
      [
        "import axios from 'axios'",
        'const clients: Record<string, typeof axios> = { primary: axios }',
        'declare const name: string',
        "export const f = () => clients[name].get('https://v.dev/a')",
      ].join('\n'),
    ))

  it('an awaited factory call binds nothing', () =>
    nothing(
      'await',
      [
        "import axios from 'axios'",
        'declare const getClient: () => Promise<typeof axios>',
        "export const f = async () => (await getClient()).get('https://v.dev/a')",
      ].join('\n'),
    ))

  /**
   * The rule that keeps this honest. Two DIFFERENT clients cannot be reconciled, and picking
   * either would attribute the call to a library it may not use, taking that library's option
   * model with it.
   */
  it('a conditional between two different clients binds nothing', () =>
    nothing(
      'mixed kinds',
      [
        "import axios from 'axios'",
        "import got from 'got'",
        'declare const useGot: boolean',
        "export const f = () => (useGot ? got : axios).get('https://v.dev/a')",
      ].join('\n'),
    ))

  it('a conditional with one unknown arm binds nothing', () =>
    nothing(
      'one unknown arm',
      [
        "import axios from 'axios'",
        'declare const other: { get: (u: string) => Promise<unknown> }',
        'declare const flag: boolean',
        "export const f = () => (flag ? axios : other).get('https://v.dev/a')",
      ].join('\n'),
    ))

  /**
   * A fallback with one unknown side. `maybe` could be anything at runtime, and binding the whole
   * expression to axios would attribute the call to a library it may not use, taking axios's
   * option model with it. Same rule as the conditional: every branch must resolve, and agree.
   */
  it('a ?? fallback with an unknown left side binds nothing', () =>
    nothing(
      'unknown fallback',
      [
        "import axios from 'axios'",
        'declare const maybe: typeof axios | undefined',
        'const client = maybe ?? axios',
        "export const f = () => client.get('https://v.dev/a')",
      ].join('\n'),
    ))

  /**
   * Only `require` is followed as a call. Any other call's return value is a runtime fact, and
   * accepting it would undo the whole abstention rule one helper at a time.
   */
  it('a non-require call in an arm binds nothing', () =>
    nothing(
      'non-require call',
      [
        'declare const secure: boolean',
        'declare const makeClient: (s: string) => { get: (u: string) => Promise<unknown> }',
        "export const f = () => (secure ? makeClient('a') : makeClient('b')).get('https://v.dev/a')",
      ].join('\n'),
    ))

  it('an inline require of a module that is not a client binds nothing', () =>
    nothing(
      'non-client require',
      [
        'declare const secure: boolean',
        "export const f = () => (secure ? require('lodash') : require('lodash')).get('https://v.dev/a')",
      ].join('\n'),
    ))

  /** A property that is not `default` is a different value and must not inherit the client. */
  it('an arbitrary property of a client binds nothing', () =>
    nothing(
      'arbitrary property',
      [
        "import axios from 'axios'",
        'const inner = axios.defaults',
        "export const f = () => inner.get('https://v.dev/a')",
      ].join('\n'),
    ))

  it('an expression over non-clients binds nothing', () =>
    nothing(
      'non-clients',
      [
        'declare const a: { get: (u: string) => Promise<unknown> }',
        'declare const b: { get: (u: string) => Promise<unknown> }',
        'declare const flag: boolean',
        "export const f = () => (flag ? a : b).get('https://v.dev/a')",
      ].join('\n'),
    ))
})

/**
 * `http.request(opts)` returns a ClientRequest, and `req.setTimeout(ms)` is the idiomatic way to
 * give it a deadline. Reading only the options object reported no-timeout at error severity on a
 * correctly protected call.
 *
 * The gap predates this work but was largely invisible, because the calls that exhibit it were
 * themselves being skipped. Resolving them surfaced it on the first repository tried: stripe-node
 * sets `req.setTimeout(timeout, ...)` one statement after the call this change made visible.
 */
describe('a deadline set on the returned ClientRequest counts', () => {
  it('reads setTimeout on the assigned request', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        'export const f = () => {',
        "  const req = http.request({ host: 'v.dev' })",
        '  req.setTimeout(5000, () => req.destroy())',
        '  return req',
        '}',
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 5000 }])
    expect(r.rules).not.toContain('no-timeout')
  })

  it('reads a chained setTimeout', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        "export const f = () => http.request({ host: 'v.dev' }).setTimeout(3000)",
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: 3000 }])
  })

  it('treats a non-literal timeout as configured but unread', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        'export const f = (ms: number) => {',
        "  const req = http.request({ host: 'v.dev' })",
        '  req.setTimeout(ms)',
        '  return req',
        '}',
      ].join('\n'),
    )
    expect(r.sites).toEqual([
      { client: 'node:http', method: 'request', timeoutMs: 'instance-default' },
    ])
  })

  it('still reports a request with no deadline anywhere', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        'export const f = () => {',
        "  const req = http.request({ host: 'v.dev' })",
        '  return req',
        '}',
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: null }])
    expect(r.rules).toContain('no-timeout')
  })

  /** A `setTimeout` on an unrelated object in another function must not vouch for this call. */
  it('does not accept a setTimeout from a different scope', async () => {
    const r = await audit(
      [
        "import http from 'node:http'",
        'declare const other: { setTimeout: (n: number) => void }',
        'export const g = () => { other.setTimeout(9000) }',
        'export const f = () => {',
        "  const req = http.request({ host: 'v.dev' })",
        '  return req',
        '}',
      ].join('\n'),
    )
    expect(r.sites).toEqual([{ client: 'node:http', method: 'request', timeoutMs: null }])
  })
})
