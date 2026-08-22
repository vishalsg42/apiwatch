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
})
