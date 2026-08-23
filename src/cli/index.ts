#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type Baseline,
  type BaselineEntry,
  entryKey,
  readBaseline,
  relativeRoot,
  toEntries,
  writeBaseline,
  writeEntries,
} from '../baseline.js'
import type { CliIo } from '../model.js'
import { runAudit } from './audit.js'

const USAGE = `apiwatch: audit outbound HTTP calls

  apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
                 [--include-non-shipping] [--baseline <file>]

  apiwatch baseline        [--root <dir>] [--out <file>]   record current findings
  apiwatch baseline prune  [--root <dir>] [--out <file>]   drop entries that no longer match
  apiwatch baseline accept [--root <dir>] [--out <file>]   add findings that are currently new

  --baseline <file>       report only findings absent from the baseline
  --out <file>            baseline path (default .apiwatch-baseline.json)
  --include-non-shipping  also audit example/, benchmark/, docs/ and similar
                          directories, which are skipped by default
  --write-report          write .apiwatch/audit.md; without it the audit only
                          reads, leaving the audited repo untouched
  --allow-partial         write a baseline even though some files failed to analyse

`
const version = () => {
  // dist/cli.js (built) sits one level below repo root; src/cli/index.ts (dev/test,
  // run directly via vitest/tsx) sits two levels below; try both so `--version`
  // works whether apiwatch is running from source or from the tsup build.
  for (const up of ['../package.json', '../../package.json']) {
    const candidate = resolve(import.meta.dirname, up)
    if (existsSync(candidate)) {
      return (JSON.parse(readFileSync(candidate, 'utf8')) as { version: string }).version
    }
  }
  throw new Error('apiwatch: could not locate package.json to resolve version')
}

/**
 * Validates the shared audit-style arguments used by `audit` and by the baseline commands.
 *
 * This lives outside the command branches on purpose. It began inline inside `audit`, and the
 * moment a second command needed the same guarantees, copying it would have guaranteed drift.
 * Every argument is checked before any work happens, because a mistyped path used to produce a
 * clean, green, zero-finding audit: the single worst outcome for a CI guard, since the build
 * passes precisely because nothing was examined.
 */
export type AuditArgs = {
  root: string
  json: boolean
  failOn?: 'error' | 'warn'
  includeNonShipping: boolean
  writeReport: boolean
}

const BOOL_FLAGS = ['--json', '--include-non-shipping', '--write-report']
const VALUE_FLAGS = ['--root', '--fail-on']

export function parseAuditArgs(
  rest: string[],
  io: CliIo,
  extraBool: string[] = [],
  extraValue: string[] = [],
): { ok: true; args: AuditArgs } | { ok: false; code: number } {
  const boolFlags = [...BOOL_FLAGS, ...extraBool]
  const valueFlags = [...VALUE_FLAGS, ...extraValue]

  // Returns the flag's value, or MISSING when the flag is present but its value is absent or is
  // itself a flag. `--root --json` used to audit a directory literally named "--json"; the
  // sentinel keeps that distinguishable from "flag not supplied at all".
  const MISSING = Symbol('missing')
  const flagValue = (name: string): string | typeof MISSING | undefined => {
    const i = rest.indexOf(name)
    if (i === -1) return undefined
    const v = rest[i + 1]
    if (v === undefined || v.startsWith('-')) {
      io.write(`apiwatch: ${name} requires a value\n`)
      return MISSING
    }
    return v
  }

  let bad = false
  for (const [i, a] of rest.entries()) {
    if (!a.startsWith('-')) {
      // A positional token is only ever the value of the preceding value flag.
      if (i === 0 || !valueFlags.includes(rest[i - 1])) {
        io.write(`apiwatch: unexpected argument \`${a}\`\n`)
        bad = true
      }
      continue
    }
    if (!boolFlags.includes(a) && !valueFlags.includes(a)) {
      io.write(`apiwatch: unknown flag \`${a}\`\n`)
      bad = true
    }
  }

  const rootVal = flagValue('--root')
  if (rootVal === MISSING) bad = true
  const rootRaw = typeof rootVal === 'string' ? rootVal : undefined

  const failOnVal = flagValue('--fail-on')
  if (failOnVal === MISSING) bad = true
  const failOnRaw = typeof failOnVal === 'string' ? failOnVal : undefined
  if (failOnRaw !== undefined && failOnRaw !== 'error' && failOnRaw !== 'warn') {
    io.write(`apiwatch: --fail-on must be \`error\` or \`warn\`, got \`${failOnRaw}\`\n`)
    bad = true
  }
  if (bad) {
    io.write(USAGE)
    return { ok: false, code: 2 }
  }

  const root = rootRaw ? resolve(rootRaw) : process.cwd()
  // An unreadable root is a usage error, not an empty repository.
  let rootStat: ReturnType<typeof statSync> | undefined
  try {
    rootStat = statSync(root)
  } catch {
    io.write(`apiwatch: root does not exist: ${root}\n`)
    return { ok: false, code: 2 }
  }
  if (!rootStat.isDirectory()) {
    io.write(`apiwatch: root is not a directory: ${root}\n`)
    return { ok: false, code: 2 }
  }

  return {
    ok: true,
    args: {
      root,
      json: rest.includes('--json'),
      failOn: failOnRaw === 'error' || failOnRaw === 'warn' ? failOnRaw : undefined,
      includeNonShipping: rest.includes('--include-non-shipping'),
      writeReport: rest.includes('--write-report'),
    },
  }
}

