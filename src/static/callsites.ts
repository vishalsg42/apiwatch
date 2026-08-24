import { createHash } from 'node:crypto'
import {
  type ArrayBindingPattern,
  type ArrowFunction,
  type BindingElement,
  type Block,
  type CallExpression,
  type CatchClause,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  type Node,
  type ObjectBindingPattern,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type PropertyAssignment,
  type SetAccessorDeclaration,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from 'ts-morph'
import type { CallSite, ClientBinding, Workspace } from '../model.js'
import { bindingNameOf } from './clients.js'
import { collectFileImports } from './imports.js'
import { configMethod, isCallbackArg, resolveOptions } from './options.js'
import { classifyUrl } from './urls.js'
import { isResponseValidated } from './validation.js'

// Deliberately does NOT include 'options': a property-access `.options()` call is never tracked
// as a call site at all (see the README's Limitations and the no-retry rule row for why the
// IDEMPOTENT set's 'options' entry below is dead by design, not an oversight).
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'head', 'request'])

// A synthetic binding for a bare `fetch(...)` call that resolves to no import: the global.
const NATIVE_FETCH: ClientBinding = {
  name: 'fetch',
  kind: 'fetch',
  origin: 'import',
  instanceTimeout: false,
  instanceRetry: false,
}

const FN_LIKE_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])

/**
 * Whether a parameter binds the name `fetch`. `ParameterDeclaration.getName()` returns the
 * PATTERN SOURCE TEXT for a destructured parameter (e.g. `"{ fetch }"`, not `"fetch"`), so a
 * destructured shape must be unpacked via its name node instead: walking `BindingElement`s
 * covers both `{ fetch }` and a renamed-into `{ http: fetch }` (the bound local name, not the
 * property name, is what matters for a bare `fetch(...)` call).
 */

/**
 * Whether the given node itself (not its descendants) declares a binding named `fetch`:
 * a function parameter (including a destructured one), a variable or function declared
 * directly in this block/source file (not one nested inside a deeper block; a function
 * declaration is a scope-level binding just like `var`/`let`/`const`, so this also covers
 * a call site inside the shadowing function's own body, i.e. recursion), a named function
 * expression's own self-reference, or a `catch` clause's bound name. Used to walk a call's
 * ancestors and decide, purely syntactically, whether a particular `fetch(...)` call is
 * locally shadowed.
 */
/**
 * The names a variable declaration binds, flattened through destructuring.
 *
 * `const fetch = x` binds `fetch`; `const { fetch } = x` and `const [fetch] = xs` bind it too,
 * and so do the renaming and nested forms (`{ a: fetch }`, `{ a: { fetch } }`). A source-text
 * comparison sees none of them, which is what made a locally destructured wrapper read as the
 * global.
 */
function bindsName(nameNode: Node, want: string): boolean {
  const k = nameNode.getKind()
  if (k === SyntaxKind.Identifier) return nameNode.getText() === want
  if (k === SyntaxKind.ObjectBindingPattern || k === SyntaxKind.ArrayBindingPattern)
    return nameNode
      .asKindOrThrow(k)
      .getElements()
      .some((el) => {
        const n = el.asKind(SyntaxKind.BindingElement)?.getNameNode()
        return n ? bindsName(n, want) : false
      })
  return false
}

const declarationBindsFetch = (d: VariableDeclaration): boolean =>
  bindsName(d.getNameNode(), 'fetch')

function declaresFetch(node: Node): boolean {
  const kind = node.getKind()
  if (FN_LIKE_KINDS.has(kind)) {
    const fn = node as
      | FunctionDeclaration
      | FunctionExpression
      | ArrowFunction
      | MethodDeclaration
      | ConstructorDeclaration
      | GetAccessorDeclaration
      | SetAccessorDeclaration
    // bindsName, not a shallow element scan: a parameter destructures exactly like a variable
    // declaration does, so `({ deps: { fetch } }) => …` and `({ a: fetch }) => …` shadow the
    // global just as much as `({ fetch }) =>` does. The shallow version missed the nested and
    // renamed forms and reported no-timeout at error severity on a shadowed call.
    if (fn.getParameters().some((prm) => bindsName(prm.getNameNode(), 'fetch'))) return true
    if (
      (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.FunctionExpression) &&
      (fn as FunctionDeclaration | FunctionExpression).getName() === 'fetch'
    )
      return true
  }
  if (kind === SyntaxKind.Block || kind === SyntaxKind.SourceFile) {
    const scope = node as Block | SourceFile
    // getName() returns the WHOLE pattern for a destructured declaration: `const { fetch } = x`
    // yields "{ fetch }" and `const [fetch] = xs` yields "[fetch]", so an equality test against
    // 'fetch' never matched and the call was then asserted to be native fetch. That is an
    // error-severity false positive on code that is genuinely wrapped. Compare against the names
    // the declaration actually BINDS instead of its source text.
    if (scope.getVariableDeclarations().some(declarationBindsFetch)) return true
    if (scope.getFunctions().some((f) => f.getName() === 'fetch')) return true
  }
  if (kind === SyntaxKind.CatchClause) {
    const cc = node as CatchClause
    const cv = cc.getVariableDeclaration()
    if (cv && bindsName(cv.getNameNode(), 'fetch')) return true
  }
  return false
}

