#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CliIo } from '../model.js'
import { runAudit } from './audit.js'

const USAGE = `apiwatch: audit outbound HTTP calls

  apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
                 [--include-non-shipping]

  --include-non-shipping  also audit example/, benchmark/, docs/ and similar
                          directories, which are skipped by default
  --write-report          write .apiwatch/audit.md; without it the audit only
                          reads, leaving the audited repo untouched
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

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  if (argv.includes('--version')) {
    io.write(`${version()}\n`)
    return 0
  }
  if (argv.length === 0 || argv.includes('--help')) {
    io.write(USAGE)
    return 0
  }
  if (argv[0] === 'audit') {
    const rest = argv.slice(1)
    // Every argument is validated before any work happens. A mistyped path used to produce a
    // clean, green, zero-finding audit, which is the single worst outcome for a CI guard: the
    // build passes precisely because nothing was examined.
    const json = rest.includes('--json')
    const BOOL_FLAGS = ['--json', '--include-non-shipping', '--write-report']
    const VALUE_FLAGS = ['--root', '--fail-on']

    // Returns the flag's value, or the MISSING sentinel when the flag is present but its value
    // is absent or is itself a flag. `--root --json` used to audit a directory literally named
    // "--json"; a sentinel keeps that case distinguishable from "flag not supplied at all".
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
        // Positional tokens are only ever the value of the preceding value flag.
        if (i === 0 || !VALUE_FLAGS.includes(rest[i - 1])) {
          io.write(`apiwatch: unexpected argument \`${a}\`\n`)
          bad = true
        }
        continue
      }
      if (!BOOL_FLAGS.includes(a) && !VALUE_FLAGS.includes(a)) {
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
      return 2
    }

    const root = rootRaw ? resolve(rootRaw) : process.cwd()
    // An unreadable root is a usage error, not an empty repository.
    let rootStat: ReturnType<typeof statSync> | undefined
    try {
      rootStat = statSync(root)
    } catch {
      io.write(`apiwatch: root does not exist: ${root}\n`)
      return 2
    }
    if (!rootStat.isDirectory()) {
      io.write(`apiwatch: root is not a directory: ${root}\n`)
      return 2
    }

    const failOn = failOnRaw === 'error' || failOnRaw === 'warn' ? failOnRaw : undefined
    const includeNonShipping = rest.includes('--include-non-shipping')
    const writeReport = rest.includes('--write-report')
    const result = await runAudit({ root, json, failOn, includeNonShipping, writeReport })
    // Zero source files means the root was wrong, empty, or entirely excluded. Silence there
    // reads as a pass, so say it out loud on stderr without failing the run.
    if (result.model.filesAnalysed === 0)
      process.stderr.write(`apiwatch: no source files found under ${root}\n`)
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
