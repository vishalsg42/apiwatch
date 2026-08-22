import { type CallExpression, type Node, SyntaxKind } from 'ts-morph'
import type { CallOptions, ClientBinding } from '../model.js'

/**
 * Looks up an object literal's OWN top-level property by name, accepting both a regular
 * `PropertyAssignment` (`{ timeout: 5000 }`) and a `ShorthandPropertyAssignment`
 * (`{ timeout }`); never a source-text regex, and never descending into nested literals.
 * A shorthand has no initializer node to inspect (the property name IS the binding), so it is
 * reported distinctly from a regular assignment: callers that care about a concrete literal
 * value (e.g. a numeric timeout) can tell "present but not statically known" apart from
 * "absent", while callers that only care about presence (retry/retries) can treat either kind
 * the same way.
 */
type PropLookup = { shorthand: true } | { shorthand: false; initializer: Node }
const prop = (n: Node, name: string): PropLookup | undefined => {
  const p = n.asKind(SyntaxKind.ObjectLiteralExpression)?.getProperty(name)
  if (!p) return undefined
  if (p.getKind() === SyntaxKind.ShorthandPropertyAssignment) return { shorthand: true }
  const init = p.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()
  return init ? { shorthand: false, initializer: init } : undefined
}

/**
 * The call's own method name: a property-access call's property name, normalized
 * (`.del()` -> `delete`), or undefined for a bare call (`axios(...)`, `fetch(...)`,
 * `got(...)`, `request(...)`). `resolveOptions` isn't handed the method callsites.ts already
 * extracted (that signature is owned elsewhere), so it's recomputed here the same way.
 */
function methodOf(call: CallExpression): string | undefined {
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined
  const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
  return name === 'del' ? 'delete' : name
}

/**
 * The argument index that holds this call's options/config object, decided from the client
 * kind and method shape, NOT "the last object-literal argument". That rule is wrong for
 * `axios.post(url, data)` with no config: the request BODY is the last (and only) object
 * literal there, and reading options from it turns a domain field like `{ retry: true }` in
 * the body into a false 'library' verdict, or a body field named `timeout` into a false
 * suppression of no-timeout. Returns undefined for a shape that isn't a known request-options
 * convention, so the caller treats the call as having no statically-readable options rather
 * than guessing at one.
 */
function configArgIndex(
  kind: ClientBinding['kind'],
  method: string | undefined,
): number | undefined {
  switch (kind) {
    case 'axios':
    case 'nestjs-axios':
      if (method === undefined || method === 'request') return 0 // axios(config) / axios.request(config)
      if (method === 'get' || method === 'delete' || method === 'head') return 1
      if (method === 'post' || method === 'put' || method === 'patch') return 2
      return undefined
    case 'fetch':
    case 'node-fetch':
      return 1 // fetch(url, init): same shape for a bare call or a method-style call
    case 'got':
      return 1 // got(url, options) / got.get(url, options): options is always arg 1
    case 'request':
    case 'request-promise':
      // request(options, cb) puts the options object FIRST: there is no url argument in the
      // bare-call form. request.get(url, options, cb) is ordinary method-style usage of the
      // same client and puts options SECOND, after the url. Reading only the bare-call shape
      // meant every method-style call (`request.get(url, { timeout }, cb)`) read no options at
      // all and reported a false no-timeout on a correctly-protected call.
      return method === undefined ? 0 : 1
    case 'node:http':
      return method === 'request' ? 0 : undefined // http.request(options, cb)
    default:
      return undefined
  }
}

/**
 * The call's config argument, distinguishing "genuinely absent" from "present but not
 * statically readable". The two are NOT the same: `axios.get(url)` proves there is no
 * timeout/retry at all, while `axios(config)` with `config` an Identifier proves nothing either
 * way (the object built elsewhere might set one). Conflating them was the twilio-node bug:
 * `src/base/RequestClient.ts:73` passes a bare `axios(config)` where `config` is an identifier
 * that DOES set a timeout, and the old code returned "absent" for both cases, reporting a false
 * no-timeout error on correctly-protected code.
 */
type ConfigArg =
  | { kind: 'object'; node: Node } // an ObjectLiteralExpression at the expected index
  | { kind: 'unreadable' } // something else at the expected index: Identifier, spread, call, ...
  | { kind: 'absent' } // no argument at the expected index at all, or no expected index

function configArg(call: CallExpression, binding: ClientBinding): ConfigArg {
  const idx = configArgIndex(binding.kind, methodOf(call))
  if (idx === undefined) return { kind: 'absent' }
  const arg = call.getArguments()[idx]
  if (!arg) return { kind: 'absent' }
  return arg.getKind() === SyntaxKind.ObjectLiteralExpression
    ? { kind: 'object', node: arg }
    : { kind: 'unreadable' }
}

/** The call's single options/config object literal, or undefined if unreadable or absent. */
function configObj(call: CallExpression, binding: ClientBinding): Node | undefined {
  const arg = configArg(call, binding)
  return arg.kind === 'object' ? arg.node : undefined
}

