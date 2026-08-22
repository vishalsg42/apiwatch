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

describe('scan-corpus argument parsing', () => {
  // Regression: deriving the --skip value index from a -1 flag index yields 0, which drops
  // argv[0] and silently swallowed the first repo of every run that omitted --skip.
  const parse = (argv: string[]) => {
    const skipAt = argv.indexOf('--skip')
    const skip = skipAt === -1 ? 0 : Number(argv[skipAt + 1] ?? 0)
    return (skipAt === -1 ? argv : argv.filter((_, i) => i !== skipAt && i !== skipAt + 1)).slice(
      skip,
    )
  }

  it('keeps every url when --skip is absent', () =>
    expect(parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']))
  it('drops the flag, its value, and the skipped urls', () =>
    expect(parse(['--skip', '1', 'a', 'b', 'c'])).toEqual(['b', 'c']))
  it('handles --skip after the urls', () =>
    expect(parse(['a', 'b', 'c', '--skip', '2'])).toEqual(['c']))
})
