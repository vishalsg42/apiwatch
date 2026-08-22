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
})
