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
      // Both http.request(options, cb) and http.get(options, cb) take their options at index 0.
      // Reading only `request` reported a valid `http.get({ timeout: 5000 })` as having none.
      // The (url, options, cb) overload puts them at index 1, so accept an object literal in
      // either position; pickConfigArg only treats an ObjectLiteralExpression as readable.
      return method === 'request' || method === 'get' ? 0 : undefined
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

// Counting loops only. `for...of` / `for...in` iterate a collection, so a `continue` inside one
// means "skip this item", never "try that request again"; including them would classify batch
// loops as retry.
const RETRY_LOOPS = [SyntaxKind.ForStatement, SyntaxKind.WhileStatement, SyntaxKind.DoStatement]

// Every loop kind, used to find which loop a `continue` or a call actually belongs to. Asking
// only about counting loops silently skips an enclosing `for...of`: a `continue` that skips a
// record in an inner `for (const row of data)` was attributed to the outer `while`, which read
// a textbook pagination loop as retry. Ownership must be decided against the NEAREST loop of
// any kind.
const ALL_LOOPS = [...RETRY_LOOPS, SyntaxKind.ForOfStatement, SyntaxKind.ForInStatement]

const nearestLoop = (n: Node): Node | undefined =>
  n.getAncestors().find((a: Node) => ALL_LOOPS.includes(a.getKind()))

/**
 * Whether this call sits in a hand-rolled retry loop, judged by three signals together:
 * the call is inside a counting loop, it is inside a `try`, and that `try` contains a
 * `continue` belonging to that same loop.
 *
 * The discriminator is the `continue` inside the `try`, because that is what separates retry
 * from pagination. Pagination advances on the SUCCESS path (`page++`, `hasMore = res.data.next`)
 * and needs no `continue`; when it does guard against failure it `break`s out rather than going
 * round again. A retry loop re-enters the loop precisely because the attempt failed.
 *
 * An earlier heuristic asked only "is there a loop ancestor" and was deleted: it read 23.7% of
 * one repo's call sites (pagination) as retry and silently suppressed every genuine finding.
 * This is narrower on purpose. Measured on a backend that hand-rolls retry in every provider,
 * it matched 45 of 45 real retry loops, and it matches neither shape of pagination.
 *
 * The verdict is 'unknown', never 'library': this proves only that absence of retry cannot be
 * shown here, so `no-retry` abstains rather than asserting a retry that may not exist.
 */
function isInManualRetryLoop(call: CallExpression): boolean {
  const ancestors = call.getAncestors()
  // The call's own nearest loop must be the counting loop. A call whose nearest loop is a
  // `for...of` is iterating a collection, so it is batch work rather than repeated attempts.
  const loop = nearestLoop(call)
  if (!loop || !RETRY_LOOPS.includes(loop.getKind())) return false
  const tryStmt = ancestors.find((a: Node) => a.getKind() === SyntaxKind.TryStatement)
  // The `try` must sit inside the loop, not wrap it: `try { while (...) {...} } catch {}` is
  // one attempt at a loop, not a loop of attempts.
  if (!tryStmt?.getAncestors().some((a: Node) => a === loop)) return false
  return tryStmt
    .getDescendantsOfKind(SyntaxKind.ContinueStatement)
    .some((c) => nearestLoop(c) === loop)
}

/**
 * Whether a `retry`/`retries` option explicitly DISABLES retry. got retries twice by default,
 * so a got call is trusted as retrying; but `got(url, { retry: { limit: 0 } })` turns that off
 * and the call then has no retry at all. Reading only the client kind reported those calls as
 * protected, which is a silent suppression.
 *
 * Only a literal 0 or `false` counts as disabled. A value that cannot be read statically is not
 * proof of anything, so it leaves the existing verdict alone.
 */
function retryExplicitlyDisabled(config: Node | undefined): boolean {
  if (!config) return false
  for (const name of ['retry', 'retries']) {
    const found = prop(config, name)
    if (!found || found.shorthand) continue
    const init = found.initializer
    if (init.getKind() === SyntaxKind.NumericLiteral && Number(init.getText()) === 0) return true
    if (init.getKind() === SyntaxKind.FalseKeyword) return true
    if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const inner = init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      for (const key of ['limit', 'retries', 'maxRetries', 'attempts']) {
        const ip = inner.getProperty(key)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()
        if (ip && ip.getKind() === SyntaxKind.NumericLiteral && Number(ip.getText()) === 0)
          return true
      }
    }
  }
  return false
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
      } else if (
        !t.shorthand &&
        (t.initializer.getKind() === SyntaxKind.NullKeyword ||
          t.initializer.getText() === 'undefined')
      ) {
        // `timeout: null` / `timeout: undefined` are falsy and set no timeout, exactly like 0.
        // Treating "the key is present" as protection suppressed no-timeout on calls that had
        // explicitly written the timeout away.
        timeoutMs = null
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
        // Only AbortSignal.timeout(n) proves a deadline. A bare `controller.signal` may only
        // ever be aborted by hand, or never, and whether a setTimeout is wired to it elsewhere
        // is not knowable here. Calling that 'instance-default' asserted a protection that may
        // not exist; 'unknown' says what is actually true. Both keep no-timeout silent, so this
        // changes the model's honesty rather than the findings.
        timeoutMs = m ? Number(m[1]) : 'unknown'
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
  // An explicit `retry: 0` / `retry: { limit: 0 }` overrides both the client-kind default and
  // the presence check above: the call was deliberately configured NOT to retry.
  if (retry === 'library' && retryExplicitlyDisabled(config)) retry = 'none'
  // A hand-rolled retry loop is not proof of retry, but it is proof that absence of retry
  // cannot be shown, so abstain instead of warning. See isInManualRetryLoop for why this is
  // narrower than the loop-ancestor heuristic that preceded it.
  if (retry === 'none' && isInManualRetryLoop(call)) retry = 'unknown'
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
