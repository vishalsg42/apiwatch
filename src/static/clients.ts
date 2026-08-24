import {
  type CallExpression,
  type Node,
  type ObjectBindingPattern,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'
import type { ClientBinding, ClientKind } from '../model.js'
import { collectFileImports } from './imports.js'

const TABLE: Record<string, ClientKind> = {
  axios: 'axios',
  request: 'request',
  'request-promise': 'request-promise',
  'request-promise-native': 'request-promise',
  'node-fetch': 'node-fetch',
  '@nestjs/axios': 'nestjs-axios',
  got: 'got',
  http: 'node:http',
  https: 'node:http',
  'node:http': 'node:http',
  'node:https': 'node:http',
} // 'supertest' is deliberately absent. See "Client support order" for why
// superagent/needle/undici/ky are omitted entirely.

const bind = (
  name: string,
  kind: ClientKind,
  origin: ClientBinding['origin'],
  instanceTimeout = false,
  instanceRetry = false,
  boundMethod?: string,
): ClientBinding => ({ name, kind, origin, instanceTimeout, instanceRetry, boundMethod })

/**
 * The HTTP verb a named export represents, or undefined when the export is the client itself.
 *
 * `request`/`request-promise` expose their verbs as destructurable properties and `node:http`
 * exposes `request` and `get`, so a named import can BE a method. `default` and `fetch` are the
 * client, not a verb. `del` normalises to `delete`, matching the property-access path in
 * callsites.ts, so the two agree on one spelling.
 *
 * `options` is included deliberately, and it is the one asymmetry: property-access `.options()`
 * is excluded from METHODS in callsites.ts (an `.options` property is far more often a config
 * bag than a request), while a destructured `options` is allowlisted as callable and does become
 * a call site. Recording the verb here does not change any rule, since 'options' is idempotent;
 * the underlying disagreement between the two paths is pre-existing and stays documented.
 */
const VERBS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'del',
  'head',
  'options',
  'request',
])
const verbOf = (imported: string): string | undefined =>
  VERBS.has(imported) ? (imported === 'del' ? 'delete' : imported) : undefined

const TIMEOUT_PROPS = new Set(['timeout'])
const RETRY_PROPS = new Set(['retry', 'retries'])

/**
 * Whether a named property is present AND not explicitly disabled.
 *
 * `axios.create({ timeout: 0 })` sets no timeout at all: 0 is axios's "no timeout" value, the
 * same as omitting it. Checking only that the property EXISTS read that instance as protected
 * and silently suppressed no-timeout on every call through it. The same holds for a retry count
 * of 0, and for `retry: { limit: 0 }`, which is how got's retries are turned off.
 *
 * Only a literal 0 (or `false`, or a nested `limit`/`retries`/`maxRetries` of 0) counts as
 * disabled. A non-literal value cannot be read statically, and a value we cannot read is not
 * proof of absence, so it still counts as present.
 */
function hasEnabledProp(obj: ObjectLiteralExpression, names: Set<string>): boolean {
  for (const p of obj.getProperties()) {
    const kind = p.getKind()
    if (kind === SyntaxKind.ShorthandPropertyAssignment) {
      // `{ timeout }`: the value is a binding, not readable here, so treat it as present.
      if (names.has((p as ShorthandPropertyAssignment).getName())) return true
      continue
    }
    if (kind !== SyntaxKind.PropertyAssignment) continue
    const pa = p as PropertyAssignment
    if (!names.has(pa.getName())) continue
    const init = pa.getInitializer()
    if (!init) return true
    if (init.getKind() === SyntaxKind.NumericLiteral && Number(init.getText()) === 0) continue
    if (init.getKind() === SyntaxKind.FalseKeyword) continue
    // got spells its retry budget as `retry: { limit: 0 }`.
    if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const inner = init as ObjectLiteralExpression
      const disabled = inner.getProperties().some((ip) => {
        if (ip.getKind() !== SyntaxKind.PropertyAssignment) return false
        const ipa = ip as PropertyAssignment
        if (!['limit', 'retries', 'maxRetries', 'attempts'].includes(ipa.getName())) return false
        const iv = ipa.getInitializer()
        return !!iv && iv.getKind() === SyntaxKind.NumericLiteral && Number(iv.getText()) === 0
      })
      if (disabled) continue
    }
    return true
  }
  return false
}

