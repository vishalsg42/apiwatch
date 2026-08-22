import { type Node, type SourceFile, SyntaxKind } from 'ts-morph'
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
    // derived: <clientBinding>.create({...})
    const m = /^([A-Za-z_$][\w$]*)\.create\(/.exec(text)
    const base = m && out.get(m[1])
    if (base) {
      const b = bind(
        v.getName(),
        base.kind,
        'derived',
        /timeout\s*:/.test(text),
        /retry|retries/.test(text),
      )
      b.exportedAs = v.getVariableStatement()?.isExported() ? v.getName() : undefined
      out.set(v.getName(), b)
    }
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
