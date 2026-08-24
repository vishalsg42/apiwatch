import type { CallSite, Finding, ReportModel } from '../model.js'

export function buildReport(input: {
  findings: Finding[]
  sites: CallSite[]
  filesAnalysed: number
  filesSkipped: number
  nonShippingFilesExcluded: number
  baselineAccepted?: number
  baselineResolved?: number
}): ReportModel {
  const countsByRule: Record<string, number> = {}
  for (const f of input.findings) countsByRule[f.rule] = (countsByRule[f.rule] ?? 0) + 1

  return {
    schemaVersion: 2,
    filesAnalysed: input.filesAnalysed,
    filesSkipped: input.filesSkipped,
    callSiteCount: input.sites.length,
    // 'relative' is excluded: the tty line explains this count as urls built at runtime, and a
    // path literal is not that. It has no host at all, which is not the same as an unknown one.
    unresolvedHostCount: input.sites.filter(
      (s) => s.url.kind !== 'literal' && s.url.kind !== 'relative',
    ).length,
    nonShippingFilesExcluded: input.nonShippingFilesExcluded,
    baselineAccepted: input.baselineAccepted ?? 0,
    baselineResolved: input.baselineResolved ?? 0,
    countsByRule,
    findings: input.findings,
  }
}
