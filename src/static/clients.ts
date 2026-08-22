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
 * Detects `<clientBinding>.create({...})` and, when it resolves to an already-known client
 * binding, produces a derived ClientBinding for it. Only inspects the OWN top-level properties
 * of the first argument when it's an object literal — never descends into nested object
 * literals (e.g. `httpsAgent: new https.Agent({ timeout: 5000 })` must not count).
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
  const instanceTimeout =
    !!arg0 &&
    arg0.getKind() === SyntaxKind.ObjectLiteralExpression &&
    (arg0 as ObjectLiteralExpression)
      .getProperties()
      .some(
        (p) =>
          (p.getKind() === SyntaxKind.PropertyAssignment ||
            p.getKind() === SyntaxKind.ShorthandPropertyAssignment) &&
          (p as PropertyAssignment | ShorthandPropertyAssignment).getName() === 'timeout',
      )
  const instanceRetry = /retry|retries/.test(call.getText())
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

  for (const v of sf.getVariableDeclarations()) {
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
  // Registered under the bare property name — call-site matching strips a leading `this.`.
  for (const be of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (be.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue
    const left = be.getLeft()
    if (left.getKind() !== SyntaxKind.PropertyAccessExpression) continue
    const name = (left as PropertyAccessExpression).getName()
    const b = deriveFromCreate(out, name, be.getRight())
    if (b) out.set(name, b)
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
  if (
    out.size ||
    sf.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === '@nestjs/axios')
  )
    for (const p of sf.getDescendantsOfKind(SyntaxKind.Parameter))
      if (/HttpService/.test(p.getText()))
        out.set(p.getName(), bind(p.getName(), 'nestjs-axios', 'import'))

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
