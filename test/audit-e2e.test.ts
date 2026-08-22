import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'
import { tmpCopyOf } from './helpers.js'

describe('apiwatch audit', () => {
  it('finds findings and exits 0 by default', async () => {
    const r = await runAudit({ root: tmpCopyOf('simple-express') })
    expect(r.code).toBe(0)
    expect(r.output).toContain('no-timeout')
  })
  it('exits 1 with --fail-on error', async () =>
    expect((await runAudit({ root: tmpCopyOf('simple-express'), failOn: 'error' })).code).toBe(1))
  it('exits 1 with --fail-on warn when only warnings exist', async () =>
    expect((await runAudit({ root: tmpCopyOf('warn-only'), failOn: 'warn' })).code).toBe(1))
  it('is silent on a clean repo', async () => {
    const r = await runAudit({ root: tmpCopyOf('clean-repo'), failOn: 'warn' })
    expect(r.code).toBe(0)
    expect(r.model.findings).toHaveLength(0)
  })
  it('writes the markdown report', async () => {
    const d = tmpCopyOf('simple-express')
    await runAudit({ root: d })
    expect(existsSync(join(d, '.apiwatch/audit.md'))).toBe(true)
  })
  // Revision 2 asserted filesSkipped > 0 on a malformed file, but TypeScript's parser is
  // error-recovering and never throws on invalid JS — it returns a tree with diagnostics
  // instead, so filesSkipped stays 0 even for src/bad.js. What actually matters is that one
  // malformed file must not suppress findings in sibling files, so we assert on the real axios
  // call in broken-syntax/src/ok.js instead.
  it('still reports findings from sibling files when one file is malformed', async () => {
    const r = await runAudit({ root: tmpCopyOf('broken-syntax') })
    expect(r.code).toBe(0)
    expect(r.model.callSiteCount).toBeGreaterThan(0)
  })
  it('finds the cross-module client in an end-to-end run', async () => {
    const r = await runAudit({ root: tmpCopyOf('shared-client') })
    expect(r.model.callSiteCount).toBe(1)
    expect(r.model.countsByRule['no-timeout']).toBeUndefined() // instance timeout suppresses it
  })
  // Regression: request.get(url, options, cb) and got.get(url, options) both read no options
  // at all before the configArgIndex fix, so both fired a false no-timeout despite being
  // correctly protected.
  it('does not fire no-timeout on a method-style request(url, options, cb) call', async () => {
    const r = await runAudit({ root: tmpCopyOf('request-method-timeout') })
    expect(r.model.countsByRule['no-timeout']).toBeUndefined()
  })
  it('does not fire no-timeout on a method-style got.get(url, options) call', async () => {
    const r = await runAudit({ root: tmpCopyOf('got-method-timeout') })
    expect(r.model.countsByRule['no-timeout']).toBeUndefined()
  })
  // Regression: a "retry" comment inside axios.create({...}) used to suppress no-retry for
  // every call on that instance.
  it('still fires no-retry when the only mention of retry is a comment inside create()', async () => {
    const r = await runAudit({ root: tmpCopyOf('axios-create-comment-retry') })
    expect(r.model.countsByRule['no-retry']).toBe(1)
  })
  // Regression: no-retry's idempotent-method skip read x.method, which was only populated for
  // property-access calls. A bare axios({method:'post',...}) call's method was unreadable
  // (undefined), and undefined was (wrongly, in this context) treated as idempotent, firing a
  // false no-retry despite the call being a non-idempotent POST.
  it('does not fire no-retry on a bare axios(config) call with method: post', async () => {
    const r = await runAudit({ root: tmpCopyOf('bare-call-post-method') })
    expect(r.model.countsByRule['no-retry']).toBeUndefined()
  })
  it('does not fire no-retry on a bare fetch(url, { method: "POST" }) call', async () => {
    const r = await runAudit({ root: tmpCopyOf('bare-fetch-post-method') })
    expect(r.model.countsByRule['no-retry']).toBeUndefined()
  })
  it('fires deprecated-client for request-promise', async () => {
    const r = await runAudit({ root: tmpCopyOf('request-promise-deprecated') })
    expect(r.model.countsByRule['deprecated-client']).toBe(1)
  })
})
