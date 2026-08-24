import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * A falsy `timeout` does not mean the call has no deadline.
 *
 * `{ timeout: 0, signal: AbortSignal.timeout(5000) }` is a real pattern: switch off the client's
 * own timeout and let the signal govern instead. The signal was only ever read in the branch
 * taken when NO timeout key existed, so a falsy one shadowed it, the call resolved to null
 * (PROVEN ABSENT) and fired no-timeout at error severity on protected code.
 *
 * `timeout: 0` alone must still fire, because that genuinely is no deadline. The difference
 * between the two is the whole point.
 */
const audit = async (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-sig-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"s","dependencies":{"axios":"^1.7.0"}}')
  writeFileSync(join(dir, 'src', 'a.ts'), `import axios from 'axios'\n${body}\n`)
  const { sites, model } = await runAudit({ root: dir, json: true })
  return {
    timeoutMs: sites[0]?.options.timeoutMs,
    fired: model.findings.some((f) => f.rule === 'no-timeout'),
  }
}

describe('a signal alongside a falsy timeout', () => {
  const cases: [string, string][] = [
    ['timeout: 0 first', '{ timeout: 0, signal: AbortSignal.timeout(5000) }'],
    ['signal first', '{ signal: AbortSignal.timeout(5000), timeout: 0 }'],
    ['timeout: null', '{ timeout: null, signal: AbortSignal.timeout(5000) }'],
    ['timeout: undefined', '{ timeout: undefined, signal: AbortSignal.timeout(5000) }'],
  ]

  for (const [label, cfg] of cases) {
    it(`reads the signal with ${label}`, async () => {
      const r = await audit(`export const f = () => axios.get('https://v.dev/a', ${cfg})`)
      expect(r.timeoutMs).toBe(5000)
      expect(r.fired).toBe(false)
    })
  }

  it('reads a signal with no timeout key at all, the control that already worked', async () => {
    const r = await audit(
      "export const f = () => axios.get('https://v.dev/a', { signal: AbortSignal.timeout(5000) })",
    )
    expect(r.timeoutMs).toBe(5000)
  })

  // The other half. A falsy timeout with no signal, or a signal that proves nothing, must not
  // start passing: abstaining on everything would satisfy the cases above and gut the rule.
  it('still fires on timeout: 0 with no signal', async () => {
    const r = await audit("export const f = () => axios.get('https://v.dev/a', { timeout: 0 })")
    expect(r.timeoutMs).toBeNull()
    expect(r.fired).toBe(true)
  })

  it('abstains, rather than proving a deadline, on a bare controller signal', async () => {
    const r = await audit(
      [
        'const controller = new AbortController()',
        "export const f = () => axios.get('https://v.dev/a', { timeout: 0, signal: controller.signal })",
      ].join('\n'),
    )
    expect(r.timeoutMs).toBe('unknown')
    expect(r.fired).toBe(false)
  })
})
