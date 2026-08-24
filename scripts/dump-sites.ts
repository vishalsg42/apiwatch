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
      // id identifies a physical occurrence, fingerprint the structural identity a baseline keys
      // on. Both are emitted so a sampled case can be joined back to `audit --json` findings on
      // an identity rather than on a file/line coordinate, which drifts.
      id: s.id,
      fingerprint: s.fingerprint,
      file: s.file,
      line: s.line,
      client: s.client,
      method: s.method,
      timeoutMs: s.options.timeoutMs,
      retry: s.options.retry,
      // Four unrelated causes produce retry: 'unknown' and three produce 'none'. Without the
      // reason an audit cannot tell an abstention it should ignore from one pointing at a blind
      // spot, and every 'unknown' control looks alike.
      retryReason: s.options.retryReason,
      validated: s.options.validated,
    })),
  )}\n`,
)
