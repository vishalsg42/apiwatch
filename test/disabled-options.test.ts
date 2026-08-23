import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

const opts = async (file: string) => (await sitesFor('disabled-options', file))[0].options

describe('explicitly disabled options are not protection', () => {
  // axios treats timeout: 0 as no timeout at all, the same as omitting it. Reading only that
  // the property EXISTS marked the instance protected and suppressed no-timeout on every call.
  it('treats axios.create({ timeout: 0 }) as having no timeout', async () =>
    expect((await opts('instance-timeout-zero.ts')).timeoutMs).toBeNull())

  it('still honours a real instance timeout', async () =>
    expect((await opts('instance-timeout-set.ts')).timeoutMs).toBe('instance-default'))

  // A value that cannot be read statically is not proof of absence, so it still counts.
  it('still honours an instance timeout whose value is not a literal', async () =>
    expect((await opts('instance-timeout-var.ts')).timeoutMs).toBe('instance-default'))

  // got retries twice by default, but the call can turn that off.
  it('reports no-retry when got retry is disabled via limit', async () =>
    expect((await opts('got-retry-off.ts')).retry).toBe('none'))

  it('reports no-retry when got retry is 0', async () =>
    expect((await opts('got-retry-zero.ts')).retry).toBe('none'))

  it('still trusts got default retry when nothing disables it', async () =>
    expect((await opts('got-default.ts')).retry).toBe('library'))
})
