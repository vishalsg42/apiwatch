import { describe, expect, it } from 'vitest'
import type { ReportModel } from '../src/model.js'
import { renderJson } from '../src/report/json.js'
import { sitesFor } from './helpers.js'

// `retry` collapses seven distinct situations into three words: four unrelated causes produce
// 'unknown' and three produce 'none'. retryReason names which one, so the resolver's own reasoning
// can be inspected. Nothing reads it at runtime, so without this file it is untested surface.
const reasonOf = async (file: string) => {
  const s = (await sitesFor('retry-reason', file))[0]
  return { retry: s.options.retry, reason: s.options.retryReason }
}

describe('retryReason', () => {
  // The three routes to a PROVEN absence. These are the calls no-retry actually fires on.
  it('names an absent config argument', async () =>
    expect(await reasonOf('reason-absent.ts')).toEqual({ retry: 'none', reason: 'absent' }))

  it('names a readable config that simply has no retry key', async () =>
    expect(await reasonOf('reason-absent-readable.ts')).toEqual({
      retry: 'none',
      reason: 'absent',
    }))

  it('names an explicit disable, which is a decision rather than an omission', async () =>
    expect(await reasonOf('reason-disabled.ts')).toEqual({ retry: 'none', reason: 'disabled' }))

  // The two routes to a proven PRESENCE.
  it('names a retry key read off this call', async () =>
    expect(await reasonOf('reason-explicit.ts')).toEqual({ retry: 'library', reason: 'explicit' }))

  it('names a client that retries by default', async () =>
    expect(await reasonOf('reason-client-default.ts')).toEqual({
      retry: 'library',
      reason: 'client-default',
    }))

  // The two routes to an abstention. Telling these apart is the whole point: 'unreadable' is a
  // call apiwatch cannot see into, while 'manual-loop' is one it can see and deliberately declines
  // to judge. A precision audit that treats them alike measures nothing.
  it('names an unreadable config argument', async () =>
    expect(await reasonOf('reason-unreadable.ts')).toEqual({
      retry: 'unknown',
      reason: 'unreadable',
    }))

  it('names an opaque spread', async () =>
    expect(await reasonOf('reason-opaque-spread.ts')).toEqual({
      retry: 'unknown',
      reason: 'opaque-spread',
    }))

  it('names a hand-rolled retry loop', async () =>
    expect(await reasonOf('reason-manual-loop.ts')).toEqual({
      retry: 'unknown',
      reason: 'manual-loop',
    }))
})

// retryReason lives on CallOptions, which hangs off CallSite. ReportModel carries findings, not
// call sites, so the machine-readable contract stamped schemaVersion 2 must be untouched by it.
// Asserted rather than assumed, because renderJson is a bare JSON.stringify of the whole model:
// anything that reaches ReportModel is published, silently and immediately.
describe('the --json contract', () => {
  it('does not carry retryReason, or any other call-site option', () => {
    const model: ReportModel = {
      schemaVersion: 2,
      filesAnalysed: 1,
      filesSkipped: 0,
      callSiteCount: 1,
      unresolvedHostCount: 0,
      nonShippingFilesExcluded: 0,
      baselineAccepted: 0,
      baselineResolved: 0,
      countsByRule: { 'no-retry': 1 },
      findings: [],
    }
    expect(renderJson(model)).not.toMatch(/retryReason|timeoutMs|validated/)
    expect(Object.keys(JSON.parse(renderJson(model))).sort()).toEqual(
      [
        'baselineAccepted',
        'baselineResolved',
        'callSiteCount',
        'countsByRule',
        'filesAnalysed',
        'filesSkipped',
        'findings',
        'nonShippingFilesExcluded',
        'schemaVersion',
        'unresolvedHostCount',
      ].sort(),
    )
  })
})
