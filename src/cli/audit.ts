import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
  let filesSkipped = 0

  for (const { project } of projects)
    for (const sf of project.getSourceFiles()) {
      try {
        sites.push(...findCallSites(sf, resolveClients(sf, registry), ws))
      } catch {
        filesSkipped++
      }
    }

  const findings = runRules(sites, ws)
  const model = buildReport({
    findings,
    sites,
    filesAnalysed: ws.sourceFiles.length,
    filesSkipped,
    nonShippingFilesExcluded: ws.nonShippingFilesExcluded,
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
  const breach =
    opts.failOn === 'error'
      ? findings.some((f) => f.severity === 'error')
      : opts.failOn === 'warn'
        ? findings.length > 0
        : false
  return { code: breach ? 1 : 0, output, model, sites }
}
