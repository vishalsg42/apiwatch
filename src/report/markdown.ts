import type { ReportModel } from '../model.js'

const DETAIL_CAP = 50

export function renderMarkdown(m: ReportModel): string {
  const L: string[] = []
  L.push('# apiwatch audit', '')
  L.push(
    `analysed ${m.filesAnalysed - m.filesSkipped} of ${m.filesAnalysed} files · ` +
      `${m.callSiteCount} outbound call sites`,
  )
  // Mirror renderTty: a suppression the reader cannot see is indistinguishable from a rule that
  // found nothing. This file gets committed, so an undisclosed baseline made a repo with 10
  // suppressed findings look genuinely clean. Spelled out rather than the terse tty form,
  // because a reader of the committed file did not run the command.
  if (m.baselineAccepted > 0 || m.baselineResolved > 0) {
    const parts = [`Baseline suppressed ${m.baselineAccepted} finding(s) (already accepted).`]
    if (m.baselineResolved > 0)
      parts.push(
        `${m.baselineResolved} baseline entr(y/ies) no longer match; run \`apiwatch baseline prune\`.`,
      )
    L.push('', parts.join(' '))
  }
  if (m.nonShippingFilesExcluded > 0)
    L.push(
      '',
      `Skipped ${m.nonShippingFilesExcluded} files in example/benchmark/doc directories. ` +
        'Run with `--include-non-shipping` to audit them.',
    )
  L.push('')

  L.push('## Summary', '')
  L.push('| rule | severity | count |', '| --- | --- | --- |')
  for (const [rule, n] of Object.entries(m.countsByRule)) {
    const sev = m.findings.find((f) => f.rule === rule)?.severity ?? ''
    L.push(`| ${rule} | ${sev} | ${n} |`)
  }
  L.push('')

  L.push('## Findings', '')
  L.push('| rule | file | line | message |', '| --- | --- | --- | --- |')
  for (const f of m.findings.slice(0, DETAIL_CAP))
    L.push(`| ${f.rule} | ${f.file} | ${f.line} | ${f.message} |`)
  L.push('')
  if (m.findings.length > DETAIL_CAP)
    L.push(`_… and ${m.findings.length - DETAIL_CAP} more findings not shown above._`, '')

  if (m.unresolvedHostCount > 0)
    L.push(
      `hosts unresolved for ${m.unresolvedHostCount} call sites ` +
        '(urls are built at runtime, so static analysis cannot see them)',
      '',
    )

  return `${L.join('\n')}\n`
}
