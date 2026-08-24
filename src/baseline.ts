import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Finding } from './model.js'
import { FP_VERSION } from './static/callsites.js'

/** Options that change WHICH findings exist, so a baseline recorded under different ones is not comparable. */
export type BaselineOptions = {
  /**
   * The audit root, expressed RELATIVE TO THE BASELINE FILE, so the value is portable: an
   * absolute path would never match between a laptop and CI. Its purpose is to catch a genuine
   * mismatch, such as recording at the repo root and later auditing `packages/api`, because
   * fingerprints embed the root-relative file path and are not comparable across roots.
   */
  root: string
  includeNonShipping: boolean
}

/** `root` as stored: relative to the baseline file's directory, posix, `.` for the same dir. */
export const relativeRoot = (baselinePath: string, root: string): string => {
  const r = relative(dirname(baselinePath), root)
  return (r === '' ? '.' : r).split(sep).join('/')
}

export type BaselineEntry = {
  fp: string
  rule: string
  file: string
  count: number
  /** Review metadata only, never identity. A line number would rot; an excerpt does not. */
  excerpt: string
}

export type Baseline = {
  version: 1
  fingerprintVersion: number
  generatedBy: string
  options: BaselineOptions
  accepted: BaselineEntry[]
}

/**
 * The baseline key. ALWAYS rule plus fingerprint, never fingerprint alone: one call site
 * routinely yields three or four findings, so keying on the fingerprint lumps them into one
 * bucket. Verified consequence of getting this wrong: removing a timeout from an already
 * accepted call site left the aggregate count unchanged, the "new" finding reported was an
 * `info` that was already there, and `--fail-on error` passed while an `error` was introduced.
 */
export const keyOf = (f: { rule: string; fingerprint: string }) => `${f.rule}:${f.fingerprint}`

/** The same key for a stored entry, whose fingerprint field is named `fp`. */
export const entryKey = (e: { rule: string; fp: string }) => `${e.rule}:${e.fp}`

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Collapses findings to one entry per key, carrying a count for genuine duplicates. */
export function toEntries(findings: Finding[]): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>()
  for (const f of findings) {
    const k = keyOf(f)
    const existing = byKey.get(k)
    if (existing) {
      existing.count += 1
      continue
    }
    byKey.set(k, {
      fp: f.fingerprint,
      rule: f.rule,
      file: f.file,
      count: 1,
      excerpt: f.evidence.slice(0, 120),
    })
  }
  return [...byKey.values()].sort((a, b) => byCodeUnit(entryKey(a), entryKey(b)))
}

/**
 * Serialised with ONE ENTRY PER LINE rather than JSON.stringify's multi-line objects. Two
 * developers on separate branches both regenerate this file; single-line entries in a sorted
 * array let git auto-merge two disjoint insertions instead of conflicting every time.
 *
 * No timestamp: it would make every regeneration a diff, and git already records when.
 */
function serialise(b: Baseline): string {
  const head = [
    '{',
    `  "version": ${b.version},`,
    `  "fingerprintVersion": ${b.fingerprintVersion},`,
    `  ${JSON.stringify('generatedBy')}: ${JSON.stringify(b.generatedBy)},`,
    `  ${JSON.stringify('options')}: ${JSON.stringify(b.options)},`,
    '  "accepted": [',
  ]
  const rows = b.accepted.map(
    (e, i) => `    ${JSON.stringify(e)}${i === b.accepted.length - 1 ? '' : ','}`,
  )
  return [...head, ...rows, '  ]', '}', ''].join('\n')
}

/**
 * Writes already-collapsed entries, for prune and accept which must preserve existing entries
 * rather than rebuild them from the current findings.
 */
export function writeEntries(
  path: string,
  entries: BaselineEntry[],
  version: string,
  options: BaselineOptions,
): Baseline {
  const baseline: Baseline = {
    version: 1,
    fingerprintVersion: FP_VERSION,
    generatedBy: `apiwatch@${version}`,
    options,
    accepted: [...entries].sort((a, b) => byCodeUnit(entryKey(a), entryKey(b))),
  }
  atomicWrite(path, serialise(baseline))
  return baseline
}

