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
} from 'ts-morph'
import type { CallSite, ClientBinding, Workspace } from '../model.js'
import { collectFileImports } from './imports.js'
import { configMethod, resolveOptions } from './options.js'
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
function paramDeclaresFetch(p: ParameterDeclaration): boolean {
  const nameNode = p.getNameNode()
  const kind = nameNode.getKind()
  if (kind === SyntaxKind.ObjectBindingPattern || kind === SyntaxKind.ArrayBindingPattern) {
    const pattern = nameNode as ObjectBindingPattern | ArrayBindingPattern
    return pattern
      .getElements()
      .some(
        (el) =>
          el.getKind() === SyntaxKind.BindingElement &&
          (el as BindingElement).getName() === 'fetch',
      )
  }
  return kind === SyntaxKind.Identifier && nameNode.getText() === 'fetch'
}

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
    if (fn.getParameters().some(paramDeclaresFetch)) return true
    if (
      (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.FunctionExpression) &&
      (fn as FunctionDeclaration | FunctionExpression).getName() === 'fetch'
    )
      return true
  }
  if (kind === SyntaxKind.Block || kind === SyntaxKind.SourceFile) {
    const scope = node as Block | SourceFile
    if (scope.getVariableDeclarations().some((d) => d.getName() === 'fetch')) return true
    if (scope.getFunctions().some((f) => f.getName() === 'fetch')) return true
  }
  if (kind === SyntaxKind.CatchClause) {
    const cc = node as CatchClause
    if (cc.getVariableDeclaration()?.getName() === 'fetch') return true
  }
  return false
}

/** Scope-aware shadow check: does THIS call's enclosing scope chain shadow `fetch`? */
function isFetchShadowedHere(call: CallExpression): boolean {
  return call.getAncestors().some(declaresFetch)
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
      binding = head.startsWith('this.') ? head.slice(5) : head
    } else continue

    let b: ClientBinding | undefined
    if (binding === 'fetch' && expr.getKind() === SyntaxKind.Identifier) {
      // Task 4's registry suppresses `fetch` for the WHOLE FILE when any local binding named
      // `fetch` exists anywhere in it, too coarse. Re-check per call site, syntactically, by
      // walking this call's own ancestor scopes, so a shadowed `fetch` elsewhere in the file
      // doesn't erase a genuine native-fetch call site here.
      if (isFetchShadowedHere(call)) continue
      b = clients.get('fetch') ?? NATIVE_FETCH
    } else {
      b = binding ? clients.get(binding) : undefined
    }
    if (!b) continue
    // A property-access call's method comes from its own name (`.post()`). A bare call
    // (`axios({ method: 'post', ... })`, `fetch(url, { method: 'POST' })`) carries it in the
    // config object instead: read it from there so a rule that skips idempotent methods
    // doesn't have to treat "method unreadable" and "method is get/head" as the same thing.
    method ??= configMethod(call, b)

    const { line, column } = sf.getLineAndColumnAtPos(call.getStart())
    const urlArg = pickUrlArg(call)
    out.push({
      id: createHash('sha1')
        .update(`${file}:${line}:${column}:${b.kind}`)
        .digest('hex')
        .slice(0, 12),
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
const URL_PROP_NAMES = ['url', 'uri']

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
  return args.find((a) => a.getKind() !== SyntaxKind.ObjectLiteralExpression)
}
