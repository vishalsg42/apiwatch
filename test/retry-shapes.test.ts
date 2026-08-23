import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

const retryOf = async (file: string) => (await sitesFor('retry-shapes', file))[0].options.retry

describe('hand-rolled retry loops', () => {
  // Silent: a counting loop whose `try` re-enters via `continue` on a failed attempt.
  it('abstains on a counter-guarded retry loop', async () =>
    expect(await retryOf('retry-counter.ts')).toBe('unknown'))

  it('abstains when the catch itself continues', async () =>
    expect(await retryOf('retry-catch-continue.ts')).toBe('unknown'))

  // Still reported: pagination is what the previous loop-ancestor heuristic got wrong,
  // suppressing 23.7% of one repo's genuine findings. It must keep firing.
  it('still reports plain pagination', async () =>
    expect(await retryOf('paginate-simple.ts')).toBe('none'))

  it('still reports pagination that breaks out on error', async () =>
    expect(await retryOf('paginate-trycatch.ts')).toBe('none'))

  // `continue` in a for...of means skip this item, not try again.
  it('still reports a for-of batch loop that skips failures', async () =>
    expect(await retryOf('batch-forof.ts')).toBe('none'))

  // `try { while (...) }` is one attempt at a loop, not a loop of attempts.
  it('still reports a loop wrapped in a try, rather than a try inside a loop', async () =>
    expect(await retryOf('try-wraps-loop.ts')).toBe('none'))
})

describe('loop ownership of a continue', () => {
  // Regression from the real repo that killed the first heuristic: a pagination `while` whose
  // body iterates records in an inner `for...of` and `continue`s to skip a bad record. Asking
  // only for the nearest COUNTING loop skipped the inner for-of and credited that continue to
  // the outer while, reading pagination as retry and suppressing 20 genuine findings.
  it('does not credit an inner for-of continue to the outer pagination loop', async () =>
    expect((await sitesFor('retry-shapes', 'paginate-inner-continue.ts'))[0].options.retry).toBe(
      'none',
    ))
})