/** Written via a temp file and renamed, so an interrupted run cannot leave a truncated baseline. */
export function writeBaseline(
  path: string,
  findings: Finding[],
  version: string,
  options: BaselineOptions,
): Baseline {
  const baseline: Baseline = {
    version: 1,
    fingerprintVersion: FP_VERSION,
    generatedBy: `apiwatch@${version}`,
    options,
    accepted: toEntries(findings),
  }
  atomicWrite(path, serialise(baseline))
  return baseline
}

function atomicWrite(path: string, contents: string): void {
  // `--out .config/apiwatch/baseline.json` into a directory that does not exist reported an
  // ENOENT naming a temp file the user never asked for. Exit code 2 rather than a crash, but the
  // message pointed at the wrong thing entirely. Creating the directory is what they meant.
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${process.pid}.apiwatch-baseline.tmp`)
  writeFileSync(tmp, contents)
  renameSync(tmp, path)
}

export class BaselineError extends Error {}

/**
 * Every rejection here is deliberate: silently treating an unusable baseline as "accept
 * nothing" turns a configuration mistake into a wall of false new findings, and treating it as
 * "accept everything" hides real ones.
 */
export function readBaseline(path: string, expect?: BaselineOptions): Baseline {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new BaselineError(`baseline not found: ${path}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BaselineError(`baseline could not be parsed as JSON: ${path}`)
  }
  const b = parsed as Baseline
  if (b?.version !== 1) throw new BaselineError(`unsupported baseline version: ${b?.version}`)
  if (b.fingerprintVersion !== FP_VERSION) {
    const rel = relative(process.cwd(), path)
    const shown = rel && !rel.startsWith('..') ? rel : path
    throw new BaselineError(
      // Naming `apiwatch baseline` alone was not enough. Regenerating accepts every finding
      // currently visible, including new error-severity ones, and reports only a count, so a
      // user who runs it first never sees what they just accepted. And the bump itself usually
      // arrives unrequested: a workflow on a floating range such as `npx apiwatch@0.3` moves to
      // a new version the moment one publishes, so CI goes red with no change on their side.
      // Both the order and the pin belong here, because this is thrown in CI where nobody can
      // experiment.
      `baseline fingerprintVersion ${b.fingerprintVersion} does not match this apiwatch (${FP_VERSION}), so every entry is stale.\n` +
        '  1. review first, without --baseline, so nothing is hidden:  apiwatch audit --fail-on error\n' +
        // relative(cwd, path), not path: the caller resolved a relative --baseline to an absolute
        // one, and echoing that back hands the user a long temp-directory path they cannot copy.
        // Show them what they typed, so step 2 is paste-ready.
        `  2. then regenerate over the stale file:                     apiwatch baseline --out ${shown}\n` +
        '  then commit the new baseline.\n' +
        '  Pin an exact apiwatch version in CI (apiwatch@x.y.z, not @x.y) so a future bump is a\n' +
        '  change you choose rather than one you discover.',
    )
  }
  if (!Array.isArray(b.accepted)) throw new BaselineError('baseline is malformed: no accepted[]')
  // `count` is load-bearing arithmetic now that accept takes a max and prune takes a min, not
  // just a number carried along for display. A hand-edited 0, -1, 1.5 or "2" would silently
  // change what audit compares against, so reject it here rather than compute with it.
  for (const e of b.accepted) {
    if (!Number.isInteger(e?.count) || e.count < 1)
      throw new BaselineError(
        `baseline entry ${e?.rule}:${e?.fp} has an invalid count (${JSON.stringify(e?.count)}); counts must be positive integers`,
      )
  }
  if (expect && b.options?.root !== expect.root)
    throw new BaselineError(
      `baseline was recorded against root "${b.options?.root}" but this run used "${expect.root}"; fingerprints include the root-relative path, so they are not comparable`,
    )
  if (expect && b.options?.includeNonShipping !== expect.includeNonShipping)
    throw new BaselineError(
      'baseline was recorded with a different --include-non-shipping setting, so it describes a different finding set',
    )
  return b
}
