import type { CallSite, Finding, ReportModel } from '../model.js'

export function buildReport(input: {
  findings: Finding[]
  sites: CallSite[]
  filesAnalysed: number
  filesSkipped: number
  nonShippingFilesExcluded: number
}): ReportModel {
  const countsByRule: Record<string, number> = {}
  for (const f of input.findings) countsByRule[f.rule] = (countsByRule[f.rule] ?? 0) + 1

  return {
    schemaVersion: 2,
    filesAnalysed: input.filesAnalysed,
    filesSkipped: input.filesSkipped,
    callSiteCount: input.sites.length,
    unresolvedHostCount: input.sites.filter((s) => s.url.kind !== 'literal').length,
    nonShippingFilesExcluded: input.nonShippingFilesExcluded,
    countsByRule,
    findings: input.findings,
  }
}
