import { describe, expect, it } from 'vitest'
import { runRules } from '../src/rules/index.js'
import { clientsFor, sitesFor, ws } from './helpers.js'

/**
 * client x import shape x call shape x polarity.
 *
 * `client-matrix.test.ts` asserts only `toHaveLength(1)`: presence, never method or options.
 * That is exactly why three defects shipped through it. Every row here asserts the resolved
 * method, the resolved timeout, and whether `no-timeout` fires, anchored to the specific call
 * site rather than to the fixture, because "some no-timeout exists" can be satisfied by the
 * wrong twin in a multi-call file.
 *
 * `timeoutMs` is asserted as `null` (PROVEN absent, fires) versus `'unknown'` (abstain, silent)
 * rather than only checking that a finding is missing. Silence alone proves nothing: every case
 * fixed here could equally be "fixed" by making the rule abstain, which would be a regression
 * wearing a fix's clothes.
 *
 * Fixture basenames are deliberately unique. `sitesFor` matches by `endsWith`, so a `get.ts`
 * and a `renamed-get.ts` would suffix-collide and silently inspect the wrong file.
 */
type Row = {
  file: string
  client: string
  method: string | undefined
  timeout: number | null | 'unknown' | 'instance-default'
}

const ROWS: Row[] = [
  // node:http. `request` and `get` are its only callable exports.
  { file: 'nh-esm-named-opts-timeout.ts', client: 'node:http', method: 'request', timeout: 5000 },
  { file: 'nh-esm-named-opts-absent.ts', client: 'node:http', method: 'request', timeout: null },
  {
    file: 'nh-cjs-destructured-opts-timeout.js',
    client: 'node:http',
    method: 'request',
    timeout: 5000,
  },
  {
    file: 'nh-cjs-destructured-opts-absent.js',
    client: 'node:http',
    method: 'request',
    timeout: null,
  },
  { file: 'nh-cjs-renamed-opts-timeout.js', client: 'node:http', method: 'request', timeout: 5000 },
  // The canonical shape. Skipping callbacks is what makes this `null` rather than 'unknown'.
  { file: 'nh-namespace-url-callback.js', client: 'node:http', method: 'get', timeout: null },
  { file: 'nh-namespace-url-opts-timeout.js', client: 'node:http', method: 'get', timeout: 5000 },
  // Scanning every candidate, not stopping at the unclassifiable `new URL(...)` at index 0.
  { file: 'nh-newurl-opts-timeout.js', client: 'node:http', method: 'request', timeout: 5000 },
  // Conservative and documented: `new URL(u)` is not classifiable, so absence is unprovable.
  { file: 'nh-newurl-callback.js', client: 'node:http', method: 'request', timeout: 'unknown' },

  // node:https aliases onto the node:http kind and had zero coverage before this grid.
  { file: 'nhs-namespace-url-callback.js', client: 'node:http', method: 'get', timeout: null },
  { file: 'nhs-namespace-opts-timeout.js', client: 'node:http', method: 'request', timeout: 5000 },
  { file: 'nhs-esm-named-opts-absent.ts', client: 'node:http', method: 'request', timeout: null },

  // request. `client-matrix` has no `request` fixture at all despite depending on it.
  { file: 'rq-esm-named-get-opts-timeout.ts', client: 'request', method: 'get', timeout: 5000 },
  { file: 'rq-esm-named-get-opts-absent.ts', client: 'request', method: 'get', timeout: null },
  { file: 'rq-cjs-destructured-post-absent.js', client: 'request', method: 'post', timeout: null },
  {
    file: 'rq-cjs-renamed-get-url-opts-timeout.js',
    client: 'request',
    method: 'get',
    timeout: 5000,
  },
  // Options-object-first via property access: the error-severity false positive.
  { file: 'rq-namespace-get-opts-timeout.js', client: 'request', method: 'get', timeout: 5000 },
  { file: 'rq-namespace-get-url-callback.js', client: 'request', method: 'get', timeout: null },

  // request-promise
  {
    file: 'rp-esm-named-get-opts-timeout.ts',
    client: 'request-promise',
    method: 'get',
    timeout: 5000,
  },
  // Url-then-options through a destructured verb: silently abstained before.
  {
    file: 'rp-cjs-destructured-get-url-opts-timeout.js',
    client: 'request-promise',
    method: 'get',
    timeout: 5000,
  },
  {
    file: 'rp-cjs-destructured-post-opts-absent.js',
    client: 'request-promise',
    method: 'post',
    timeout: null,
  },
  // `del` normalises to `delete`, agreeing with the property-access path.
  {
    file: 'rp-namespace-del-opts-timeout.js',
    client: 'request-promise',
    method: 'delete',
    timeout: 5000,
  },
  {
    file: 'rp-cjs-renamed-head-absent.js',
    client: 'request-promise',
    method: 'head',
    timeout: null,
  },
]

