import { readFileSync, renameSync, writeFileSync } from 'node:fs'
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
  if (b.fingerprintVersion !== FP_VERSION)
    throw new BaselineError(
      `baseline fingerprintVersion ${b.fingerprintVersion} does not match this apiwatch (${FP_VERSION}); regenerate it with \`apiwatch baseline\``,
    )
  if (!Array.isArray(b.accepted)) throw new BaselineError('baseline is malformed: no accepted[]')
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
