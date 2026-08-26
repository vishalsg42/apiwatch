import type { ReportModel } from '../model.js'

const C = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const c = (code: string, s: string) => (C ? `\x1b[${code}m${s}\x1b[0m` : s)

const DETAIL_CAP = 50

/**
 * Diagnostics that are NOT part of the `--json` contract.
 *
 * renderJson is `JSON.stringify(model)` against a schema stamped `schemaVersion: 2`, so a hint
 * for a human reading a terminal has no business widening it. Passed alongside instead.
 */
export type TtyExtras = {
  /** Files that import an HTTP client and produced no call site. See runAudit. */
  clientFilesWithoutCallSites?: readonly string[]
}

export function renderTty(m: ReportModel, extras: TtyExtras = {}): string {
  const L: string[] = ['']
  // Math.max because filesSkipped is seeded from unreadableDirs, whose files were never
  // enumerated into filesAnalysed, so the difference can go negative on a partial run. Clamping
  // the DISPLAY only: filesSkipped itself gates the fail-closed baseline guards in cli/index.ts
  // and must keep its real value.
  L.push(
    `  analysed ${Math.max(0, m.filesAnalysed - m.filesSkipped)} of ${m.filesAnalysed} files · ` +
      `${m.callSiteCount} outbound call sites`,
  )
  // Say what was left out. An exclusion the reader cannot see is indistinguishable from a
  // rule that found nothing, and silent suppression is the harder defect to notice.
  // Say what the baseline hid. A suppression the reader cannot see is indistinguishable from
  // a rule that found nothing.
  if (m.baselineAccepted > 0 || m.baselineResolved > 0)
    L.push(
      c(
        '2',
        `  baseline: ${m.baselineAccepted} accepted` +
          (m.baselineResolved > 0
            ? `, ${m.baselineResolved} resolved (run \`apiwatch baseline prune\`)`
            : ''),
      ),
    )
  if (m.nonShippingFilesExcluded > 0)
    L.push(
      c(
        '2',
        `  skipped ${m.nonShippingFilesExcluded} files in example/benchmark/doc dirs ` +
          `(--include-non-shipping to audit them)`,
      ),
    )
  // A zero that the reader cannot explain is the one failure mode this project has no counter
  // for: a client apiwatch could not resolve is skipped silently, and the file still reports as
  // analysed. Shown only when the run found nothing at all, because on a normal run the same
  // list is mostly `http.Agent` used as a type and would train the reader to ignore it.
  const unresolved = extras.clientFilesWithoutCallSites ?? []
  if (m.callSiteCount === 0 && unresolved.length > 0) {
    L.push(
      c(
        '33',
        `  ${unresolved.length} file(s) import an HTTP client but produced no call sites, ` +
          `so this zero may be a limit of the analysis rather than a property of the repo:`,
      ),
    )
    for (const f of unresolved.slice(0, 5)) L.push(c('2', `    ${f}`))
    if (unresolved.length > 5) L.push(c('2', `    ... and ${unresolved.length - 5} more`))
    L.push(
      c(
        '2',
        '  A client reached through an expression is the usual cause. See docs/limitations.md',
      ),
    )
  }
  L.push('')
  // The counts-by-rule summary always covers every finding, even when the detail
  // list below is capped: a repo with hundreds of findings still gets an honest total.
  for (const [rule, n] of Object.entries(m.countsByRule)) {
    const sev = m.findings.find((f) => f.rule === rule)?.severity
    // Three severities, three glyphs. Rendering 'info' as a warning made a note about a
    // hardcoded host look like a defect, which is the dilution this severity exists to avoid.
    const glyph = sev === 'error' ? '✖' : sev === 'warn' ? '⚠' : 'ℹ'
    const colour = sev === 'error' ? '31' : sev === 'warn' ? '33' : '2'
    L.push(`  ${c(colour, glyph)} ${rule.padEnd(22)} ${String(n).padStart(4)}`)
  }
  L.push('')
  for (const f of m.findings.slice(0, DETAIL_CAP))
    L.push(`  ${c('36', `${f.file}:${f.line}`)}  ${f.message}`)
  // --json, not .apiwatch/audit.md. That file is written only under --write-report, so this line
  // used to name a path that usually does not exist; and even when it does, the Markdown report
  // applies this same DETAIL_CAP and says the rest are not shown. renderJson has no cap, so it is
  // the only output that can actually deliver what this line promises.
  if (m.findings.length > DETAIL_CAP)
    L.push(
      '',
      c('2', `  … and ${m.findings.length - DETAIL_CAP} more (use --json to see all findings)`),
    )
  if (m.unresolvedHostCount > 0)
    L.push(
      '',
      `  hosts unresolved for ${m.unresolvedHostCount} call sites ` +
        '(urls are built at runtime, so static analysis cannot see them)',
    )
  return `${L.join('\n')}\n`
}