describe('method x call-shape matrix', () => {
  for (const row of ROWS) {
    it(`${row.client} ${row.method}: ${row.file}`, async () => {
      const sites = await sitesFor('method-matrix', row.file)
      expect(sites).toHaveLength(1)
      const site = sites[0]
      expect(site.client).toBe(row.client)
      expect(site.method).toBe(row.method)
      expect(site.options.timeoutMs).toBe(row.timeout)

      const mine = runRules(sites, ws).filter((f) => f.callSiteId === site.id)
      const fires = mine.some((f) => f.rule === 'no-timeout')
      expect(fires).toBe(row.timeout === null)
    })
  }
})

describe('method identity reaches the rules and the output', () => {
  // The regression in its most visible form: `undefined` is idempotent by design, so a POST
  // that forgot its verb was warned about for not retrying.
  it('does not warn about retry on a destructured POST', async () => {
    const sites = await sitesFor('method-matrix', 'rp-cjs-destructured-post-opts-absent.js')
    const found = runRules(sites, ws)
    expect(found.map((f) => f.rule)).toContain('no-timeout')
    expect(found.map((f) => f.rule)).not.toContain('no-retry')
  })

  it('still warns about retry on a destructured GET, which is idempotent', async () => {
    const sites = await sitesFor('method-matrix', 'rq-esm-named-get-opts-absent.ts')
    expect(runRules(sites, ws).map((f) => f.rule)).toContain('no-retry')
  })

  // Evidence is the only place the method reaches a user, and nothing asserted its content
  // before. It read `request-promise()` with the verb missing.
  it('names the verb in the evidence', async () => {
    const sites = await sitesFor('method-matrix', 'rp-cjs-destructured-post-opts-absent.js')
    const nt = runRules(sites, ws).find((f) => f.rule === 'no-timeout')
    expect(nt?.evidence).toContain('request-promise.post')
  })
})

/**
 * Asserted at the binding, not through a call site. After the shape probe landed, the three
 * ambiguous clients resolve their config without consulting the method, so every timeout
 * assertion above passes whether or not `boundMethod` is set. Without these, the verb fix is
 * unproven: two independent code paths satisfy the same evidence.
 */
describe('bindings remember the verb they were imported as', () => {
  const boundMethodOf = async (file: string, local: string) =>
    (await clientsFor('method-matrix', file)).get(local)?.boundMethod

  it('records a named import', async () =>
    expect(await boundMethodOf('rq-esm-named-get-opts-timeout.ts', 'get')).toBe('get'))

  it('records a destructured require', async () =>
    expect(await boundMethodOf('rq-cjs-destructured-post-absent.js', 'post')).toBe('post'))

  it('preserves the imported name through a rename', async () =>
    expect(await boundMethodOf('rq-cjs-renamed-get-url-opts-timeout.js', 'fetchVendor')).toBe(
      'get',
    ))

  it('leaves a namespace binding without a verb', async () =>
    expect(await boundMethodOf('rq-namespace-get-opts-timeout.js', 'request')).toBeUndefined())

  it('does not give a factory-derived instance a verb', async () => {
    const c = await clientsFor('client-factories', 'rp-defaults.js')
    expect(c.get('client')?.boundMethod).toBeUndefined()
  })
})
