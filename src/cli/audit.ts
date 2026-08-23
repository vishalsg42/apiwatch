import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Baseline } from '../baseline.js'
import { entryKey, keyOf } from '../baseline.js'
import type { CallSite, ReportModel } from '../model.js'
import { renderJson } from '../report/json.js'
import { renderMarkdown } from '../report/markdown.js'
import { buildReport } from '../report/model.js'
import { renderTty } from '../report/tty.js'
import { runRules } from '../rules/index.js'
import { findCallSites } from '../static/callsites.js'
import { createProjects } from '../static/project.js'
import { buildRegistry, resolveClients } from '../static/registry.js'
import { discoverWorkspace } from '../workspace/discover.js'

export type AuditOptions = {
  root: string
  json?: boolean
  failOn?: 'error' | 'warn'
  /** Write .apiwatch/audit.md. Off by default: an audit should not mutate the repo it reads. */
  writeReport?: boolean
  /** Report only findings absent from this baseline. */
  baseline?: Baseline
  /** Audit sample code, benchmarks and docs alongside shipped code. Off by default. */
  includeNonShipping?: boolean
  // v0.2 will run a target command (e.g. `npm run dev`) to resolve hosts that come from
  // runtime config; unused in v0.1 but the option is declared now so the signature never
  // needs to change once that lands.
  command?: string[]
}

export async function runAudit(
  opts: AuditOptions,
): Promise<{ code: number; output: string; model: ReportModel; sites: CallSite[] }> {
  const ws = await discoverWorkspace(opts.root, {
    includeNonShipping: opts.includeNonShipping,
  })
  const projects = createProjects(ws)
  const registry = buildRegistry(projects)
  const sites: CallSite[] = []
  // A file that could not even be opened counts as skipped, exactly like one that threw during
  // analysis. Both mean the run did not see everything, which is what the baseline gates on.
  let filesSkipped = projects.reduce((n, p) => n + p.unreadable, 0) + ws.unreadableDirs

  for (const { project } of projects)
    for (const sf of project.getSourceFiles()) {
      try {
        sites.push(...findCallSites(sf, resolveClients(sf, registry), ws))
      } catch {
        filesSkipped++
      }
    }

  const allFindings = runRules(sites, ws)

  // Drift: partition against the baseline by (rule, fingerprint), comparing COUNTS so genuine
  // duplicates are handled without giving any single one a durable positional identity.
  let findings = allFindings
  let baselineAccepted = 0
  let baselineResolved = 0
  if (opts.baseline) {
    const remaining = new Map<string, number>()
    for (const e of opts.baseline.accepted) remaining.set(entryKey(e), e.count)
    const fresh: typeof allFindings = []
    for (const f of allFindings) {
      const k = keyOf(f)
      const left = remaining.get(k) ?? 0
      if (left > 0) {
        remaining.set(k, left - 1)
        baselineAccepted += 1
      } else {
        fresh.push(f)
      }
    }
    // Whatever is left was accepted once and no longer matches: either fixed or moved. Counted
    // and reported, never silently dropped, and never a reason to fail: failing here would turn
    // CI red on a commit that fixed something, and a gate that punishes fixing gets disabled.
    for (const n of remaining.values()) baselineResolved += n
    findings = fresh
  }

  const model = buildReport({
    findings,
    sites,
    filesAnalysed: ws.sourceFiles.length,
    filesSkipped,
    nonShippingFilesExcluded: ws.nonShippingFilesExcluded,
    baselineAccepted,
    baselineResolved,
  })
  let output = opts.json ? renderJson(model) : renderTty(model)

  // Only write a file when asked. An audit that reads a repo should not leave a new untracked
  // file in it as a side effect of every run, and 0.1.x did exactly that on every non-JSON run.
  if (!opts.json && opts.writeReport) {
    // Writing .apiwatch/audit.md is a best-effort side note, not the audit's purpose; a
    // read-only root (CI checkout, container, read-only mount) must not turn a successful
    // audit into an unhandled EACCES rejection. Degrade to a warning line instead.
    try {
      mkdirSync(join(opts.root, '.apiwatch'), { recursive: true })
      writeFileSync(join(opts.root, '.apiwatch/audit.md'), renderMarkdown(model))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      output += `\nwarning: could not write .apiwatch/audit.md (${reason})\n`
    }
  }
  // 'info' never gates a build, not even under --fail-on warn. A hardcoded vendor host or a
  // removable node-fetch@2 is worth surfacing, but failing CI on it would train people to pass
  // --fail-on error and lose the warnings that do matter.
  const breach =
    opts.failOn === 'error'
      ? findings.some((f) => f.severity === 'error')
      : opts.failOn === 'warn'
        ? findings.some((f) => f.severity === 'error' || f.severity === 'warn')
        : false
  return { code: breach ? 1 : 0, output, model, sites }
}