/**
 * The call's HTTP method, read from a `method:` string literal in its resolved config object,
 * for the call shapes that carry the method THERE rather than as a property-access name:
 * `axios({ method: 'post', ... })`, `fetch(url, { method: 'POST' })`. Normalized to lowercase.
 * `callsites.ts` only ever populated `method` from a property-access call's own name, so a bare
 * call's config-object method was invisible to any rule that reads `CallSite.method`; the
 * idempotent-method skip in `no-retry` in particular treated an unreadable method as idempotent
 * by default, which incorrectly fired on a bare `axios({ method: 'post', ... })` call.
 */
export function configMethod(call: CallExpression, binding: ClientBinding): string | undefined {
  const config = configObj(call, binding)
  if (!config) return undefined
  const m = prop(config, 'method')
  if (!m || m.shorthand || m.initializer.getKind() !== SyntaxKind.StringLiteral) return undefined
  const raw = m.initializer.getText().slice(1, -1).toLowerCase()
  return raw === 'del' ? 'delete' : raw
}

export function resolveOptions(
  call: CallExpression,
  binding: ClientBinding,
): Pick<CallOptions, 'timeoutMs' | 'retry'> {
  const arg = configArg(call, binding)
  const config = arg.kind === 'object' ? arg.node : undefined

  // 'unknown' only when a config argument EXISTS but isn't statically readable. When there is
  // genuinely no config argument (arg.kind === 'absent'), timeoutMs/retry start at their
  // PROVEN-ABSENT values below, same as before this fix.
  let timeoutMs: CallOptions['timeoutMs'] = arg.kind === 'unreadable' ? 'unknown' : null
  if (config) {
    const t = prop(config, 'timeout')
    if (t) {
      if (!t.shorthand && t.initializer.getKind() === SyntaxKind.NumericLiteral) {
        const n = Number(t.initializer.getText())
        // axios (and others) document `timeout: 0` as "no timeout", its own default, so a
        // literal 0 must NOT suppress no-timeout; leave timeoutMs unset and let the
        // instance-default fallback below still apply.
        timeoutMs = n === 0 ? null : n
      } else {
        // `{ timeout }` shorthand, or a non-literal value (variable/expression): a timeout IS
        // configured but its value isn't statically known here.
        timeoutMs = 'instance-default'
      }
    } else {
      const sig = prop(config, 'signal')
      if (sig) {
        const m = !sig.shorthand
          ? /AbortSignal\.timeout\(\s*(\d+)\s*\)/.exec(sig.initializer.getText())
          : null
        timeoutMs = m ? Number(m[1]) : 'instance-default'
      }
    }
  }
  // binding.instanceTimeout still wins over a merely-absent timeout, unchanged from before this
  // fix. It does NOT override 'unknown': an unreadable config argument stays 'unknown' rather
  // than being upgraded to 'instance-default', which is fine either way since no-timeout only
  // fires on `null` and 'unknown' never triggers it.
  if (timeoutMs === null && binding.instanceTimeout) timeoutMs = 'instance-default'

  // Same absent-vs-unreadable split as timeoutMs above, except binding.kind === 'got' and
  // binding.instanceRetry still win unconditionally, exactly as before this fix: a resolved
  // client-level guarantee is trusted even when THIS call's own config can't be read.
  let retry: CallOptions['retry'] =
    binding.kind === 'got' || binding.instanceRetry
      ? 'library'
      : arg.kind === 'unreadable'
        ? 'unknown'
        : 'none'
  if (retry === 'none' && config && (prop(config, 'retry') || prop(config, 'retries')))
    retry = 'library'
  // A `for`/`while` ancestor was previously treated as a hand-rolled retry loop and mapped
  // to 'manual'. Measured against a real repo, this was wrong: a `while (hasMore) { try {
  // ... } catch {} }` pagination loop is structurally identical to a retry loop, and 23.7%
  // of that repo's call sites were pagination, not retry; every one of them silently
  // suppressed a genuine no-retry finding. There is no cheap static discriminator between
  // the two shapes, and "silence beats a wrong finding" cuts the other way here: a false
  // suppression is invisible, while an occasional false 'no-retry' warn on a real hand-rolled
  // retry loop is mild and visible. So this heuristic is gone; retry is only 'none' or
  // 'library' now.
  //
  // The same reasoning killed a second heuristic: "the file imports a retry library ANYWHERE"
  // used to force EVERY call in that file to 'library', even a bare call nowhere near the
  // wrapper (`import pRetry from 'p-retry'` with one call actually wrapped in `pRetry(...)` and
  // one call that plainly isn't, neither got flagged). That's a file-wide false suppression,
  // the same shape as the pagination bug above. There is no cheap way to prove a specific call
  // is "actually enclosed by" an arbitrary higher-order retry wrapper without knowing that
  // wrapper's calling convention, so this only trusts what it can see at the call site itself
  // (the `retry`/`retries` option) or on the resolved client binding (`instanceRetry`,
  // `got`'s built-in retry).
  return { timeoutMs, retry }
}
