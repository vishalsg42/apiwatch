#!/usr/bin/env node
// Dumps every resolved call site with its resolved options, flagged or not.
// `audit --json` emits findings only, so it cannot show the calls apiwatch decided were FINE.
// A precision sample needs both: a judge shown only flagged calls will assume every case is a
// positive and score 100% without reading anything.
import { runAudit } from '../src/cli/audit.js'

const root = process.argv[2]
if (!root) {
  process.stderr.write('usage: dump-sites.ts <repo-root>\n')
  process.exit(1)
}
const { sites } = await runAudit({ root, json: true })
process.stdout.write(
  `${JSON.stringify(
    sites.map((s) => ({
      file: s.file,
      line: s.line,
      client: s.client,
      method: s.method,
      timeoutMs: s.options.timeoutMs,
      retry: s.options.retry,
      validated: s.options.validated,
    })),
  )}\n`,
)
