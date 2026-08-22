import type { CallSite, Finding, Workspace } from '../model.js'
export type Rule = {
  name: string
  severity: 'error' | 'warn'
  check(sites: CallSite[], ws: Workspace): Finding[]
}
const F = (
  rule: string,
  severity: 'error' | 'warn',
  s: CallSite,
  message: string,
  evidence: string,
): Finding => ({ rule, severity, callSiteId: s.id, file: s.file, line: s.line, message, evidence })

const IDEMPOTENT = new Set(['get', 'head', 'options', 'put', 'delete', undefined])

export const noTimeout: Rule = {
  name: 'no-timeout',
  severity: 'error',
  check: (s) =>
    s
      .filter((x) => x.options.timeoutMs === null)
      .map((x) =>
        F(
          'no-timeout',
          'error',
          x,
          `${x.client} call has no timeout and can hang indefinitely`,
          `${x.client}${x.method ? `.${x.method}` : ''}() with no timeout or signal`,
        ),
      ),
}

export const noRetry: Rule = {
  name: 'no-retry',
  severity: 'warn',
  check: (s) =>
    s
      .filter((x) => x.options.retry === 'none' && x.client !== 'got' && IDEMPOTENT.has(x.method))
      .map((x) =>
        F(
          'no-retry',
          'warn',
          x,
          'no retry or backoff — one transient failure becomes an error',
          `${x.client} ${x.method ?? 'request'} with retry: none`,
        ),
      ),
}

export const unvalidatedResponse: Rule = {
  name: 'unvalidated-response',
  severity: 'warn',
  check: (s) =>
    s
      .filter((x) => x.options.validated === false)
      .map((x) =>
        F(
          'unvalidated-response',
          'warn',
          x,
          'response is consumed without schema validation',
          'no zod/Joi/yup/ajv/class-validator call reached this response',
        ),
      ),
}

export const deprecatedClient: Rule = {
  name: 'deprecated-client',
  severity: 'warn',
  check: (s, ws) => {
    const nfMajor = Number(
      (ws.dependencies['node-fetch'] ?? '').replace(/[^\d.]/g, '').split('.')[0] || '0',
    )
    const seen = new Set<string>()
    const out: Finding[] = []
    for (const x of s) {
      const bad = x.client === 'request' || (x.client === 'node-fetch' && nfMajor === 2)
      if (!bad || seen.has(x.file)) continue
      seen.add(x.file)
      out.push(
        F(
          'deprecated-client',
          'warn',
          x,
          x.client === 'request'
            ? '`request` is unmaintained since 2020'
            : '`node-fetch@2` is superseded by native fetch',
          `file imports ${x.client}`,
        ),
      )
    }
    return out
  },
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/
export const hardcodedHost: Rule = {
  name: 'hardcoded-host',
  severity: 'warn',
  check: (s) =>
    s
      .filter((x) => x.url.kind === 'literal' && !LOOPBACK.test(x.url.host))
      .map((x) =>
        F(
          'hardcoded-host',
          'warn',
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
  hardcodedHost,
]

export function runRules(sites: CallSite[], ws: Workspace): Finding[] {
  return rules
    .flatMap((r) => r.check(sites, ws))
    .sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    )
}
