#!/usr/bin/env node
/**
 * Builds the no-retry pool for one repo, and cross-checks the rule against the resolver.
 *
 * The check matters more than the pool. A harness that decides which sites "fired" by evaluating
 * `retry === 'none' && IDEMPOTENT.has(method)` is asserting the rule's own defining predicate
 * against itself: it prints green on a completely broken build. So the fired set is taken from
 * `model.findings`, which is the output of the rules pipeline (src/rules/index.ts), and compared
 * against the set predicted from raw resolver output. The two reaching the same answer is real
 * evidence; either one alone is not.
 */
import { runAudit } from '../src/cli/audit.js'

const root = process.argv[2]
const label = process.argv[3] ?? root
if (!root) {
  process.stderr.write('usage: collect.ts <repo-root> [label]\n')
  process.exit(1)
}

// Mirrors src/rules/index.ts:47. `undefined` is in the set by design: a call whose method cannot
// be read at all defaults to GET. Reproduced here ONLY to predict, never to decide.
const IDEMPOTENT = new Set([undefined, 'get', 'head', 'options', 'put', 'delete'])

const { model, sites } = await runAudit({ root, json: true })

const byId = new Map(sites.map((s) => [s.id, s]))
const firedIds = new Set(
  model.findings.filter((f) => f.rule === 'no-retry').map((f) => f.callSiteId),
)
const predictedIds = new Set(
  sites.filter((s) => s.options.retry === 'none' && IDEMPOTENT.has(s.method)).map((s) => s.id),
)

const onlyFired = [...firedIds].filter((id) => !predictedIds.has(id))
const onlyPredicted = [...predictedIds].filter((id) => !firedIds.has(id))
const nonIdempotentFired = [...firedIds]
  .map((id) => byId.get(id))
  .filter((s) => s && !IDEMPOTENT.has(s.method))

const problems: string[] = []
if (onlyFired.length) problems.push(`${onlyFired.length} findings with no matching resolver site`)
if (onlyPredicted.length) problems.push(`${onlyPredicted.length} predicted sites that did not fire`)
if (nonIdempotentFired.length)
  problems.push(
    `${nonIdempotentFired.length} fired on a NON-IDEMPOTENT method: ` +
      nonIdempotentFired.map((s) => `${s?.file}:${s?.line} ${s?.method}`).join(', '),
  )

const reasons: Record<string, number> = {}
for (const s of sites) {
  const k = `${s.options.retry}/${s.options.retryReason ?? 'none-recorded'}`
  reasons[k] = (reasons[k] ?? 0) + 1
}

process.stdout.write(
  `${JSON.stringify(
    {
      repo: label,
      sites: sites.length,
      fired: firedIds.size,
      crossCheck: problems.length ? 'FAILED' : 'ok',
      problems,
      reasons,
      cases: sites.map((s) => ({
        id: s.id,
        fingerprint: s.fingerprint,
        repo: label,
        file: s.file,
        line: s.line,
        client: s.client,
        method: s.method,
        retry: s.options.retry,
        retryReason: s.options.retryReason,
        fired: firedIds.has(s.id),
      })),
    },
    null,
    1,
  )}\n`,
)
