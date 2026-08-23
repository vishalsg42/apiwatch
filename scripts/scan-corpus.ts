#!/usr/bin/env node
// Public-corpus scanner: the launch dataset (aggregate stats over public repos, no per-repo
// identity retained) and a false-positive smoke test at scale. scanCorpus only ever touches
// local directories; cloning a URL list into a temp dir, and removing it again, is main()'s
// job, not this function's: scanCorpus takes directories it does not own and must never
// delete them.
//
// main() removes its temp clone directory when it finishes, success or failure. Set
// APIWATCH_KEEP_CLONES=1 to keep the clones around, e.g. to inspect a specific repo's
// results after the run.
import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAudit } from '../src/cli/audit.js'
import type { CorpusStats } from '../src/model.js'

export type ScanOptions = {
  /** Audit sample code, benchmarks and docs too. Off by default, matching `apiwatch audit`. */
  includeNonShipping?: boolean
}

export async function scanCorpus(repoDirs: string[], opts: ScanOptions = {}): Promise<CorpusStats> {
  const stats: CorpusStats = {
    repos: 0,
    reposFailed: 0,
    callSites: 0,
    withTimeout: 0,
    withRetry: 0,
    withValidation: 0,
    unreadable: 0,
    nonShippingFilesExcluded: 0,
    findingsOutsideShippedCode: 0,
    byRule: {},
  }

  for (const dir of repoDirs) {
    stats.repos++
    try {
      const st = statSync(dir)
      if (!st.isDirectory()) throw new Error(`${dir} is not a directory`)

      const { model, sites } = await runAudit({
        root: dir,
        json: true,
        includeNonShipping: opts.includeNonShipping,
      })

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
      stats.nonShippingFilesExcluded += model.nonShippingFilesExcluded
      // Directory-name heuristic, deliberately broader than the audit's own exclusion: this is
      // for honesty about an ecosystem statistic, not for deciding what to report to a user.
      // Substring-matched so `extra/push-examples/` is caught, which the audit's exact-segment
      // rule misses.
      stats.findingsOutsideShippedCode += model.findings.filter((f) =>
        /(^|\/)(scripts?|tools?|tooling|bin|extra|[^/]*examples?|[^/]*samples?|demos?|benchmarks?|docs?|website|fixtures?|__mocks__|e2e|cypress)(\/|$)/.test(
          `/${f.file}`,
        ),
      ).length
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

// Best-effort "owner/name" label for progress output, e.g.
// "https://github.com/koajs/koa.git" -> "koajs/koa". Falls back to the raw url when it does
// not look like a typical hosted git url.
function repoLabel(url: string): string {
  const stripped = url.replace(/\.git$/, '')
  const parts = stripped.split(/[/:]/).filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/') : url
}

// Combines a single repo's CorpusStats into a running total, in place. Kept out of
// scanCorpus itself so that function's per-array-of-dirs contract stays untouched; this is
// only needed because main() now runs scanCorpus once per repo to get per-repo progress.
function mergeStats(into: CorpusStats, from: CorpusStats): void {
  into.repos += from.repos
  into.reposFailed += from.reposFailed
  into.callSites += from.callSites
  into.withTimeout += from.withTimeout
  into.withRetry += from.withRetry
  into.withValidation += from.withValidation
  into.unreadable += from.unreadable
  into.nonShippingFilesExcluded += from.nonShippingFilesExcluded
  into.findingsOutsideShippedCode += from.findingsOutsideShippedCode
  for (const [rule, count] of Object.entries(from.byRule))
    into.byRule[rule] = (into.byRule[rule] ?? 0) + count
}

// Generous enough for a large monorepo on a slow link, short enough that one pathological
// repo cannot hold up the rest of the corpus.
const CLONE_TIMEOUT_MS = Number(process.env.APIWATCH_CLONE_TIMEOUT_MS ?? 5 * 60_000)

// Clones are network bound and scans are CPU and memory bound, so the two parallelise very
// differently. Clone a window of repos at once, then scan them one at a time: scanning several
// large repos concurrently is what exhausts the V8 heap, and a serial scan keeps peak memory
// at roughly one repo's worth no matter how wide the clone window is.
const CLONE_CONCURRENCY = Number(process.env.APIWATCH_CLONE_CONCURRENCY ?? 4)

const cloneOne = (url: string, dest: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(
      'git',
      ['clone', '--depth', '1', '--quiet', url, dest],
      { timeout: CLONE_TIMEOUT_MS },
      // A clone that fails or times out still resolves: scanCorpus finds nothing at `dest`
      // and records it as a failed repo, the same as any repo that fails to analyse.
      (err) => resolve(!err),
    )
  })

async function main() {
  const argv = process.argv.slice(2)
  // `--skip <n>` drops the first n urls, so a run aborted partway can resume without
  // recloning and rescanning what already succeeded.
  const skipAt = argv.indexOf('--skip')
  const skip = skipAt === -1 ? 0 : Number(argv[skipAt + 1] ?? 0)
  // Drop the flag and its value only when the flag is actually present. Deriving the value
  // index from a -1 flag index yields 0, which silently swallowed the first repo of every
  // run that did not pass --skip.
  const urls = (skipAt === -1 ? argv : argv.filter((_, i) => i !== skipAt && i !== skipAt + 1))
    .filter((a) => a !== '--include-non-shipping')
    .slice(skip)
  const partialPath = process.env.APIWATCH_CORPUS_PARTIAL
  // Lets one corpus be measured under both rules, so a run started before the non-shipping
  // exclusion existed can be extended without mixing two measurement rules in one total.
  const includeNonShipping = argv.includes('--include-non-shipping')
  if (urls.length === 0) {
    process.stderr.write('usage: scan-corpus.ts <git-url> [<git-url> ...]\n')
    process.exitCode = 1
    return
  }

  const keepClones = process.env.APIWATCH_KEEP_CLONES === '1'
  const base = mkdtempSync(join(tmpdir(), 'apiwatch-corpus-'))
  try {
    const stats: CorpusStats = {
      repos: 0,
      reposFailed: 0,
      callSites: 0,
      withTimeout: 0,
      withRetry: 0,
      withValidation: 0,
      unreadable: 0,
      nonShippingFilesExcluded: 0,
      findingsOutsideShippedCode: 0,
      byRule: {},
    }

    let done = 0
    for (let w = 0; w < urls.length; w += CLONE_CONCURRENCY) {
      const window = urls.slice(w, w + CLONE_CONCURRENCY)
      process.stderr.write(`cloning ${window.length}: ${window.map(repoLabel).join(', ')}\n`)
      // Fetch the whole window at once, then scan serially. Only the clones overlap.
      const cloned = await Promise.all(
        window.map((url, k) => cloneOne(url, join(base, `repo-${w + k}`))),
      )

      for (const [k, url] of window.entries()) {
        const dest = join(base, `repo-${w + k}`)
        done += 1
        const result = await scanCorpus([dest], { includeNonShipping })
        mergeStats(stats, result)
        process.stderr.write(
          `[${done}/${urls.length}] ${repoLabel(url)}: ${result.callSites} sites` +
            `${cloned[k] ? '' : ' (clone failed)'}\n`,
        )

        // Free the clone as soon as it is scanned. Holding every clone until the end cost
        // 3.1 GB across 19 repos, so a 100 repo run would need roughly 17 GB of disk for
        // trees that are never read again.
        if (!keepClones) rmSync(dest, { recursive: true, force: true })

        // A single oversized repo can exhaust the V8 heap and abort the process, which takes
        // every prior repo's work with it. Writing the running total after each repo means a
        // crash costs one repo instead of the whole run, and `--skip` resumes from here.
        if (partialPath)
          writeFileSync(partialPath, `${JSON.stringify({ scanned: done, stats }, null, 2)}\n`)
      }
    }

    // Print before cleanup, not after: stats must reach stdout even though the finally
    // block below always runs, success or failure.
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`)
  } finally {
    if (!keepClones) rmSync(base, { recursive: true, force: true })
  }
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