/**
 * Detects `<clientBinding>.create({...})` and, when it resolves to an already-known client
 * binding, produces a derived ClientBinding for it. Only inspects the OWN top-level properties
 * of the first argument when it's an object literal; never descends into nested object
 * literals, and never scans the call's source text (a `// TODO: add retry handling here`
 * comment sitting one line inside the call must never be mistaken for a `retry` option).
 */
function deriveFromCreate(
  out: Map<string, ClientBinding>,
  name: string,
  init: Node | undefined,
): ClientBinding | undefined {
  if (!init || init.getKind() !== SyntaxKind.CallExpression) return undefined
  const call = init as CallExpression
  const callee = call.getExpression()
  // `<client>.create({...})` and, since a factory export can be bound directly, a BARE
  // `create({...})` / `defaults({...})` on a binding whose origin is 'factory'. Without the
  // bare form, `import { create } from 'axios'` derived nothing and every call on the resulting
  // instance was invisible.
  let base: ClientBinding | undefined
  if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pae = callee as PropertyAccessExpression
    if (!FACTORY_METHODS.has(pae.getName())) return undefined
    base = out.get(bindingNameOf(pae.getExpression().getText()))
  } else if (callee.getKind() === SyntaxKind.Identifier) {
    const candidate = out.get(bindingNameOf(callee.getText()))
    if (candidate?.origin !== 'factory') return undefined
    base = candidate
  }
  if (!base) return undefined

  const arg0 = call.getArguments()[0]
  const obj =
    arg0 && arg0.getKind() === SyntaxKind.ObjectLiteralExpression
      ? (arg0 as ObjectLiteralExpression)
      : undefined
  const instanceTimeout = !!obj && hasEnabledProp(obj, TIMEOUT_PROPS)
  const instanceRetry = !!obj && hasEnabledProp(obj, RETRY_PROPS)
  return bind(name, base.kind, 'derived', instanceTimeout, instanceRetry)
}

/**
 * Whether some module OTHER than `@nestjs/axios` binds the name `HttpService` in this file.
 * Without this, a file that requires `@nestjs/axios` for an unrelated reason and types a
 * parameter with its own `HttpService` class gains call sites it should not have.
 */
function httpServiceBoundElsewhere(sf: SourceFile): boolean {
  for (const d of sf.getImportDeclarations()) {
    if (d.getModuleSpecifierValue() === '@nestjs/axios') continue
    if (
      d
        .getNamedImports()
        .some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === 'HttpService')
    )
      return true
  }
  return false
}

/**
 * Which NAMED exports of a supported module are themselves callable request functions.
 *
 * A default or namespace import represents the whole module and is always the client. A named
 * import is not: 0.3.3 bound every named export as a client to make destructured `require` work,
 * so `createServer` from `node:http` became an outbound call site reporting `no-timeout` at ERROR
 * severity. `createServer` is a server.
 *
 * Verified against installed packages: axios has no named `axios` export (only `default`); got
 * does export a named `got` in 12.x and 14.x; node-fetch has no named `fetch`, but the entry is
 * kept because it costs nothing and covers v2 CJS aliasing plus the common mis-written
 * `import { fetch } from 'node-fetch'`; request's verb helpers really are destructurable
 * properties of the exported function.
 */
const CLIENT_EXPORTS: Record<ClientKind, Set<string>> = {
  axios: new Set(['default']),
  'node:http': new Set(['default', 'request', 'get']),
  got: new Set(['default', 'got']),
  'node-fetch': new Set(['default', 'fetch']),
  request: new Set(['default', 'get', 'post', 'put', 'patch', 'delete', 'del', 'head', 'options']),
  'request-promise': new Set([
    'default',
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'del',
    'head',
    'options',
  ]),
  // HttpService is reached through the DI parameter branch, never as a callable binding.
  'nestjs-axios': new Set(['default']),
  fetch: new Set(['default', 'fetch']),
}

