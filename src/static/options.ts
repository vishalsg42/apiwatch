import { type CallExpression, type Node, SyntaxKind } from 'ts-morph'
import type { CallOptions, ClientBinding, ClientKind } from '../model.js'

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
/**
 * Does this config object literal contain a spread (`{ ...defaults }`)?
 *
 * `prop` reads OWN top-level properties only, so it cannot see through a spread. Treating such
 * an object as fully readable let apiwatch PROVE a timeout absent when the spread may well
 * supply one, which is an error-severity false positive on ordinary code. Verified against the
 * built 0.3.4: `axios.get(url, { ...cfg })` fired no-timeout while `axios.get(url, cfg)`
 * correctly abstained, and that asymmetry is what marks it as an oversight rather than a policy.
 *
 * The rule this enables: a spread makes ABSENCE and DISABLEMENT unprovable. An explicitly
 * present property is still read, in any position, because reading it only ever leads to
 * silence or a concrete value, never to a finding.
 */
/**
 * The object literals a spread's operand can contribute, or undefined when that is not
 * statically knowable.
 *
 * `...(body && { data })` can only ever add `data`, so it hides nothing and absence of a
 * `timeout` remains provable. Treating every spread as opaque cost a genuine error-severity
 * finding on real code (`axios({ method, url, headers, ...(body && { data }), responseType })`,
 * which really does set no timeout), so narrow the rule to spreads whose keys cannot be seen.
 */
const spreadOperandLiterals = (n: Node): Node[] | undefined => {
  const k = n.getKind()
  if (k === SyntaxKind.ObjectLiteralExpression) return [n]
  if (k === SyntaxKind.ParenthesizedExpression) {
    const inner = n.asKind(SyntaxKind.ParenthesizedExpression)?.getExpression()
    return inner ? spreadOperandLiterals(inner) : undefined
  }
  if (k === SyntaxKind.ConditionalExpression) {
    const c = n.asKindOrThrow(SyntaxKind.ConditionalExpression)
    const a = spreadOperandLiterals(c.getWhenTrue())
    const b = spreadOperandLiterals(c.getWhenFalse())
    return a && b ? [...a, ...b] : undefined
  }
  if (k === SyntaxKind.BinaryExpression) {
    const b = n.asKindOrThrow(SyntaxKind.BinaryExpression)
    const op = b.getOperatorToken().getKind()
    // `cond && { … }` contributes the right side or nothing; spreading a falsy value adds no
    // keys. `a || { … }` can contribute either side, so both must be readable.
    if (op === SyntaxKind.AmpersandAmpersandToken) return spreadOperandLiterals(b.getRight())
    if (op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) {
      const l = spreadOperandLiterals(b.getLeft())
      const r = spreadOperandLiterals(b.getRight())
      return l && r ? [...l, ...r] : undefined
    }
  }
  return undefined
}

/**
 * Splits a config object into "the extra literals its spreads can contribute" and "is any spread
 * opaque". An opaque spread makes ABSENCE and DISABLEMENT unprovable, because `prop` reads own
 * top-level properties only and cannot see what `{ ...defaults }` carries.
 *
 * Verified against the built 0.3.4: `axios.get(url, { ...cfg })` fired no-timeout at error
 * severity while `axios.get(url, cfg)` correctly abstained. That asymmetry marks it as an
 * oversight rather than a policy.
 */
