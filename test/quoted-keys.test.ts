import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * A quoted config key is still that key. `{ "timeout": 5000 }` and `{ timeout: 5000 }` are the
 * same object, and JavaScript makes quoting mandatory for any key that is not a valid identifier.
 *
 * `prop()` used ts-morph's `getProperty(name)`, which matches the property's RAW name text, so a
 * quoted key was invisible and its value read as proven absent. `no-timeout` is the only rule at
 * `error`, so this failed builds on correctly-protected code: the worst class of defect this tool
 * can have. See issue #13.
 */
const timeoutOf = async (file: string) => (await sitesFor('quoted-keys', file))[0].options.timeoutMs

describe('a quoted config key', () => {
  it('is read when double quoted', async () => expect(await timeoutOf('double.ts')).toBe(5000))
  it('is read when single quoted', async () => expect(await timeoutOf('single.ts')).toBe(5000))
  it('is read when unquoted, the control', async () =>
    expect(await timeoutOf('plain.ts')).toBe(5000))
  it('works for signal too, not just timeout', async () =>
    expect(await timeoutOf('quoted-signal.ts')).toBe(5000))

  // The other direction: quoting must not make an ABSENT key look present. A readable object
  // whose keys are all quoted and none of them a timeout is still proven absent, and must fire.
  it('still proves absence when the quoted keys are other ones', async () =>
    expect(await timeoutOf('absent.ts')).toBeNull())
})
