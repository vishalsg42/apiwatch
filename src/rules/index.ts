import { createHash } from 'node:crypto'
import type { CallSite, Finding, Workspace } from '../model.js'
import { FP_VERSION } from '../static/callsites.js'
export type Rule = {
  name: string
  severity: 'error' | 'warn' | 'info'
  check(sites: CallSite[], ws: Workspace): Finding[]
}
const F = (
  rule: string,
  severity: 'error' | 'warn' | 'info',
  s: CallSite,
  message: string,
  evidence: string,
  /**
   * File-level rules pass their own identity. `deprecatedClient` and `legacyClient` emit ONE
   * finding per file and anchor it to whichever matching call site happened to come first, so
   * borrowing that call's fingerprint makes the finding re-key whenever calls are reordered.
   * Their identity is the file, not a call.
   */
  fingerprint = s.fingerprint,
): Finding => ({
  rule,
  severity,
  fingerprint,
  callSiteId: s.id,
  file: s.file,
  line: s.line,
  message,
  evidence,
})

/** Stable identity for a rule that fires once per file rather than once per call. */
const fileFingerprint = (rule: string, file: string): string =>
  createHash('sha256')
    .update(JSON.stringify([FP_VERSION, 'file-level', rule, file]))
    .digest('hex')
    .slice(0, 24)

// `undefined` covers a call whose method truly can't be read at all (e.g. a bare `fetch(url)`
// with no config object); those default to HTTP GET, which is idempotent, so treating unknown
// as idempotent-eligible here is intentional, not a fallback of convenience. It must NOT be
// used to paper over a method apiwatch simply forgot to read: `CallSite.method` is now also
// populated from a bare call's config object (`axios({ method: 'post', ... })`), so a call that
// explicitly specifies a non-idempotent method is no longer indistinguishable from one with no
// method at all.
const IDEMPOTENT = new Set(['get', 'head', 'options', 'put', 'delete', undefined])

export const noTimeout: Rule = {
  name: 'no-timeout',
  severity: 'error',
  check: (s) =>
    s
      // Fires ONLY on a proven-absent timeout (timeoutMs === null), never on 'unknown'. A
      // config argument that exists but isn't statically readable (an Identifier, a spread, a
      // call expression, ...) used to be conflated with "no config at all" and reported here;
      // reproduced on twilio-node's `axios(config)` (src/base/RequestClient.ts:73), where
      // `config` is an identifier that DOES set a timeout. Same contract as unvalidated-response
      // staying silent on 'unknown'.
      .filter((x) => x.options.timeoutMs === null)
      .map((x) =>
        F(
          'no-timeout',
          'error',
          x,
          // Deliberately "no deadline", not "hangs forever". Measured on Node 24: a native
          // fetch against a server that accepts and never responds rejects after 301.3s with
          // UND_ERR_HEADERS_TIMEOUT, because undici applies a ~300s header timeout. axios has
          // no application timeout at all (its default is 0), so the fallback there is whatever
          // the socket and the vendor do. Either way the call outlives any request a user is
          // waiting on, which is the real defect; claiming it hangs forever is not true for
          // fetch and would be the first thing a reader disproves.
          `${x.client} call sets no timeout, so it has no deadline of its own`,
          `${x.client}${x.method ? `.${x.method}` : ''}() with no timeout or signal`,
        ),
      ),
}

export const noRetry: Rule = {
  name: 'no-retry',
  severity: 'warn',
  check: (s) =>
    s
      // No separate `x.client !== 'got'` check: resolveOptions already forces retry:'library'
      // for every got call site, so options.retry === 'none' can never be true for got; the
      // extra client check was unreachable dead code, not a second line of defense.
      //
      // Fires ONLY on a proven-absent retry (retry === 'none'), never on 'unknown', for the
      // same reason no-timeout stays silent on 'unknown' above: the twilio-node call site sits
      // inside a jitter-backoff retry function, but its config argument is an unreadable
      // identifier, so 'none' would be a false positive there too.
      .filter((x) => x.options.retry === 'none' && IDEMPOTENT.has(x.method))
      .map((x) =>
        F(
          'no-retry',
          'warn',
          x,
          // A review prompt, not a verdict. Failing fast is frequently the RIGHT call: retrying
          // can amplify a vendor outage, a latency-sensitive path may prefer to give up, an
          // internal service may rely on platform-level retries, and PUT/DELETE are idempotent
          // by spec but not always by implementation. apiwatch can see that no retry policy is
          // configured; it cannot see whether that was a decision.
          'no retry policy detected: confirm that failing fast is intentional here',
          `${x.client} ${x.method ?? 'request'} with retry: none`,
        ),
      ),
}

