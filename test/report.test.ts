import { describe, expect, it } from 'vitest'
import { renderJson } from '../src/report/json.js'
import { renderMarkdown } from '../src/report/markdown.js'
import { buildReport } from '../src/report/model.js'
import { renderTty } from '../src/report/tty.js'
import { runRules } from '../src/rules/index.js'
import { site, ws } from './helpers.js'

const model = (sites = [site()], over: { filesAnalysed?: number; filesSkipped?: number } = {}) =>
  buildReport({
    findings: runRules(sites, ws),
    sites,
    filesAnalysed: over.filesAnalysed ?? 10,
    filesSkipped: over.filesSkipped ?? 0,
    nonShippingFilesExcluded: 0,
  })

describe('reporters', () => {
  it('counts findings by rule', () => expect(model().countsByRule['no-timeout']).toBe(1))
  it('counts call sites whose host is unresolved', () =>
    expect(model().unresolvedHostCount).toBe(1))
  it('tty names the rule, file and line', () => {
    const o = renderTty(model())
    expect(o).toContain('no-timeout')
    expect(o).toContain('src/x.ts:10')
  })
  it('tty prints the hint when hosts are unresolved', () =>
    expect(renderTty(model())).toMatch(/hosts unresolved for/))
  it('tty omits the hint when every host is known', () =>
    expect(
      renderTty(model([site({ url: { kind: 'literal', url: 'https://a.dev/x', host: 'a.dev' } })])),
    ).not.toMatch(/hosts unresolved for/))
  it('tty reports the analysed file count', () =>
    expect(renderTty(model())).toMatch(/analysed 10 of 10 files/))
  it('markdown contains a findings table header', () =>
    expect(renderMarkdown(model())).toMatch(/\| rule \|/i))
  it('json carries schemaVersion 2', () =>
    expect(JSON.parse(renderJson(model())).schemaVersion).toBe(2))
})

// Both renderers cap their detail list at 50. The tty used to send the reader to
// .apiwatch/audit.md for the rest, which is wrong twice over: that file is written only under
// --write-report, and even when written it applies the SAME cap (markdown.ts) and says so. Only
// --json is uncapped. No test covered the over-cap branch at all, which is why it survived.
describe('more findings than the detail cap', () => {
  // id and fingerprint must vary too: buildReport keys findings by fingerprint, so 51 sites
  // sharing the helper's default would collapse into one and the cap would never be reached.
  // Each site yields two findings (no-timeout and no-retry), so the overflow is derived from the
  // model rather than hardcoded.
  const many = () =>
    model(
      Array.from({ length: 51 }, (_, i) =>
        site({ id: `a${i}`, fingerprint: `fp-a${i}`, line: i + 1 }),
      ),
    )

  it('tty points at --json, which is the only uncapped output', () => {
    const m = many()
    const o = renderTty(m)
    expect(o).toContain(`… and ${m.findings.length - 50} more (use --json to see all findings)`)
    expect(o).not.toMatch(/audit\.md/)
  })

  it('markdown says the rest are not shown, rather than pointing anywhere', () => {
    const m = many()
    expect(renderMarkdown(m)).toContain(`… and ${m.findings.length - 50} more findings not shown`)
    expect(renderMarkdown(m)).not.toMatch(/use --json/)
  })

  it('json is genuinely uncapped, which is what makes the hint true', () => {
    const m = many()
    expect(m.findings.length).toBeGreaterThan(50)
    expect(JSON.parse(renderJson(m)).findings.length).toBe(m.findings.length)
  })
})

// filesSkipped is seeded from unreadableDirs (cli/audit.ts), whose files were never enumerated
// into filesAnalysed, so the difference can go negative and both renderers printed it raw. The
// conflation is deliberate: filesSkipped > 0 gates two fail-closed guards that refuse to write or
// compare a baseline from a partial run. So this clamps the DISPLAY only. If a drift test fails,
// the fix is wrong, not the test.
describe('a partial run where whole directories could not be listed', () => {
  it('tty never prints a negative analysed count', () => {
    const o = renderTty(model([site()], { filesAnalysed: 0, filesSkipped: 3 }))
    expect(o).toMatch(/analysed 0 of 0 files/)
    expect(o).not.toMatch(/analysed -/)
  })

  it('markdown never prints a negative analysed count', () => {
    const o = renderMarkdown(model([site()], { filesAnalysed: 0, filesSkipped: 3 }))
    expect(o).toMatch(/analysed 0 of 0 files/)
    expect(o).not.toMatch(/analysed -/)
  })

  it('leaves filesSkipped itself untouched, because the guards read it', () =>
    expect(model([site()], { filesAnalysed: 0, filesSkipped: 3 }).filesSkipped).toBe(3))
})
