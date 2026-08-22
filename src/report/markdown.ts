import type { ReportModel } from '../model.js'

const DETAIL_CAP = 50

export function renderMarkdown(m: ReportModel): string {
  const L: string[] = []
  L.push('# apiwatch audit', '')
  L.push(
    `analysed ${m.filesAnalysed - m.filesSkipped} of ${m.filesAnalysed} files · ` +
      `${m.callSiteCount} outbound call sites`,
    '',
  )

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
      `hosts unresolved for ${m.unresolvedHostCount} call sites (urls come from config); ` +
        '`apiwatch audit -- npm run dev` (planned for v0.2)',
      '',
    )

  return `${L.join('\n')}\n`
}