/**
 * 'info' on purpose, and it should stay there until the analysis actually follows the response
 * value. Today this asks whether a validator-shaped call exists anywhere in the enclosing
 * function, not whether THIS response reached it, so:
 *
 * - a validator call for unrelated data suppresses the finding;
 * - several responses in one function all read as validated when only one is;
 * - a streamed file, a text body, or a status-only request is reported for lacking a schema.
 *
 * That is too loose to gate a build on. It stays visible because the underlying gap is real,
 * but it cannot fail CI until it can name the value it followed.
 */
export const unvalidatedResponse: Rule = {
  name: 'unvalidated-response',
  severity: 'info',
  check: (s) =>
    s
      .filter((x) => x.options.validated === false)
      .map((x) =>
        F(
          'unvalidated-response',
          'info',
          x,
          'no schema validation seen for this response',
          'no zod/Joi/yup/ajv/class-validator call reached this response',
        ),
      ),
}

export const deprecatedClient: Rule = {
  name: 'deprecated-client',
  severity: 'warn',
  check: (s) => {
    const seen = new Set<string>()
    const out: Finding[] = []
    for (const x of s) {
      // request-promise is a thin promise wrapper AROUND `request`, deprecated alongside its
      // dependency, not just similar to it. The README's own example output shows a
      // request-promise call site, so this rule missing it entirely was a real, visible gap.
      // Only the request family. `request` was formally deprecated by its maintainers in
      // February 2020; node-fetch@2 never was, it is merely superseded, so conflating the two
      // put migration advice at the same severity as using an abandoned package. node-fetch@2
      // moved to `legacy-client` at info severity.
      const isRequestFamily = x.client === 'request' || x.client === 'request-promise'
      if (!isRequestFamily || seen.has(x.file)) continue
      seen.add(x.file)
      out.push(
        F(
          'deprecated-client',
          'warn',
          x,
          `\`${x.client}\` is unmaintained since 2020`,
          `file imports ${x.client}`,
          fileFingerprint('deprecated-client', x.file),
        ),
      )
    }
    return out
  },
}

/**
 * node-fetch@2 is not deprecated, it is superseded: modern Node has a global `fetch`, so the
 * dependency is usually removable. That is migration advice, not a defect, so it is 'info' and
 * never fails CI.
 */
export const legacyClient: Rule = {
  name: 'legacy-client',
  severity: 'info',
  check: (s, ws) => {
    const nfMajor = Number(
      (ws.dependencies['node-fetch'] ?? '').replace(/[^\d.]/g, '').split('.')[0] || '0',
    )
    if (nfMajor !== 2) return []
    const seen = new Set<string>()
    const out: Finding[] = []
    for (const x of s) {
      if (x.client !== 'node-fetch' || seen.has(x.file)) continue
      seen.add(x.file)
      out.push(
        F(
          'legacy-client',
          'info',
          x,
          '`node-fetch@2` is superseded by the global fetch in Node >= 18',
          `file imports ${x.client}`,
          fileFingerprint('legacy-client', x.file),
        ),
      )
    }
    return out
  },
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/
/**
 * A literal vendor host is very often deliberate (`https://api.github.com/...`), so this is not
 * a reliability defect on its own. It is 'info': visible, but it never fails CI and never
 * dilutes the rules that do.
 */
export const hardcodedHost: Rule = {
  name: 'hardcoded-host',
  severity: 'info',
  check: (s) =>
    s
      .filter((x) => x.url.kind === 'literal' && !LOOPBACK.test(x.url.host))
      .map((x) =>
        F(
          'hardcoded-host',
          'info',
          x,
          `host \`${(x.url as { host: string }).host}\` is hardcoded in source`,
          (x.url as { url: string }).url,
        ),
      ),
}

export const rules: Rule[] = [
  noTimeout,
  noRetry,
  unvalidatedResponse,
  deprecatedClient,
  legacyClient,
  hardcodedHost,
]

// An explicit rank, not a nested ternary. The previous comparator was written for two
// severities and returned 1 for BOTH compare(warn, info) and compare(info, warn) once 'info'
// existed, so it was not antisymmetric and the file/line tiebreak was never reached across
// those two. Findings are emitted in `rules` array order and unvalidatedResponse (info) is
// registered before deprecatedClient (warn), so real reports printed info above warn.
const SEVERITY_RANK: Record<Finding['severity'], number> = { error: 0, warn: 1, info: 2 }

// Code-unit comparison, deliberately not localeCompare: file order must not depend on the
// machine's locale, since a baseline file is generated on a laptop and checked in CI.
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function runRules(sites: CallSite[], ws: Workspace): Finding[] {
  return rules
    .flatMap((r) => r.check(sites, ws))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        byCodeUnit(a.file, b.file) ||
        a.line - b.line,
    )
}
