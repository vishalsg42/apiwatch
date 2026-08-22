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
  // Was "detects a CommonJS require of a retry library", pinning a file-wide heuristic that
  // marked EVERY call in a file as retried the moment the file imported a retry library
  // ANYWHERE, whether or not that library was ever applied to this call or its client instance.
  // Reproduced against a real shape: `import pRetry from 'p-retry'` with one call actually
  // wrapped in `pRetry(...)` and one bare call; neither got flagged, a file-wide false
  // suppression of the same kind already killed for pagination loops. This fixture's axios
  // client is never wrapped by the imported axios-retry: a merely-imported-but-unapplied retry
  // library must not suppress no-retry.
  it('does not treat a merely-imported (never applied) retry library as retry: library', async () =>
    expect((await siteAt('cjs-retry', 'svc.js', /axios\.get/)).options.retry).toBe('none'))
  // Same regression, closer to the reported repro: importing p-retry and wrapping only ONE of
  // two calls in it used to mark BOTH as 'library' (file-wide false suppression). Dropping the
  // heuristic entirely means the wrapped call now also reads 'none': a false no-retry warning
  // on a genuinely-protected call is the accepted, safer failure mode here (same precedent as
  // the pagination-loop fix above), not a reason to bring the heuristic back.
  it('does not infer retry: library for either call from a merely-imported p-retry', async () => {
    expect((await siteAt('p-retry-file-import', 'svc.ts', /wrapped/)).options.retry).toBe('none')
    expect((await siteAt('p-retry-file-import', 'svc.ts', /bare/)).options.retry).toBe('none')
  })
  it('treats timeout: 0 as no timeout', async () =>
    expect(
      (await siteAt('axios-zero-timeout', 'svc.ts', /axios\.get/)).options.timeoutMs,
    ).toBeNull())
  // Regression: a `while (hasMore) { try { ... } catch {} }` pagination loop is structurally
  // identical to a hand-rolled retry loop. It was previously misclassified as retry: 'manual',
  // silently suppressing no-retry on genuinely unprotected call sites (see the coordinator's
  // fix-round-2 message: 23.7% of a real repo's call sites were pagination, not retry). A
  // for/while ancestor must never promote retry above 'none' on its own.
  it('does not treat a pagination loop as manual retry', async () =>
    expect((await siteAt('pagination-loop', 'svc.ts', /axios\.get/)).options.retry).toBe('none'))
  // Regression: options used to be read by scanning EVERY object-literal argument, so a
  // domain field in the request BODY collided with a real option name. The config argument
  // must be selected by POSITION (client kind + method), never "the last object literal",
  // which is exactly wrong for a bodyless `axios.post(url, data)`.
  it('does not mistake a retry-shaped body field for retry config', async () =>
    expect((await siteAt('body-collision-retry', 'svc.ts', /axios\.post/)).options.retry).toBe(
      'none',
    ))
  it('does not mistake a timeout-shaped body field for a configured timeout', async () =>
    expect(
      (await siteAt('body-collision-timeout', 'svc.ts', /axios\.post/)).options.timeoutMs,
    ).toBeNull())
  it('reads the real config argument, not the body, when both set timeout', async () =>
    expect(
      (await siteAt('body-and-config-timeout', 'svc.ts', /axios\.post/)).options.timeoutMs,
    ).toBe(3000))
  it('still reads an inline timeout on axios.get (config at index 1)', async () =>
    expect((await siteAt('axios-get-timeout', 'svc.ts', /axios\.get/)).options.timeoutMs).toBe(
      3000,
    ))
  it('reads a timeout from a bare axios(config) call (config at index 0)', async () =>
    expect((await siteAt('axios-bare-timeout', 'svc.ts', /axios\(/)).options.timeoutMs).toBe(3000))
  // Regression: configArgIndex only ever read options for the BARE-call form of request,
  // request-promise, got and node-fetch. Method-style usage (`request.get(url, options, cb)`),
  // ordinary usage of the client the README leads with, read no options at all, producing a
  // false no-timeout on a call that was correctly protected.
  it('reads a timeout from request.get(url, options, cb) (method-style config at index 1)', async () =>
    expect(
      (await siteAt('request-method-timeout', 'svc.ts', /request\.get/)).options.timeoutMs,
    ).toBe(2000))
  it('reads a timeout from got.get(url, options) (method-style config at index 1)', async () => {
    const s = await siteAt('got-method-timeout', 'svc.ts', /got\.get/)
    // { timeout: { request: 3000 } } is not a numeric literal, so the value isn't statically
    // known, but the option IS present, which must still suppress no-timeout.
    expect(s.options.timeoutMs).toBe('instance-default')
  })
})
