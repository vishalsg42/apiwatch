import type { ReportModel } from '../model.js'

const C = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const c = (code: string, s: string) => (C ? `\x1b[${code}m${s}\x1b[0m` : s)

const DETAIL_CAP = 50

export function renderTty(m: ReportModel): string {
  const L: string[] = ['']
  L.push(
    `  analysed ${m.filesAnalysed - m.filesSkipped} of ${m.filesAnalysed} files · ` +
      `${m.callSiteCount} outbound call sites`,
  )
  // Say what was left out. An exclusion the reader cannot see is indistinguishable from a
  // rule that found nothing, and silent suppression is the harder defect to notice.
  if (m.nonShippingFilesExcluded > 0)
    L.push(
      c(
        '2',
        `  skipped ${m.nonShippingFilesExcluded} files in example/benchmark/doc dirs ` +
          `(--include-non-shipping to audit them)`,
      ),
    )
  L.push('')
  // The counts-by-rule summary always covers every finding, even when the detail
  // list below is capped: a repo with hundreds of findings still gets an honest total.
  for (const [rule, n] of Object.entries(m.countsByRule)) {
    const sev = m.findings.find((f) => f.rule === rule)?.severity
    L.push(
      `  ${c(sev === 'error' ? '31' : '33', sev === 'error' ? '✖' : '⚠')} ` +
        `${rule.padEnd(22)} ${String(n).padStart(4)}`,
    )
  }
  L.push('')
  for (const f of m.findings.slice(0, DETAIL_CAP))
    L.push(`  ${c('36', `${f.file}:${f.line}`)}  ${f.message}`)
  if (m.findings.length > DETAIL_CAP)
    L.push('', c('2', `  … and ${m.findings.length - DETAIL_CAP} more (see .apiwatch/audit.md)`))
  if (m.unresolvedHostCount > 0)
    L.push(
      '',
      `  hosts unresolved for ${m.unresolvedHostCount} call sites (urls come from config)`,
      c('2', '    → apiwatch audit -- npm run dev   (planned for v0.2)'),
    )
  return `${L.join('\n')}\n`
}
