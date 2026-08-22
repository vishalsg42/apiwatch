import { describe, expect, it } from 'vitest'
import { scanCorpus } from '../scripts/scan-corpus.js'
import { tmpCopyOf } from './helpers.js'

describe('scanCorpus', () => {
  it('aggregates without retaining per-repo identity', async () => {
    const s = await scanCorpus([tmpCopyOf('simple-express'), tmpCopyOf('clean-repo')])
    expect(s.repos).toBe(2)
    expect(s.callSites).toBeGreaterThan(0)
    expect(Object.keys(s)).not.toContain('perRepo')
  })
  it('counts a clean repo as protected', async () =>
    expect((await scanCorpus([tmpCopyOf('clean-repo')])).withTimeout).toBe(1))
  it('records a failure without aborting the run', async () => {
    const s = await scanCorpus(['/does/not/exist', tmpCopyOf('clean-repo')])
    expect(s.repos).toBe(2)
    expect(s.reposFailed).toBe(1)
  })
  // Regression: withTimeout used to be derived as `callSiteCount - noTimeout`, which silently
  // counted every 'unknown' (unreadable config argument) call site as protected, the same shape
  // as the twilio-node false positive: a corpus scan reported 159 call sites with 0 timeouts,
  // when the real story was 159 sites that could not be read at all. A call site whose config
  // is an unreadable identifier must count toward `unreadable`, not `withTimeout` or `withRetry`.
  it('counts an unreadable config argument as unreadable, not as protected', async () => {
    const s = await scanCorpus([tmpCopyOf('config-identifier')])
    expect(s.callSites).toBe(1)
    expect(s.withTimeout).toBe(0)
    expect(s.withRetry).toBe(0)
    expect(s.unreadable).toBe(1)
    // Neither rule fires on 'unknown', so this must not show up as a finding either.
    expect(s.byRule['no-timeout']).toBeUndefined()
    expect(s.byRule['no-retry']).toBeUndefined()
  })
})
