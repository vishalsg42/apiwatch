#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CliIo } from '../model.js'
import { runAudit } from './audit.js'

const USAGE = `apiwatch: audit outbound third-party HTTP calls

  apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
                 [--include-non-shipping]

  --include-non-shipping  also audit example/, benchmark/, docs/ and similar
                          directories, which are skipped by default
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
    const flag = (name: string) => {
      const i = rest.indexOf(name)
      return i === -1 ? undefined : rest[i + 1]
    }
    const root = flag('--root') ? resolve(flag('--root') as string) : process.cwd()
    const json = rest.includes('--json')
    const failOnRaw = flag('--fail-on')
    const failOn = failOnRaw === 'error' || failOnRaw === 'warn' ? failOnRaw : undefined
    const includeNonShipping = rest.includes('--include-non-shipping')
    const result = await runAudit({ root, json, failOn, includeNonShipping })
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