const analyseSpreads = (n: Node): ConfigShape => {
  const props = n.asKind(SyntaxKind.ObjectLiteralExpression)?.getProperties() ?? []
  const extra: Node[] = []
  const valueUnreadable = new Set<string>()
  for (const x of props) {
    switch (x.getKind()) {
      // A plain `a: 1` or a shorthand `{ a }`. Readable, PROVIDED its key can be named: a
      // computed key cannot, and falls through to opaque below.
      case SyntaxKind.PropertyAssignment:
      case SyntaxKind.ShorthandPropertyAssignment:
        if (keyOfProp(x) === undefined) return OPAQUE
        break
      case SyntaxKind.SpreadAssignment: {
        const operand = x.asKind(SyntaxKind.SpreadAssignment)?.getExpression()
        const lits = operand ? spreadOperandLiterals(operand) : undefined
        if (!lits) return OPAQUE
        extra.push(...lits)
        break
      }
      // `{ get timeout() { … } }`, `{ timeout() { … } }`. The KEY is present, so absence is
      // disproved, but the value is behind a function body and cannot be read. Recorded by name
      // rather than making the whole object opaque, so an unrelated `toString()` costs nothing.
      case SyntaxKind.GetAccessor:
      case SyntaxKind.SetAccessor:
      case SyntaxKind.MethodDeclaration: {
        const k = keyOfProp(x)
        if (k === undefined) return OPAQUE
        valueUnreadable.add(k)
        break
      }
      // No default that shrugs. Any property kind this switch does not name could contribute any
      // key, so it makes the object opaque and every absence unprovable. That is what turns a
      // future syntax gap into silence instead of an error-severity false positive.
      default:
        return OPAQUE
    }
  }
  return { opaque: false, extra, valueUnreadable }
}

/**
 * What a config object literal can and cannot tell us.
 *
 * `opaque` means some property could contribute ANY key, so no absence is provable and every
 * lookup must abstain. `extra` are literals a readable spread contributes, looked up as though
 * written inline. `valueUnreadable` names keys that ARE present but whose value sits behind a
 * function body.
 */
type ConfigShape = { opaque: boolean; extra: Node[]; valueUnreadable: Set<string> }
const OPAQUE: ConfigShape = { opaque: true, extra: [], valueUnreadable: new Set() }

type PropLookup = { shorthand: true } | { shorthand: false; initializer: Node }

/**
 * A property's key with any quotes removed. `{ "timeout": 5000 }` and `{ timeout: 5000 }` are the
 * same object, and quoting is mandatory for a key that is not a valid identifier, such as
 * axios-retry's `'axios-retry'`.
 *
 * ts-morph's getProperty(name) matches the RAW name text, so it missed every quoted key and read
 * the value as proven absent. Since no-timeout is the only rule at `error`, that failed builds on
 * correctly-protected code. See issue #13.
 */
const keyOfProp = (p: Node): string | undefined => {
  // Every named member kind, not just assignments: a method or accessor names a key too, and
  // treating its name as unreadable made an unrelated `toString()` turn the whole object opaque.
  const named =
    p.asKind(SyntaxKind.PropertyAssignment) ??
    p.asKind(SyntaxKind.ShorthandPropertyAssignment) ??
    p.asKind(SyntaxKind.MethodDeclaration) ??
    p.asKind(SyntaxKind.GetAccessor) ??
    p.asKind(SyntaxKind.SetAccessor)
  const node = named?.getNameNode()
  if (!node) return undefined
  const k = node.getKind()
  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral)
    return node.asKindOrThrow(k).getLiteralText()
  // A computed key (`{ [k]: v }`) is not statically a name, so it matches nothing by design.
  if (k === SyntaxKind.ComputedPropertyName) return undefined
  return node.getText()
}

const prop = (n: Node, name: string): PropLookup | undefined => {
  const p = n
    .asKind(SyntaxKind.ObjectLiteralExpression)
    ?.getProperties()
    .find((x) => keyOfProp(x) === name)
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
    // 'request', 'request-promise' and 'node:http' are deliberately absent: their overloads are
    // ambiguous and are resolved by SHAPE_PROBED below, not by a guessed index.
    default:
      return undefined
  }
}

/**
 * The clients whose options argument cannot be located by index.
 *
 * `request(options, cb)` and `http.request(options, cb)` put options FIRST; `request.get(url,
 * options, cb)` and `http.request(url, options, cb)` put them SECOND. Choosing between those
 * from `kind x method` was wrong in both directions, verified against the built 0.3.4:
 * `rp.get({ uri, timeout: 5000 })` picked index 1, found nothing, and reported a false
 * no-timeout at error severity; `https.get(url, cb)` picked index 0, found the url string, and
 * abstained on a call that genuinely has no timeout. Their shapes are distinguishable by
 * looking at the arguments, so look.
 */