/**
 * Whether the file imports something under the name `fetch`. An import binding is file-scoped
 * and so shadows the global for EVERY bare `fetch(...)` in the file, which the ancestor-scope
 * walk below cannot see (imports are not a scope in the chain).
 *
 * This is the common house pattern of wrapping fetch in a local module to add SSRF filtering,
 * proxy support or a default timeout. Outline's `import fetch from "@server/utils/fetch"` was
 * read as native fetch and produced four no-timeout findings against a wrapper that takes a
 * timeout option. An import from a known client module (`import fetch from 'node-fetch'`) is
 * already bound to its real kind in `clients`, and that binding still wins below.
 */
function importBindsFetch(sf: SourceFile): boolean {
  return sf
    .getImportDeclarations()
    .some(
      (d) =>
        d.getDefaultImport()?.getText() === 'fetch' ||
        d.getNamespaceImport()?.getText() === 'fetch' ||
        d.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === 'fetch'),
    )
}

/** Scope-aware shadow check: does THIS call's enclosing scope chain shadow `fetch`? */
function isFetchShadowedHere(call: CallExpression): boolean {
  return call.getAncestors().some(declaresFetch)
}

/**
 * Bumped whenever the fingerprint derivation below changes, so a baseline written by an older
 * apiwatch is detectably incompatible rather than silently mismatching every entry.
 */
export const FP_VERSION = 2

/** Every loop-free ancestor kind that owns a nameable scope. */
const NAMED_SCOPE_KINDS = new Set([
  SyntaxKind.ClassDeclaration,
  SyntaxKind.ClassExpression,
  SyntaxKind.ModuleDeclaration,
])
const NAMED_FN_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])
const NAMEABLE_DECL_KINDS = new Set([
  SyntaxKind.VariableDeclaration,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.PropertyAssignment,
])

const nameOf = (n: Node): string | undefined => {
  const maybe = n as unknown as { getName?: () => string | undefined }
  try {
    return typeof maybe.getName === 'function' ? maybe.getName() : undefined
  } catch {
    return undefined
  }
}

/**
 * The dotted chain of enclosing named scopes, outermost first, or `<module>`.
 *
 * The rule that matters: a plain declaration (`const x = ...`) contributes its name ONLY when a
 * function-like node sits between the call and that declaration. That distinguishes a
 * declaration which OWNS a scope containing the call from one merely being ASSIGNED the call's
 * result:
 *
 *   const publicApi = { get: () => axios.get(u) }   ->  publicApi.get   (arrow in between)
 *   const response  = await axios.get(u)            ->  <enclosing fn>  (nothing in between)
 *
 * Without it, `const response = await axios.get(u)` yields "getUser.response", and
 * `const { data } = await axios.get(u)` yields "getUser.{ data }" from binding-pattern SOURCE
 * TEXT, which would re-key on reformatting. Both verified against ts-morph 28.
 *
 * Accessors are tagged by kind so a getter and a setter of the same name stay distinct.
 */
function symbolPathOf(call: CallExpression): string {
  const parts: string[] = []
  let sawFunction = false
  let child: Node = call
  for (const a of call.getAncestors()) {
    const kind = a.getKind()

    // An anonymous callback passed to a call gets that call as its scope name, so route
    // handlers stay distinct. Six byte-identical `axios.get(fileCheckUrl)` calls in one real
    // file sat in six anonymous `router.post("/send-report-*", ...)` handlers and were
    // otherwise indistinguishable. The first string argument is included because it is what
    // names the handler; without it every route in a file collapses to `router.post`.
    if (kind === SyntaxKind.CallExpression && sawFunction) {
      const ce = a as CallExpression
      if (ce.getArguments().some((arg) => arg === child)) {
        const callee = ce.getExpression().getText()
        const label = ce.getArguments().find((arg) => arg.getKind() === SyntaxKind.StringLiteral)
        parts.push(
          label
            ? `${callee}(${(label as unknown as { getLiteralValue(): string }).getLiteralValue()})`
            : callee,
        )
        child = a
        continue
      }
    }
    child = a
    if (FN_LIKE_KINDS.has(kind)) {
      if (NAMED_FN_KINDS.has(kind)) {
        const n = nameOf(a)
        if (n) {
          const tag =
            kind === SyntaxKind.GetAccessor ? ':get' : kind === SyntaxKind.SetAccessor ? ':set' : ''
          parts.push(n + tag)
        }
      }
      sawFunction = true
      continue
    }
    if (NAMED_SCOPE_KINDS.has(kind)) {
      const n = nameOf(a)
      if (n) parts.push(n)
      continue
    }
    if (NAMEABLE_DECL_KINDS.has(kind) && sawFunction) {
      const n = nameOf(a)
      if (n) parts.push(n)
    }
  }
  return parts.reverse().join('.') || '<module>'
}