/**
 * Named exports that BUILD a client rather than being one. These must be bound, not rejected:
 * excluding them would turn a loud false positive into silence. Measured on 0.3.3,
 * `import { create } from 'axios'; const api = create({...}); api.get(...)` reported one finding
 * on the `create()` call (wrong line) while the genuine instance calls were already invisible;
 * rejecting `create` outright would have reported nothing at all.
 */
/** Method names that build a client from an existing binding. */
const FACTORY_METHODS = new Set(['create', 'extend', 'defaults'])

const CLIENT_FACTORIES: Partial<Record<ClientKind, Set<string>>> = {
  axios: new Set(['create']),
  got: new Set(['create', 'extend']),
  request: new Set(['defaults']),
  'request-promise': new Set(['defaults']),
}

/**
 * The export name a binding element or import specifier actually refers to.
 *
 * `getText()` is not safe here: for `const { 'request': quoted } = ...` it returns the name WITH
 * quotes, and for a computed key it returns the brackets, so an allowlist would reject a
 * legitimate binding. Verified against ts-morph 28.
 */
export function importedName(node: {
  getPropertyNameNode?: () => Node | undefined
  getName: () => string
}): string {
  const key = node.getPropertyNameNode?.()
  if (!key) return node.getName()
  if (key.getKind() === SyntaxKind.StringLiteral)
    return (key as unknown as { getLiteralValue(): string }).getLiteralValue()
  return key.getText()
}

const isClientExport = (kind: ClientKind, name: string) => CLIENT_EXPORTS[kind]?.has(name) ?? false
const isClientFactory = (kind: ClientKind, name: string) =>
  CLIENT_FACTORIES[kind]?.has(name) ?? false

/**
 * Classifies a variable initializer as a require of a whole module or of one named export.
 *
 *   require('axios')            -> { specifier: 'axios' }
 *   require('axios').default    -> { specifier: 'axios', property: 'default' }
 *   anything else               -> undefined
 */
function requireShape(init: Node): { specifier: string; property?: string } | undefined {
  const asRequire = (n: Node): string | undefined => {
    if (n.getKind() !== SyntaxKind.CallExpression) return undefined
    const call = n as CallExpression
    if (call.getExpression().getText() !== 'require') return undefined
    const arg = call.getArguments()[0]
    if (!arg) return undefined
    const k = arg.getKind()
    if (k !== SyntaxKind.StringLiteral && k !== SyntaxKind.NoSubstitutionTemplateLiteral)
      return undefined
    return (arg as unknown as { getLiteralValue(): string }).getLiteralValue()
  }

  const whole = asRequire(init)
  if (whole !== undefined) return { specifier: whole }

  if (init.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pae = init as PropertyAccessExpression
    const spec = asRequire(pae.getExpression())
    if (spec !== undefined) return { specifier: spec, property: pae.getName() }
  }
  return undefined
}

/**
 * The local binding name a source-text reference resolves to.
 *
 * A class property is registered under its bare name (`api`), because that is what the property
 * declaration is called, but every reference to it in the class reads `this.api`. Call-site
 * resolution already stripped the prefix; the three lookups in this file did not, so
 * `axiosRetry(this.api, { retries: 3 })` found no binding and left instanceRetry false, and every
 * `this.api.get(...)` afterwards reported a false no-retry. The same asymmetry silently broke
 * `this.api.create(...)` derivation.
 *
 * One helper for every lookup, so the two halves cannot drift apart again.
 */
export const bindingNameOf = (text: string): string =>
  text.startsWith('this.') ? text.slice(5) : text

