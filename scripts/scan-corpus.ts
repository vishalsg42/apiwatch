#!/usr/bin/env node
// Public-corpus scanner: the launch dataset (aggregate stats over public repos, no per-repo
// identity retained) and a false-positive smoke test at scale. scanCorpus only ever touches
// local directories — cloning a URL list into a temp dir is main()'s job, not this function's.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
    byRule: {},
  }

  for (const dir of repoDirs) {
    stats.repos++
    try {
      const st = statSync(dir)
      if (!st.isDirectory()) throw new Error(`${dir} is not a directory`)

      const { model } = await runAudit({ root: dir, json: true })
      const noTimeout = model.countsByRule['no-timeout'] ?? 0
      const noRetry = model.countsByRule['no-retry'] ?? 0
      const unvalidated = model.countsByRule['unvalidated-response'] ?? 0

      stats.callSites += model.callSiteCount
      stats.withTimeout += model.callSiteCount - noTimeout
      stats.withRetry += model.callSiteCount - noRetry
      stats.withValidation += model.callSiteCount - unvalidated
      for (const [rule, count] of Object.entries(model.countsByRule))
        stats.byRule[rule] = (stats.byRule[rule] ?? 0) + count
    } catch {
      // one repo that fails to clone, discover or parse must not abort the run — record it
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
      // an unclonable URL still gets counted — scanCorpus will find nothing at `dest` and
      // record it as a failed repo, same as any repo that fails to analyse.
    }
    dirs.push(dest)
  }

  const stats = await scanCorpus(dirs)
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`)
}

// Entrypoint guard, mirroring src/cli/index.ts: run main() only when this file is the
// program's main entry (`pnpm tsx scripts/scan-corpus.ts ...`), never when imported by tests.
const isMainEntry = () => {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === new URL(`file://${resolve(entry)}`).href
}
if (isMainEntry()) await main()
