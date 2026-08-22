import {
  type CallExpression,
  type Node,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'
import type { ClientBinding, ClientKind } from '../model.js'

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
): ClientBinding => ({ name, kind, origin, instanceTimeout, instanceRetry })

/**
 * Whether an object literal has an OWN top-level property whose name is in `names`: accepting
 * both a regular `PropertyAssignment` (`{ timeout: 5000 }`) and a `ShorthandPropertyAssignment`
 * (`{ timeout }`). Never descends into nested object literals (e.g. `httpsAgent: new
 * https.Agent({ timeout: 5000 })` must not count) and never scans source text, so a property
 * name that merely appears inside a comment or a nested literal can't match.
 */
function hasOwnTopLevelProp(obj: ObjectLiteralExpression, names: Set<string>): boolean {
  return obj
    .getProperties()
    .some(
      (p) =>
        (p.getKind() === SyntaxKind.PropertyAssignment ||
          p.getKind() === SyntaxKind.ShorthandPropertyAssignment) &&
        names.has((p as PropertyAssignment | ShorthandPropertyAssignment).getName()),
    )
}

const TIMEOUT_PROPS = new Set(['timeout'])
const RETRY_PROPS = new Set(['retry', 'retries'])

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
  if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined
  const pae = callee as PropertyAccessExpression
  if (pae.getName() !== 'create') return undefined
  const base = out.get(pae.getExpression().getText())
  if (!base) return undefined

  const arg0 = call.getArguments()[0]
  const obj =
    arg0 && arg0.getKind() === SyntaxKind.ObjectLiteralExpression
      ? (arg0 as ObjectLiteralExpression)
      : undefined
  const instanceTimeout = !!obj && hasOwnTopLevelProp(obj, TIMEOUT_PROPS)
  const instanceRetry = !!obj && hasOwnTopLevelProp(obj, RETRY_PROPS)
  return bind(name, base.kind, 'derived', instanceTimeout, instanceRetry)
}

export function detectClients(sf: SourceFile): Map<string, ClientBinding> {
  const out = new Map<string, ClientBinding>()

  for (const d of sf.getImportDeclarations()) {
    const kind = TABLE[d.getModuleSpecifierValue()]
    if (!kind) continue
    const def = d.getDefaultImport()?.getText()
    if (def) out.set(def, bind(def, kind, 'import'))
    for (const n of d.getNamedImports()) {
      const local = n.getAliasNode()?.getText() ?? n.getName()
      out.set(local, bind(local, kind, 'import'))
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
    const text = init.getText()
    const req = /^require\(['"]([^'"]+)['"]\)/.exec(text)
    if (req && TABLE[req[1]]) {
      out.set(v.getName(), bind(v.getName(), TABLE[req[1]], 'import'))
      continue
    }
    const b = deriveFromCreate(out, v.getName(), init)
    if (b) {
      b.exportedAs = v.getVariableStatement()?.isExported() ? v.getName() : undefined
      out.set(v.getName(), b)
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
    const b = target && out.get(target)
    if (b) b.instanceRetry = true
  }

  // NestJS: constructor(private httpService: HttpService)
  // Gated on the file actually importing `@nestjs/axios`; the `out.size ||` half of the old
  // condition was almost always true (any other client already registered in this file made
  // `out.size` truthy), so the NestJS branch effectively ran unconditionally and matched a
  // parameter's TYPE NODE by substring against its full text (`p.getText()` includes the
  // parameter's own name), so `mockHttpService: MockHttpService` in an ordinary axios test file
  // matched too. Match the type node's own name exactly instead, still purely syntactic.
  if (sf.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === '@nestjs/axios'))
    for (const p of sf.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const typeNode = p.getTypeNode()
      if (typeNode?.getText().trim() === 'HttpService')
        out.set(p.getName(), bind(p.getName(), 'nestjs-axios', 'import'))
    }

  const shadowed = sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some(
      (i: Node) =>
        i.getText() === 'fetch' &&
        (i.getParent()?.getKind() === SyntaxKind.Parameter ||
          i.getParent()?.getKind() === SyntaxKind.VariableDeclaration),
    )
  if (!shadowed) out.set('fetch', bind('fetch', 'fetch', 'import'))
  return out
}
