import { describe, expect, it } from 'vitest'
import { siteAt } from './helpers.js'

describe('resolveOptions', () => {
  it('reads an inline timeout', async () =>
    expect((await siteAt('axios-variants', 'svc.ts', /axios\.post/)).options.timeoutMs).toBe(3000))
  it('inherits from a derived instance', async () =>
    expect((await siteAt('axios-instance', 'svc.ts', /api\.get/)).options.timeoutMs).toBe(
      'instance-default',
    ))
  it('inherits from a cross-module instance', async () =>
    expect((await siteAt('shared-client', 'payments.ts', /api\.post/)).options.timeoutMs).toBe(
      'instance-default',
    ))
  it('is null when no timeout is reachable', async () =>
    expect((await siteAt('native-fetch', 'svc.ts', /fetch\(/)).options.timeoutMs).toBeNull())
  it('treats AbortSignal.timeout as a timeout', async () =>
    expect((await siteAt('abort-signal', 'svc.ts', /fetch\(/)).options.timeoutMs).toBe(2000))
  it('treats a controller signal as a timeout', async () =>
    expect((await siteAt('abort-controller', 'svc.ts', /fetch\(/)).options.timeoutMs).toBe(
      'instance-default',
    ))
  it('binds axios-retry to the instance it configures', async () =>
    expect((await siteAt('retry-wrapped', 'svc.ts', /api\.get/)).options.retry).toBe('library'))
  it('treats got as retrying by default', async () =>
    expect((await siteAt('got-default', 'svc.ts', /got\(/)).options.retry).toBe('library'))
  it('treats a shorthand timeout as configured but unknown', async () =>
    expect((await siteAt('call-shorthand-timeout', 'svc.ts', /axios\.get/)).options.timeoutMs).toBe(
      'instance-default',
    ))
  it('treats a shorthand retry as library-handled', async () =>
    expect((await siteAt('call-shorthand-retry', 'svc.ts', /axios\.get/)).options.retry).toBe(
      'library',
    ))
  it('detects a CommonJS require of a retry library', async () =>
    expect((await siteAt('cjs-retry', 'svc.js', /axios\.get/)).options.retry).toBe('library'))
  it('treats timeout: 0 as no timeout', async () =>
    expect(
      (await siteAt('axios-zero-timeout', 'svc.ts', /axios\.get/)).options.timeoutMs,
    ).toBeNull())
})