const SHAPE_PROBED = new Set<ClientBinding['kind']>(['request', 'request-promise', 'node:http'])

/** A url positional argument. Never the options object. */
const isUrlArg = (n: Node): boolean => {
  const k = n.getKind()
  return (
    k === SyntaxKind.StringLiteral ||
    k === SyntaxKind.NoSubstitutionTemplateLiteral ||
    // A TemplateExpression too: `\`${base}/users\`` is just as much a url as a plain literal,
    // and omitting it would leave every interpolated url looking like an unreadable config.
    k === SyntaxKind.TemplateExpression
  )
}

/**
 * A callback positional argument. Never the options object.
 *
 * Load-bearing, not tidiness: `https.get(url, () => {})` is THE canonical node:http shape. Left
 * unclassified, the callback at index 1 reads as an unreadable config and the call stays silent,
 * so the headline false negative would survive a fix that looked like it addressed it.
 */
export const isCallbackArg = (n: Node): boolean => {
  const k = n.getKind()
  return k === SyntaxKind.ArrowFunction || k === SyntaxKind.FunctionExpression
}

/** Resolve the options argument of an ambiguous-overload client by argument shape. */
function probeConfigArg(call: CallExpression): ConfigArg {
  let sawUnclassifiable = false
  // Only the first two positions: a third argument is the callback in every supported overload.
  for (const a of call.getArguments().slice(0, 2)) {
    if (isUrlArg(a) || isCallbackArg(a)) continue
    if (a.getKind() === SyntaxKind.ObjectLiteralExpression) return { kind: 'object', node: a }
    // Do NOT return here. `http.request(new URL(u), { timeout: 5000 }, cb)` has an
    // unclassifiable argument at index 0 and a perfectly readable config at index 1; giving up
    // on first sight of one would lose it.
    sawUnclassifiable = true
  }
  return sawUnclassifiable ? { kind: 'unreadable' } : { kind: 'absent' }
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

/**
 * axios's own two-overload shapes, which are ambiguous for exactly the reason the request family
 * is: `axios(config)` and `axios.request(config)` put options first, while `axios(url, config)`
 * and `axios.request(url, config)` put them second. Both are documented axios API. A fixed index
 * of 0 read `axios.request(url, { timeout: 5000 })` as unreadable and reported the call as
 * having no statically known timeout, on a call that plainly sets one.
 *
 * Only these two. The verb methods stay on exact indices, because an object literal at a fixed
 * index there can be a request BODY (`axios.post(url, data)`), and probing by shape would read
 * a domain field named `timeout` or `retry` out of the body.
 */
const axiosShapeProbed = (m: string | undefined) => m === undefined || m === 'request'

function configArg(call: CallExpression, binding: ClientBinding): ConfigArg {
  if (SHAPE_PROBED.has(binding.kind)) return probeConfigArg(call)
  const method = methodOf(call)
  if ((binding.kind === 'axios' || binding.kind === 'nestjs-axios') && axiosShapeProbed(method))
    return probeConfigArg(call)
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
  if (!m || m.shorthand) return undefined
  // Backticks too. `method: `post`` is a NoSubstitutionTemplateLiteral, and reading only
  // StringLiteral dropped the verb, which is worse than it sounds: a call with no method is
  // treated as idempotent by design (see IDEMPOTENT), so no-retry fired on a POST written with
  // backticks and stayed silent on the identical POST written with quotes.
  const k = m.initializer.getKind()
  if (k !== SyntaxKind.StringLiteral && k !== SyntaxKind.NoSubstitutionTemplateLiteral)
    return undefined
  // getLiteralText rather than slicing the source text: it is the same for these two kinds and
  // it does not depend on the quote characters being one byte each.
  const raw = m.initializer.asKindOrThrow(k).getLiteralText().toLowerCase()
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
 * What each client actually implements, per config key. A key only proves anything if the client
 * it is handed to reads it; otherwise it is inert, and treating it as proof silently suppresses a
 * real finding.
 *
 * `retry`/`retries` used to count for every client. Only got has such an option:
 * `AxiosRequestConfig` declares no `retry` key and neither does `RequestInit`, so
 * `axios.get(url, { retry: 3 })` is inert, the call is never re-attempted, and reading it as
 * proof silently suppressed a real finding. Found by a blind judge qualification set, where two
 * reviewers asked only "does anything re-attempt this" both said no and were right. See #5.
 *
 * `timeout` and `signal` were then found to have the same defect, by the conformance check that
 * #5 prompted: `test/option-conformance.test.ts` reads the shipped type declarations of every
 * client in this table and asserts each entry against them. That is what turned "only #5 was
 * wrong" into the three corrections below, and it is why this table is data rather than a
 * condition written inline at each lookup.
 *
 * `axios-retry` is the literal per-request key axios-retry reads
 * (`{ 'axios-retry': { retries: 3 } }`), and it exists on `AxiosRequestConfig` only once
 * axios-retry is imported, which is exactly when it does anything. Instance-level
 * `axiosRetry(instance, ...)` is a different path, already handled by `binding.instanceRetry`.
 *
 * An empty `retry` list means no request-level option can prove retry for that client. It does
 * not mean such calls never retry: a wrapper or an interceptor still can, which is why the
 * verdict there is a reported finding rather than a claim of certainty.
 */
export type ClientOptionSupport = {
  /** A numeric/`AbortSignal.timeout` deadline can be read off this call's own `timeout` key. */
  timeout: boolean
  /** `signal: AbortSignal.timeout(n)` is honoured by this client. */
  signal: boolean
  /** Keys whose presence proves this call re-attempts on failure. */
  retry: readonly string[]
}

export const CLIENT_OPTIONS: Record<ClientKind, ClientOptionSupport> = {
  // got v11+ uses `retry: { limit }`; got v9 used `retries`. Both are genuine, and `retries` is
  // kept although it is absent from got's current types, because dropping it would fire no-retry
  // on a v9 call that really does retry. The conformance check pins that divergence.
  got: { timeout: true, signal: true, retry: ['retry', 'retries'] },
  axios: { timeout: true, signal: true, retry: ['axios-retry'] },
  'nestjs-axios': { timeout: true, signal: true, retry: ['axios-retry'] },
  // The standard fetch has never had a `timeout`: `RequestInit` carries fourteen keys and that is
  // not one of them, so `fetch(url, { timeout: 5000 })` sets no deadline at all. apiwatch read it
  // as 5000ms and stayed silent on a call with no deadline, which is the #5 defect exactly.
  fetch: { timeout: false, signal: true, retry: [] },
  // node-fetch is the one ambiguous row. v2 implements `timeout`; v3 removed it. Which major is
  // installed is a workspace fact and this function has no workspace, so the choice is between a
  // silent suppression on v3 and an error-severity false positive on v2. This project ranks the
  // false positive worse, so `timeout` stays true. `legacy-client` already reports v2 at info.
  'node-fetch': { timeout: true, signal: true, retry: [] },
  // `request` predates AbortSignal and never gained it: `CoreOptions` has `timeout` and no
  // `signal`, so a signal passed here aborts nothing.
  request: { timeout: true, signal: false, retry: [] },
  'request-promise': { timeout: true, signal: false, retry: [] },
  'node:http': { timeout: true, signal: true, retry: [] },
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
function retryExplicitlyDisabled(config: Node | undefined, names: readonly string[]): boolean {
  if (!config) return false
  for (const name of names) {
    const found = prop(config, name)
    if (!found || found.shorthand) continue
    const init = found.initializer
    if (init.getKind() === SyntaxKind.NumericLiteral && Number(init.getText()) === 0) return true
    if (init.getKind() === SyntaxKind.FalseKeyword) return true
    if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const inner = init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      for (const key of ['limit', 'retries', 'maxRetries', 'attempts']) {
        const ip = inner
          .getProperties()
          .find((x) => keyOfProp(x) === key)
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializer()
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
): Pick<CallOptions, 'timeoutMs' | 'retry' | 'retryReason'> {
  const arg = configArg(call, binding)
  const config = arg.kind === 'object' ? arg.node : undefined
  // What this client actually implements. A key it does not read proves nothing, so an inert
  // one must not be looked up at all. See CLIENT_OPTIONS.
  const support = CLIENT_OPTIONS[binding.kind]
  // A readable object that nonetheless hides keys behind a spread. Absence and disablement
  // become unprovable; explicit properties are still read. See hasSpread.
  // `extra` are object literals a readable spread can contribute; look them up as though they
  // were written inline. `opaque` means at least one spread hides its keys entirely.
  const { opaque, extra, valueUnreadable } = config
    ? analyseSpreads(config)
    : { opaque: false, extra: [], valueUnreadable: new Set<string>() }
  // A key defined by a getter or method IS present, so absence is disproved, but its value is
  // behind a function body. Reported as a shorthand, which is already the "present, value not
  // statically known" signal every caller understands.
  const lookup = (name: string): PropLookup | undefined => {
    if (!config) return undefined
    const own = prop(config, name)
    if (own) return own
    for (const e of extra) {
      const found = prop(e, name)
      if (found) return found
    }
    return valueUnreadable.has(name) ? { shorthand: true } : undefined
  }

  // 'unknown' only when a config argument EXISTS but isn't statically readable. When there is
  // genuinely no config argument (arg.kind === 'absent'), timeoutMs/retry start at their
  // PROVEN-ABSENT values below, same as before this fix.
  let timeoutMs: CallOptions['timeoutMs'] = arg.kind === 'unreadable' ? 'unknown' : null
  if (config) {
    const t = support.timeout ? lookup('timeout') : undefined
    if (t) {
      if (!t.shorthand && t.initializer.getKind() === SyntaxKind.NumericLiteral) {
        const n = Number(t.initializer.getText())
        // axios (and others) document `timeout: 0` as "no timeout", its own default, so a
        // literal 0 must NOT suppress no-timeout; leave timeoutMs unset and let the
        // instance-default fallback below still apply.
        timeoutMs = n === 0 ? (opaque ? 'unknown' : null) : n
      } else if (
        !t.shorthand &&
        (t.initializer.getKind() === SyntaxKind.NullKeyword ||
          t.initializer.getText() === 'undefined')
      ) {
        // `timeout: null` / `timeout: undefined` are falsy and set no timeout, exactly like 0.
        // Treating "the key is present" as protection suppressed no-timeout on calls that had
        // explicitly written the timeout away. A spread still blocks the absence conclusion.
        timeoutMs = opaque ? 'unknown' : null
      } else {
        // `{ timeout }` shorthand, or a non-literal value (variable/expression): a timeout IS
        // configured but its value isn't statically known here.
        timeoutMs = 'instance-default'
      }
    }
  }

  // Checked whenever no deadline has been established yet, INCLUDING after a falsy timeout.
  // `{ timeout: 0, signal: AbortSignal.timeout(5000) }` is a real pattern: switch off the
  // client's own timeout and let the signal govern. The signal used to be read only in the
  // branch taken when no `timeout` key existed at all, so a falsy one shadowed it, the call
  // resolved to null (PROVEN ABSENT) and fired no-timeout at error severity on protected code.
  // `timeout: 0` with no signal still resolves to null, because that genuinely is no deadline.
  if (config && timeoutMs === null) {
    const sig = support.signal ? lookup('signal') : undefined
    if (sig) {
      const m = !sig.shorthand
        ? // [\d_] not \d: JavaScript numeric separators are legal and common in timeout
          // literals. `AbortSignal.timeout(10_000)` read as 'unknown' rather than 10000,
          // found in Ghost by a precision audit. Precision-safe (it abstained rather than
          // firing) but the reported model was wrong about a protected call.
          /AbortSignal\.timeout\(\s*([\d_]+)\s*\)/.exec(sig.initializer.getText())
        : null
      // Only AbortSignal.timeout(n) proves a deadline. A bare `controller.signal` may only
      // ever be aborted by hand, or never, and whether a setTimeout is wired to it elsewhere
      // is not knowable here. Calling that 'instance-default' asserted a protection that may
      // not exist; 'unknown' says what is actually true. Both keep no-timeout silent, so this
      // changes the model's honesty rather than the findings.
      timeoutMs = m ? Number(m[1].replace(/_/g, '')) : 'unknown'
    } else if (opaque) {
      // No readable `timeout` and no `signal` of its own, but a spread may carry either, so
      // absence stays unprovable. Restoring this after it was lost in a refactor: without it a
      // spread-bearing config reported a PROVEN-absent timeout, which is an error-severity false
      // positive and the exact defect the spread rule exists to prevent.
      timeoutMs = 'unknown'
    }
  }

  // binding.instanceTimeout still wins over a merely-absent timeout. It does NOT override
  // 'unknown': an unreadable config argument stays 'unknown' rather than being upgraded to
  // 'instance-default', which is fine either way since no-timeout only fires on `null`.
  if (timeoutMs === null && binding.instanceTimeout) timeoutMs = 'instance-default'

  // Same absent-vs-unreadable split as timeoutMs above, except binding.kind === 'got' and
  // binding.instanceRetry still win unconditionally, exactly as before this fix: a resolved
  // client-level guarantee is trusted even when THIS call's own config can't be read.
  // retryReason tracks WHY, alongside every assignment to retry rather than reconstructed after
  // the fact, so the two can never disagree. It is diagnostic: no rule reads it. See CallOptions.
  let retry: CallOptions['retry'] =
    binding.kind === 'got' || binding.instanceRetry
      ? 'library'
      : arg.kind === 'unreadable'
        ? 'unknown'
        : 'none'
  let retryReason: CallOptions['retryReason'] =
    binding.kind === 'got' || binding.instanceRetry
      ? 'client-default'
      : arg.kind === 'unreadable'
        ? 'unreadable'
        : 'absent'
  const retryNames = support.retry
  // An explicit, readable key wins over a client default: `got(url, { retry: { limit: 3 } })` is
  // 'explicit', not 'client-default', because the call said so rather than inheriting it.
  if (retry !== 'unknown' && config && retryNames.some((n) => lookup(n))) {
    retry = 'library'
    retryReason = 'explicit'
  }
  // Same contract as timeoutMs: a spread may carry `retry`/`retries`, so absence is unprovable.
  if (retry === 'none' && opaque) {
    retry = 'unknown'
    retryReason = 'opaque-spread'
  }
  // An explicit `retry: 0` / `retry: { limit: 0 }` overrides both the client-kind default and
  // the presence check above: the call was deliberately configured NOT to retry.
  if (retry === 'library' && retryExplicitlyDisabled(config, retryNames)) {
    // Behind a spread the disable is readable but absence still is not, so the verdict stays
    // 'unknown' and the reason names the spread, not the disable, which is what made it unprovable.
    retry = opaque ? 'unknown' : 'none'
    retryReason = opaque ? 'opaque-spread' : 'disabled'
  }
  // A hand-rolled retry loop is not proof of retry, but it is proof that absence of retry
  // cannot be shown, so abstain instead of warning. See isInManualRetryLoop for why this is
  // narrower than the loop-ancestor heuristic that preceded it.
  if (retry === 'none' && isInManualRetryLoop(call)) {
    retry = 'unknown'
    retryReason = 'manual-loop'
  }
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
  return { timeoutMs, retry, retryReason }
}
