#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CliIo } from '../model.js'

const USAGE = `apiwatch — audit outbound third-party HTTP calls

  apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
`
const version = () => {
  // dist/cli.js (built) sits one level below repo root; src/cli/index.ts (dev/test,
  // run directly via vitest/tsx) sits two levels below — try both so `--version`
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
  if (argv.includes('--version')) { io.write(version() + '\n'); return 0 }
  if (argv.length === 0 || argv.includes('--help')) { io.write(USAGE); return 0 }
  if (argv[0] === 'audit') return 0            // wired in Task 11
  io.write(USAGE); return 1
}
