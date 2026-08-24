import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * Total accounting, which is the structural answer to a whole class of defect rather than a fix
 * for two more instances of it.
 *
 * The reader used to skip any property it did not recognise, then treat the absence of `timeout`
 * as PROOF of absence. So every syntactic form nobody had thought of became an error-severity
 * false positive: a quoted key (#13), a computed key, a getter. Nine of this project's defects
 * live in that one layer, and each was fixed by teaching the reader one more shape, which cannot
 * terminate: JavaScript has more ways to write an object than anyone will enumerate.
 *
 * So the reader now classifies EVERY property, with no silent skip and no shrugging default. A
 * property kind it cannot name makes the object opaque, exactly as an unreadable spread already
 * did, and opaque means abstain. The remaining gaps are unbounded and always will be; what
 * changes is that they degrade to silence instead of failing somebody's build.
 *
 * These tests are the guard on that property. Each is a shape apiwatch cannot read, and each must
 * stay silent rather than claim proof.
 */
const audit = async (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-total-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"t","dependencies":{"axios":"^1.7.0"}}')
  writeFileSync(join(dir, 'src', 'a.ts'), `import axios from 'axios'\n${body}\n`)
  const { sites, model } = await runAudit({ root: dir, json: true })
  return {
    timeoutMs: sites[0]?.options.timeoutMs,
    firedNoTimeout: model.findings.some((f) => f.rule === 'no-timeout'),
  }
}

describe('a config object apiwatch cannot fully read', () => {
  // The invariant is "never claims proof of absence", not one particular verdict. Two honest
  // non-answers exist and the distinction is real: 'unknown' means the keys cannot even be named,
  // while 'instance-default' means the key IS present and only its value is out of reach. Both
  // keep no-timeout silent, because it fires only on null.
  const cannotRead: [string, string, 'unknown' | 'instance-default'][] = [
    [
      'a computed key from a const',
      "const K = 'timeout'\nexport const f = () => axios.get('https://v.dev/a', { [K]: 5000 })",
      'unknown',
    ],
    [
      'a computed key from a parameter',
      "export const f = (k: string) => axios.get('https://v.dev/a', { [k]: 5000 })",
      'unknown',
    ],
    [
      'a spread of an identifier',
      "declare const base: object\nexport const f = () => axios.get('https://v.dev/a', { ...base })",
      'unknown',
    ],
    [
      'a getter naming the key',
      "export const f = () => axios.get('https://v.dev/a', { get timeout() { return 5000 } })",
      'instance-default',
    ],
    [
      'a method naming the key',
      "export const f = () => axios.get('https://v.dev/a', { timeout() { return 5000 } })",
      'instance-default',
    ],
  ]

  for (const [label, body, verdict] of cannotRead) {
    it(`abstains on ${label} rather than claiming proof`, async () => {
      const r = await audit(body)
      expect(r.timeoutMs).toBe(verdict)
      expect(r.timeoutMs).not.toBeNull() // the property that actually matters
      expect(r.firedNoTimeout).toBe(false)
    })
  }

  // The other half, and the one that matters most. Abstaining on everything would satisfy every
  // assertion above while making the tool useless, so a genuinely readable object with no timeout
  // must still be PROVEN absent and still fire.
  const canRead: [string, string][] = [
    ['an empty object', "export const f = () => axios.get('https://v.dev/a', {})"],
    ['other plain keys', "export const f = () => axios.get('https://v.dev/a', { headers: {} })"],
    [
      'other quoted keys',
      'export const f = () => axios.get(\'https://v.dev/a\', { "headers": {} })',
    ],
    [
      'an unrelated method',
      "export const f = () => axios.get('https://v.dev/a', { toString() { return '' } })",
    ],
    [
      'a readable inline spread',
      "export const f = () => axios.get('https://v.dev/a', { ...{ headers: {} } })",
    ],
    ['no config argument at all', "export const f = () => axios.get('https://v.dev/a')"],
  ]

  for (const [label, body] of canRead) {
    it(`still proves absence with ${label}`, async () => {
      const r = await audit(body)
      expect(r.timeoutMs).toBeNull()
      expect(r.firedNoTimeout).toBe(true)
    })
  }
})