export function detectClients(sf: SourceFile): Map<string, ClientBinding> {
  const out = new Map<string, ClientBinding>()

  for (const d of sf.getImportDeclarations()) {
    const kind = TABLE[d.getModuleSpecifierValue()]
    if (!kind) continue
    const def = d.getDefaultImport()?.getText()
    if (def) out.set(def, bind(def, kind, 'import'))
    for (const n of d.getNamedImports()) {
      // A type-only specifier never produces a runtime binding.
      if (n.isTypeOnly() || d.isTypeOnly()) continue
      const imported = n.getName()
      const local = n.getAliasNode()?.getText() ?? imported
      if (isClientFactory(kind, imported)) out.set(local, bind(local, kind, 'factory'))
      else if (isClientExport(kind, imported))
        out.set(local, bind(local, kind, 'import', false, false, verbOf(imported)))
    }
    const ns = d.getNamespaceImport()?.getText()
    if (ns) out.set(ns, bind(ns, kind, 'import'))
  }

  // Walk EVERY variable declaration in the file, not just top-level ones: `getVariableDeclarations()`
  // only sees declarations that are direct statements of the source file, so a lazy
  // `const axios = require('axios')` inside a function body (a common CJS pattern) was
  // invisible and produced zero call sites for that binding.
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = v.getInitializer()
    if (!init) continue
    // Parse the initializer STRUCTURALLY. A prefix-only regex matched `require('node:http')`
    // inside `require('node:http').createServer` and bound the whole module, so
    // `const server = require('node:http').createServer` became an outbound call site.
    const shape = requireShape(init)
    if (shape && TABLE[shape.specifier]) {
      const kind = TABLE[shape.specifier]
      // `require(spec).name` names a single export and must clear the allowlist.
      if (shape.property !== undefined) {
        const local = v.getName()
        if (isClientFactory(kind, shape.property)) out.set(local, bind(local, kind, 'factory'))
        else if (isClientExport(kind, shape.property))
          out.set(local, bind(local, kind, 'import', false, false, verbOf(shape.property)))
        continue
      }
      const nameNode = v.getNameNode()
      // `const { request } = require('node:http')` is one of the most idiomatic CJS shapes and
      // was completely invisible: VariableDeclaration.getName() returns the PATTERN SOURCE TEXT
      // for a destructuring binding ("{ request }"), which can never match a call site. Bind
      // each element's local name instead, which is what a call actually uses. The same pattern
      // is already handled correctly in collectImportedNames (static/imports.ts) and
      // resolveClients (static/registry.ts); detectClients was the odd one out.
      if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern) {
        for (const el of (nameNode as ObjectBindingPattern).getElements()) {
          const local = el.getName()
          if (!local) continue
          const imported = importedName(el)
          if (isClientFactory(kind, imported)) out.set(local, bind(local, kind, 'factory'))
          else if (isClientExport(kind, imported))
            out.set(local, bind(local, kind, 'import', false, false, verbOf(imported)))
        }
        continue
      }
      out.set(v.getName(), bind(v.getName(), kind, 'import'))
      continue
    }
    const b = deriveFromCreate(out, v.getName(), init)
    if (b) {
      b.exportedAs = v.getVariableStatement()?.isExported() ? v.getName() : undefined
      out.set(v.getName(), b)
    }
  }

  // `export default axios.create({...})` and `export default client`.
  //
  // buildRegistry only records bindings whose exportedAs is set, and resolveClients only ever
  // looked at named imports, so a client shared by default export resolved to nothing in every
  // consumer and produced ZERO call sites there. That is the most common way to share a
  // configured client, and it failed silently: no diagnostic, no counter, just an empty audit
  // for the file. Keyed as 'default', matching the name a default import resolves under.
  for (const ea of sf.getDescendantsOfKind(SyntaxKind.ExportAssignment)) {
    if (ea.isExportEquals()) continue // `export = x` is CJS interop, not a default export
    const expr = ea.getExpression()
    // `export default client` re-exports a binding this file already derived.
    const existing = out.get(bindingNameOf(expr.getText()))
    if (existing?.origin === 'derived') {
      existing.exportedAs = 'default'
      continue
    }
    // `export default axios.create({...})` derives inline, with no local name to bind to.
    const b = deriveFromCreate(out, 'default', expr)
    if (b) {
      b.exportedAs = 'default'
      out.set('default', b)
    }
  }

  // class fields: `private readonly api = axios.create({...})`
  for (const pd of sf.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const b = deriveFromCreate(out, pd.getName(), pd.getInitializer())
    if (b) out.set(pd.getName(), b)
  }

  // assignments: `this.api = axios.create({...})` / `module.exports.api = axios.create({...})`.
  // Registered under the bare property name: call-site matching strips a leading `this.`. A
  // `module.exports.x = ...` / `exports.x = ...` form is this file's CJS export surface, exactly
  // like an exported `const x = ...`: it must set `exportedAs` too, or the cross-module
  // registry (buildRegistry only records bindings with `exportedAs` set) never sees it, and a
  // CJS-only file exporting this way silently produces zero call sites downstream.
  for (const be of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (be.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue
    const left = be.getLeft()
    if (left.getKind() !== SyntaxKind.PropertyAccessExpression) continue
    const pae = left as PropertyAccessExpression
    const name = pae.getName()
    const b = deriveFromCreate(out, name, be.getRight())
    if (!b) continue
    const head = pae.getExpression().getText()
    if (head === 'module.exports' || head === 'exports') b.exportedAs = name
    out.set(name, b)
  }

  // axios-retry(api, {...}) binds retry to that instance, not the file
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = c.getExpression()
    if (!/axiosRetry|axios_retry|rax\.attach/.test(e.getText())) continue
    const target = c.getArguments()[0]?.getText()
    const b = target && out.get(bindingNameOf(target))
    if (b) b.instanceRetry = true
  }

  // NestJS: constructor(private httpService: HttpService)
  // Gated on the file actually importing `@nestjs/axios`; the `out.size ||` half of the old
  // condition was almost always true (any other client already registered in this file made
  // `out.size` truthy), so the NestJS branch effectively ran unconditionally and matched a
  // parameter's TYPE NODE by substring against its full text (`p.getText()` includes the
  // parameter's own name), so `mockHttpService: MockHttpService` in an ordinary axios test file
  // matched too. Match the type node's own name exactly instead, still purely syntactic.
  // collectFileImports covers ESM specifiers AND require(...) calls; asking
  // getImportDeclarations() directly is the CJS blind spot CONTRIBUTING names as a hard
  // convention violation. Guarded by a shadow check in the same spirit as importBindsFetch: if
  // another module in this file binds the name `HttpService`, the parameter type is not
  // necessarily Nest's, so do not claim the call site.
  const importsNestAxios =
    collectFileImports(sf).includes('@nestjs/axios') && !httpServiceBoundElsewhere(sf)
  if (importsNestAxios)
    for (const p of sf.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const typeNode = p.getTypeNode()
      if (typeNode?.getText().trim() === 'HttpService')
        out.set(p.getName(), bind(p.getName(), 'nestjs-axios', 'import'))
    }

  // Native `fetch` is a global, so it is assumed present unless this file binds the name to
  // something else. An import that binds `fetch` is the case that matters most in real code:
  // wrapping fetch in a local module (to add SSRF filtering, proxy support, a default timeout)
  // is a common house pattern, and treating those calls as native fetch reports a timeout the
  // wrapper may well set. Outline's `import fetch from "@server/utils/fetch"` was read as
  // native fetch and produced four findings against a wrapper that accepts a timeout option.
  //
  // An import from a module in TABLE (`import fetch from 'node-fetch'`) has already been bound
  // to its real client above, so skipping the native binding here never loses that call site.
  const importBindsFetch = sf
    .getImportDeclarations()
    .some(
      (d) =>
        d.getDefaultImport()?.getText() === 'fetch' ||
        d.getNamespaceImport()?.getText() === 'fetch' ||
        d.getNamedImports().some((n) => (n.getAliasNode()?.getText() ?? n.getName()) === 'fetch'),
    )
  const shadowed =
    importBindsFetch ||
    sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some(
        (i: Node) =>
          i.getText() === 'fetch' &&
          (i.getParent()?.getKind() === SyntaxKind.Parameter ||
            i.getParent()?.getKind() === SyntaxKind.VariableDeclaration ||
            i.getParent()?.getKind() === SyntaxKind.FunctionDeclaration),
      )
  if (!shadowed) out.set('fetch', bind('fetch', 'fetch', 'import'))
  return out
}
