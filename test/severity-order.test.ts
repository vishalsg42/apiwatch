import { describe, expect, it } from 'vitest'
import { runRules } from '../src/rules/index.js'
import { site, ws } from './helpers.js'

// The comparator was written for two severities. With 'info' added in 0.1.4 it returns 1 for
// BOTH compare(warn, info) and compare(info, warn), so it is not antisymmetric and the
// file/line tiebreak is never reached across those two. The effect is live, not latent:
// findings are emitted in `rules` array order, and unvalidatedResponse (info) is registered
// before deprecatedClient (warn), so a real report prints info above warn.
describe('finding order', () => {
  const RANK = { error: 0, warn: 1, info: 2 } as const

  it('groups error, then warn, then info, with no interleaving', () => {
    const findings = runRules(
      [
        site({
          client: 'request',
          fileImports: ['request'],
          options: { timeoutMs: null, retry: 'none', validated: false },
        }),
      ],
      ws,
    )
    // Guard the fixture itself: if these four rules stop firing together this test proves
    // nothing, so assert the shape before asserting the order.
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'deprecated-client',
      'no-retry',
      'no-timeout',
      'unvalidated-response',
    ])

    const ranks = findings.map((f) => RANK[f.severity])
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  })

  it('orders by file then line within one severity', () => {
    const o = { timeoutMs: null, retry: 'library' as const, validated: true as const }
    const findings = runRules(
      [
        site({ id: 'a', file: 'src/b.ts', line: 9, options: o }),
        site({ id: 'b', file: 'src/a.ts', line: 1, options: o }),
        site({ id: 'c', file: 'src/a.ts', line: 5, options: o }),
      ],
      ws,
    ).filter((f) => f.rule === 'no-timeout')
    expect(findings.map((f) => `${f.file}:${f.line}`)).toEqual([
      'src/a.ts:1',
      'src/a.ts:5',
      'src/b.ts:9',
    ])
  })
})
