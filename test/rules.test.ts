import { describe, expect, it } from 'vitest'
import { runRules } from '../src/rules/index.js'
import { site, ws } from './helpers.js'

const only = (r: string, sites = [site()], w = ws) => runRules(sites, w).filter((f) => f.rule === r)

describe('rules', () => {
  it('no-timeout fires on a null timeout at error severity', () => {
    expect(only('no-timeout')).toHaveLength(1)
    expect(only('no-timeout')[0].severity).toBe('error')
  })
  it('no-timeout is silent for an inherited instance timeout', () =>
    expect(
      only('no-timeout', [
        site({ options: { timeoutMs: 'instance-default', retry: 'none', validated: 'unknown' } }),
      ]),
    ).toHaveLength(0))
  it('no-retry is a warning, not an error', () => expect(only('no-retry')[0].severity).toBe('warn'))
  it('no-retry is silent for got', () =>
    expect(
      only('no-retry', [
        site({ client: 'got', options: { timeoutMs: 1, retry: 'library', validated: true } }),
      ]),
    ).toHaveLength(0))
  it('no-retry is silent for a non-idempotent method', () =>
    expect(only('no-retry', [site({ method: 'post' })])).toHaveLength(0))
  it('unvalidated-response fires only on a proven false', () => {
    const o = { timeoutMs: 1, retry: 'library' as const }
    expect(
      only('unvalidated-response', [site({ options: { ...o, validated: false } })]),
    ).toHaveLength(1)
    expect(
      only('unvalidated-response', [site({ options: { ...o, validated: 'unknown' } })]),
    ).toHaveLength(0)
  })
  it('deprecated-client fires once per file, not per call', () => {
    const a = site({ client: 'request', id: 'a', fileImports: ['request'] })
    const b = site({ client: 'request', id: 'b', line: 20, fileImports: ['request'] })
    expect(only('deprecated-client', [a, b])).toHaveLength(1)
  })
  it('deprecated-client fires for node-fetch v2 but not v3', () => {
    const s = [site({ client: 'node-fetch', fileImports: ['node-fetch'] })]
    expect(
      only('deprecated-client', s, { ...ws, dependencies: { 'node-fetch': '^2.6.7' } }),
    ).toHaveLength(1)
    expect(
      only('deprecated-client', s, { ...ws, dependencies: { 'node-fetch': '^3.3.0' } }),
    ).toHaveLength(0)
  })
  it('hardcoded-host fires on an ip but not loopback', () => {
    const bad = site({
      url: { kind: 'literal', url: 'https://203.0.113.42/x', host: '203.0.113.42' },
    })
    const ok = site({
      id: 'b',
      url: { kind: 'literal', url: 'http://localhost:3000/x', host: 'localhost' },
    })
    expect(only('hardcoded-host', [bad, ok])).toHaveLength(1)
  })
  it('every finding carries a message and evidence', () =>
    expect(runRules([site()], ws).every((f) => f.message && f.evidence)).toBe(true))
})