/**
 * `baseline`, `baseline prune` and `baseline accept`.
 *
 * These are three commands, not one, on purpose. A single `update` that both prunes stale
 * entries and accepts new findings is a footgun: the natural time to run it is right after CI
 * fails, which is exactly when accepting everything currently visible is wrong.
 */
async function runBaseline(argv: string[], io: CliIo): Promise<number> {
  const sub = argv[1] === 'prune' || argv[1] === 'accept' ? argv[1] : undefined
  const parsed = parseAuditArgs(argv.slice(sub ? 2 : 1), io, ['--allow-partial'], ['--out'])
  if (!parsed.ok) return parsed.code
  const { root, includeNonShipping } = parsed.args
  const rest = argv.slice(sub ? 2 : 1)
  const outIdx = rest.indexOf('--out')
  const out = outIdx === -1 ? resolve('.apiwatch-baseline.json') : resolve(rest[outIdx + 1])
  const allowPartial = rest.includes('--allow-partial')

  const result = await runAudit({ root, json: true, includeNonShipping })
  // Stored relative to the baseline file so the value is portable between a laptop and CI.
  const options = { root: relativeRoot(out, root), includeNonShipping }

  // Fail closed. A baseline written from a partial analysis quietly omits findings, and the
  // whole point of the file is that what is not in it is new.
  if (result.model.filesAnalysed === 0) {
    io.write(`apiwatch: no source files found under ${root}; refusing to write a baseline\n`)
    return 2
  }
  if (result.model.filesSkipped > 0 && !allowPartial) {
    io.write(
      `apiwatch: ${result.model.filesSkipped} file(s) could not be analysed; refusing to write a baseline from a partial run (use --allow-partial to override)\n`,
    )
    return 2
  }

  try {
    if (sub === undefined) {
      // Refuse to clobber: regenerating from scratch means "accept everything visible", which
      // is never what someone wants by accident.
      if (existsSync(out)) {
        io.write(
          `apiwatch: ${out} already exists; use \`apiwatch baseline accept\` to add new findings or \`apiwatch baseline prune\` to drop resolved ones\n`,
        )
        return 2
      }
      const b = writeBaseline(out, result.model.findings, version(), options)
      io.write(`apiwatch: wrote ${b.accepted.length} accepted finding(s) to ${out}\n`)
      return 0
    }

    const existing = readBaseline(out, options)
    const current = toEntries(result.model.findings)
    const currentByKey = new Map(current.map((e) => [entryKey(e), e]))
    const existingByKey = new Map(existing.accepted.map((e) => [entryKey(e), e]))

    if (sub === 'prune') {
      // min(existing, current), never max: prune may only lower a count to what this run
      // actually produced. Raising one would be a silent `accept`, and the whole safety
      // argument for prune is that it can never turn a red audit green.
      const kept: BaselineEntry[] = []
      let prunedOccurrences = 0
      let droppedEntries = 0
      for (const e of existing.accepted) {
        const cur = currentByKey.get(entryKey(e))
        if (!cur) {
          // Key absent entirely. This is where a 2-to-0 disappearance lands, which is why
          // there is no separate "drop zero" branch: toEntries never emits a zero count.
          prunedOccurrences += e.count
          droppedEntries += 1
          continue
        }
        const count = Math.min(e.count, cur.count)
        prunedOccurrences += e.count - count
        kept.push(count === e.count ? e : { ...e, count })
      }
      writeEntries(out, kept, version(), options)
      io.write(
        `apiwatch: pruned ${prunedOccurrences} occurrence(s), dropping ${droppedEntries} entr(y/ies); ${kept.length} entr(y/ies) remain\n`,
      )
      return 0
    }

    // accept: max(existing, current), never min, so accepting can never quietly drop a
    // finding the current run no longer produces. Occurrences, not entries, are what audit
    // compares, so a second `no-timeout` at an already accepted call site is a real change
    // and must be both reported and written.
    const next: BaselineEntry[] = []
    let addedOccurrences = 0
    let newEntries = 0
    let bumpedEntries = 0
    for (const e of existing.accepted) {
      const cur = currentByKey.get(entryKey(e))
      const count = cur ? Math.max(e.count, cur.count) : e.count
      if (count !== e.count) {
        addedOccurrences += count - e.count
        bumpedEntries += 1
        io.write(`  accepting ${count - e.count} more ${e.rule}  ${e.file}  ${e.excerpt}\n`)
      }
      next.push(count === e.count ? e : { ...e, count })
    }
    for (const e of current) {
      if (existingByKey.has(entryKey(e))) continue
      addedOccurrences += e.count
      newEntries += 1
      io.write(`  accepting ${e.rule}  ${e.file}  ${e.excerpt}\n`)
      next.push(e)
    }
    // Safe to return without writing ONLY because zero new occurrences means `next` is
    // element-for-element `existing.accepted`. The old early return keyed on new KEYS, so a
    // count bump was computed and then thrown away.
    if (addedOccurrences === 0) {
      io.write('apiwatch: nothing new to accept\n')
      return 0
    }
    writeEntries(out, next, version(), options)
    io.write(
      `apiwatch: accepted ${addedOccurrences} occurrence(s) across ${newEntries} new entr(y/ies) and ${bumpedEntries} existing one(s)\n`,
    )
    return 0
  } catch (err) {
    io.write(`apiwatch: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  if (argv.includes('--version')) {
    io.write(`${version()}\n`)
    return 0
  }
  if (argv.length === 0 || argv.includes('--help')) {
    io.write(USAGE)
    return 0
  }
  if (argv[0] === 'baseline') return runBaseline(argv, io)
  if (argv[0] === 'audit') {
    const rest = argv.slice(1)
    const parsed = parseAuditArgs(rest, io, [], ['--baseline'])
    if (!parsed.ok) return parsed.code
    const { root, json, failOn, includeNonShipping, writeReport } = parsed.args

    let baseline: Baseline | undefined
    const blIdx = rest.indexOf('--baseline')
    if (blIdx !== -1) {
      const blPath = resolve(rest[blIdx + 1])
      try {
        // A --baseline path that does not exist is a usage error, never an empty baseline:
        // treating it as empty would report every finding as new, and the natural response to
        // that wall of noise is to stop trusting the gate.
        baseline = readBaseline(blPath, {
          root: relativeRoot(blPath, root),
          includeNonShipping,
        })
      } catch (err) {
        io.write(`apiwatch: ${err instanceof Error ? err.message : String(err)}\n`)
        return 2
      }
    }

    const result = await runAudit({
      root,
      json,
      failOn,
      includeNonShipping,
      writeReport,
      baseline,
    })
    // Zero source files means the root was wrong, empty, or entirely excluded. Silence there
    // reads as a pass, so say it out loud on stderr without failing the run.
    if (result.model.filesAnalysed === 0)
      process.stderr.write(`apiwatch: no source files found under ${root}\n`)
    // Gate drift on partial analysis, not just baseline generation. This is the direction that
    // actually loses safety: a file that failed to analyse contributes no findings, so its
    // findings are neither reported nor matched against the baseline, and CI goes green on a
    // repo nobody fully looked at.
    if (baseline && result.model.filesSkipped > 0) {
      io.write(
        `apiwatch: ${result.model.filesSkipped} file(s) could not be analysed; refusing to compare a partial run against a baseline\n`,
      )
      return 2
    }
    io.write(result.output)
    return result.code
  }
  io.write(USAGE)
  return 1
}

// Entrypoint guard: invoke runCli only when this module is the program's main entry (running
// as the built `dist/cli.js` bin, or directly via `node src/cli/index.ts` / tsx), not when it's
// imported by tests. Without this the bin was inert: `apiwatch --version` printed nothing.
//
// npm links a bin as a SYMLINK. `process.argv[1]` is the symlink path, and `path.resolve` does
// not follow symlinks, but Node's ESM loader realpaths the module it loads, so `import.meta.url`
// is already the REALPATH. Comparing a resolved-but-not-realpathed argv[1] against a realpathed
// import.meta.url never matches when running through a symlinked bin (i.e. every real `npm
// install` of this package), so the guard silently failed and the CLI did nothing. Realpathing
// argv[1] here fixes that. `pathToFileURL` (rather than manual `file://` string-building) also
// fixes Windows, where a manually built `file://C:\...` URL is malformed.
const isMainEntry = () => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}
if (isMainEntry()) {
  const code = await runCli(process.argv.slice(2), { write: (s) => process.stdout.write(s) })
  process.exitCode = code
}
