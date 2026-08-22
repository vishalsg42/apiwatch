#!/usr/bin/env node
// Public-corpus scanner: the launch dataset (aggregate stats over public repos, no per-repo
// identity retained) and a false-positive smoke test at scale. scanCorpus only ever touches
// local directories; cloning a URL list into a temp dir is main()'s job, not this function's.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAudit } from '../src/cli/audit.js'
import type { CorpusStats } from '../src/model.js'

export async function scanCorpus(repoDirs: string[]): Promise<CorpusStats> {
  const stats: CorpusStats = {
    repos: 0,
    reposFailed: 0,
    callSites: 0,
    withTimeout: 0,
    withRetry: 0,
    withValidation: 0,
    unreadable: 0,
    byRule: {},
  }

  for (const dir of repoDirs) {
    stats.repos++
    try {
      const st = statSync(dir)
      if (!st.isDirectory()) throw new Error(`${dir} is not a directory`)

      const { model, sites } = await runAudit({ root: dir, json: true })

      stats.callSites += model.callSiteCount
      // no-timeout, no-retry and unvalidated-response all deliberately abstain on 'unknown'
      // (timeoutMs and retry are no longer just "protected or not": an unreadable config
      // argument is neither), so "no finding" is not the same as "protected". Deriving
      // withTimeout from callSiteCount - noTimeout used to silently count every 'unknown' site
      // as protected, which is exactly the twilio-node false-positive bug turned inside out:
      // the count claimed 159 protected call sites that were never actually read. Count
      // straight from the sites' own verdicts instead, for all three fields.
      stats.withTimeout += sites.filter(
        (s) => s.options.timeoutMs !== null && s.options.timeoutMs !== 'unknown',
      ).length
      stats.withRetry += sites.filter((s) => s.options.retry === 'library').length
      stats.withValidation += sites.filter((s) => s.options.validated === true).length
      stats.unreadable += sites.filter(
        (s) => s.options.timeoutMs === 'unknown' || s.options.retry === 'unknown',
      ).length
      for (const [rule, count] of Object.entries(model.countsByRule))
        stats.byRule[rule] = (stats.byRule[rule] ?? 0) + count
    } catch {
      // one repo that fails to clone, discover or parse must not abort the run: record it
      // and move on to the next.
      stats.reposFailed++
    }
  }

  return stats
}

async function main() {
  const urls = process.argv.slice(2)
  if (urls.length === 0) {
    process.stderr.write('usage: scan-corpus.ts <git-url> [<git-url> ...]\n')
    process.exitCode = 1
    return
  }

  const base = mkdtempSync(join(tmpdir(), 'apiwatch-corpus-'))
  const dirs: string[] = []
  for (const [i, url] of urls.entries()) {
    const dest = join(base, `repo-${i}`)
    try {
      execFileSync('git', ['clone', '--depth', '1', '--quiet', url, dest], { stdio: 'ignore' })
    } catch {
      // an unclonable URL still gets counted: scanCorpus will find nothing at `dest` and
      // record it as a failed repo, same as any repo that fails to analyse.
    }
    dirs.push(dest)
  }

  const stats = await scanCorpus(dirs)
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`)
}

// Entrypoint guard, mirroring src/cli/index.ts: run main() only when this file is the
// program's main entry (`pnpm tsx scripts/scan-corpus.ts ...`), never when imported by tests.
// Must realpath argv[1] before comparing: Node's ESM loader realpaths the module it loads, so
// import.meta.url is already a realpath, and a symlinked invocation would otherwise never match.
const isMainEntry = () => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}
if (isMainEntry()) await main()