/**
 * A format-independent key for the call's target, derived from `pickUrlArg` so it also reaches a
 * `url:`/`uri:` property inside a first-position options object (the `request` shape).
 *
 * String literals contribute their DECODED value, never their source text, so a quote-style flip
 * (`'/users'` -> `"/users"`) cannot re-key a finding. One `.prettierrc` change would otherwise
 * invalidate an entire baseline. There is no truncation: the value is hashed anyway, and
 * truncating only creates collisions between urls that differ late.
 */
function urlKeyOf(call: CallExpression): string {
  const arg = pickUrlArg(call)
  if (!arg) return '()'
  const kind = arg.getKind()
  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (arg as unknown as { getLiteralValue(): string }).getLiteralValue()
  }
  if (kind === SyntaxKind.TemplateExpression) {
    // Rebuild from cooked literal text plus placeholders, so indentation and line breaks inside
    // a multi-line template cannot change the key.
    const t = arg as unknown as {
      getHead(): { getLiteralText(): string }
      getTemplateSpans(): { getExpression(): Node; getLiteral(): { getLiteralText(): string } }[]
    }
    let out = t.getHead().getLiteralText()
    for (const span of t.getTemplateSpans()) {
      out += `\${${span.getExpression().getText()}}${span.getLiteral().getLiteralText()}`
    }
    return out
  }
  if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PropertyAccessExpression) {
    return arg.getText()
  }
  return SyntaxKind[kind] ?? 'unknown'
}

/** Position-independent identity for a call site. See FP_VERSION. */
export function fingerprintOf(
  call: CallExpression,
  file: string,
  client: string,
  method: string | undefined,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        FP_VERSION,
        file,
        symbolPathOf(call),
        client,
        method ?? 'request',
        urlKeyOf(call),
      ]),
    )
    .digest('hex')
    .slice(0, 24)
}

export function findCallSites(
  sf: SourceFile,
  clients: Map<string, ClientBinding>,
  ws: Workspace,
): CallSite[] {
  const abs = sf.getFilePath() as string
  const root = ws.root.endsWith('/') ? ws.root.slice(0, -1) : ws.root // a user-supplied --root may carry a trailing slash
  const file = abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs
  const fileImports = collectFileImports(sf)
  const fetchIsImported = importBindsFetch(sf)
  const out: CallSite[] = []

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    let binding: string | undefined
    let method: string | undefined

    if (expr.getKind() === SyntaxKind.Identifier) binding = expr.getText()
    else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
      const name = pa.getName()
      if (!METHODS.has(name)) continue // excludes .create(), .interceptors, …
      method = name === 'del' ? 'delete' : name
      const head = pa.getExpression().getText()
      binding = bindingNameOf(head)
    } else continue

    let b: ClientBinding | undefined
    if (binding === 'fetch' && expr.getKind() === SyntaxKind.Identifier) {
      // Task 4's registry suppresses `fetch` for the WHOLE FILE when any local binding named
      // `fetch` exists anywhere in it, too coarse. Re-check per call site, syntactically, by
      // walking this call's own ancestor scopes, so a shadowed `fetch` elsewhere in the file
      // doesn't erase a genuine native-fetch call site here.
      const resolved = clients.get('fetch')
      // A KNOWN client module that binds the name wins outright. `const fetch =
      // require('node-fetch')` declares a variable called `fetch`, so the shadow walk below
      // treats it as shadowing the global and skipped the call entirely, losing every
      // node-fetch call site written in CommonJS. The "shadow" there IS the client.
      if (resolved && resolved.kind !== 'fetch') {
        b = resolved
      } else {
        // Task 4's registry suppressed `fetch` for the WHOLE FILE when any local binding named
        // `fetch` existed anywhere in it, which was too coarse. Re-check per call site by
        // walking this call's own ancestor scopes, so a shadowed `fetch` elsewhere in the file
        // does not erase a genuine native-fetch call here.
        if (isFetchShadowedHere(call)) continue
        // Fall back to the global ONLY when nothing in the file binds the name. A local wrapper
        // leaves `clients` empty, and assuming the global there invents a call site.
        b = resolved ?? (fetchIsImported ? undefined : NATIVE_FETCH)
      }
    } else {
      b = binding ? clients.get(binding) : undefined
    }
    if (!b) continue
    // A factory binding builds a client; calling it makes no request. `create({...})` and
    // `defaults({...})` must never be call sites, or 0.3.3's behaviour returns: a finding on the
    // factory line instead of on the calls that actually go out.
    if (b.origin === 'factory') continue
    // A property-access call's method comes from its own name (`.post()`). A bare call
    // (`axios({ method: 'post', ... })`, `fetch(url, { method: 'POST' })`) carries it in the
    // config object instead: read it from there so a rule that skips idempotent methods
    // doesn't have to treat "method unreadable" and "method is get/head" as the same thing.
    // A named or destructured method import (`const { get } = require('request-promise')`) is an
    // Identifier callee, so the property-access branch above never ran and the verb would be lost:
    // evidence printed `request-promise()` and no-retry fired on a POST, because `undefined` is
    // idempotent by design. The binding remembers what it was imported as.
    //
    // NOTE: deliberately NOT threaded into options.ts. The three clients with ambiguous overloads
    // now resolve their config argument by argument SHAPE, so they never consult the method, and
    // no other client exposes a verb as a named export (see CLIENT_EXPORTS). Adding it there would
    // be dead code that no test can distinguish.
    method ??= b.boundMethod
    method ??= configMethod(call, b)

    const { line, column } = sf.getLineAndColumnAtPos(call.getStart())
    const urlArg = pickUrlArg(call)
    out.push({
      // Unchanged and position-DEPENDENT on purpose: it identifies a physical occurrence, which
      // is what keeps two calls on one line distinct. Baseline identity is `fingerprint`.
      id: createHash('sha1')
        .update(`${file}:${line}:${column}:${b.kind}`)
        .digest('hex')
        .slice(0, 12),
      fingerprint: fingerprintOf(call, file, b.kind, method),
      file,
      line,
      column,
      client: b.kind,
      method,
      url: classifyUrl(urlArg),
      options: { ...resolveOptions(call, b), validated: isResponseValidated(call) },
      fileImports,
    })
  }
  return out
}

/**
 * `request`'s options object may key the endpoint under `url:` or `uri:`; both are
 * documented, canonical usage, not an edge case.
 */
// `url`/`uri` first, then node:http's own convention. Without host/hostname a call like
// `http.request({ host, path }, cb)` found no url property and fell through to "first
// non-object argument", which is the CALLBACK. Since urlKeyOf feeds the fingerprint, two calls
// to different hosts in one function collapsed to a single identity: verified as 2 findings
// sharing 1 fingerprint, stored as one baseline entry with count 2, so fixing one call and
// adding another to a third host left the audit green.
//
// A bare host has no scheme, so classifyUrl still reports it as a variable rather than a
// literal. That is deliberate: this restores IDENTITY without inventing new hardcoded-host
// findings. `path` is not appended, because combining it would re-key calls that already
// resolve correctly through `url`/`uri`.
const URL_PROP_NAMES = ['url', 'uri', 'host', 'hostname']

/**
 * The call's URL argument. For an options-object-first call (`request({ url, ... }, cb)`),
 * reads the object's OWN top-level `url`/`uri` property via the AST and returns its real
 * initializer node, never a source-text regex, and never a fabricated node. A regex over the
 * whole object's text matches the FIRST `url:` anywhere, including one nested inside another
 * property (e.g. `proxy: { url: '...' }`), which can misreport a nested field as the endpoint.
 */
function pickUrlArg(call: CallExpression): Node | undefined {
  const args = call.getArguments()
  const obj = args.find((a) => a.getKind() === SyntaxKind.ObjectLiteralExpression)
  if (obj && args.indexOf(obj) === 0) {
    const objLit = obj as ObjectLiteralExpression
    for (const name of URL_PROP_NAMES) {
      const p = objLit.getProperty(name)
      if (p?.getKind() === SyntaxKind.PropertyAssignment) {
        const init = (p as PropertyAssignment).getInitializer()
        if (init) return init
      }
    }
  }
  // Never a callback. Same predicate the options picker uses, so the two agree about which
  // argument is which rather than drifting apart.
  return args.find((a) => a.getKind() !== SyntaxKind.ObjectLiteralExpression && !isCallbackArg(a))
}
