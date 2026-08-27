import { dirname, resolve } from 'node:path'
import { type ObjectBindingPattern, type Project, type SourceFile, SyntaxKind } from 'ts-morph'
import type { ClientBinding } from '../model.js'
import { detectClients, importedName } from './clients.js'
import { requireSpecifier } from './imports.js'
import { EMPTY_NEST_MODULES, moduleTimeoutFor, type NestModules } from './nestjs.js'

const key = (file: string, name: string) => `${file}#${name}`
const stripExt = (p: string) => p.replace(/\.(m|c)?[jt]sx?$/, '')

export function buildRegistry(projects: { project: Project }[]): Map<string, ClientBinding> {
  const reg = new Map<string, ClientBinding>()
  for (const { project } of projects)
    for (const sf of project.getSourceFiles())
      for (const b of detectClients(sf).values())
        if (b.origin === 'derived' && b.exportedAs)
          reg.set(key(stripExt(sf.getFilePath()), b.exportedAs), b)
  return reg
}

/**
 * Looks up `${target}#${importedName}` in the registry, resolving directly (`./http`) or via a
 * barrel (`./http/index`), and, if found, binds it locally under `localName`.
 */
function apply(
  local: Map<string, ClientBinding>,
  reg: Map<string, ClientBinding>,
  target: string,
  importedName: string,
  localName: string,
) {
  const hit = reg.get(key(target, importedName)) ?? reg.get(key(`${target}/index`, importedName))
  if (hit) local.set(localName, hit)
}

export function resolveClients(
  sf: SourceFile,
  reg: Map<string, ClientBinding>,
  nest: NestModules = EMPTY_NEST_MODULES,
) {
  const local = detectClients(sf)
  const dir = dirname(sf.getFilePath())

  // A NestJS timeout is configured where the module is wired, not where the call is written, so
  // it cannot be read from this file alone. Rebound rather than mutated: a binding reached
  // through the registry is shared, and stamping a module verdict onto it would leak into every
  // other file that resolves the same export. See #8.
  const verdict = moduleTimeoutFor(nest, sf.getFilePath())
  if (verdict)
    for (const [name, b] of local)
      if (b.kind === 'nestjs-axios')
        local.set(name, { ...b, moduleTimeout: verdict === 'configured' ? 'set' : 'unknown' })

  for (const d of sf.getImportDeclarations()) {
    const spec = d.getModuleSpecifierValue()
    if (!spec.startsWith('.')) continue
    const target = stripExt(resolve(dir, spec))
    // Same rule as detectClients: a type-only import erases and binds nothing at runtime.
    if (d.isTypeOnly()) continue
    for (const n of d.getNamedImports()) {
      if (n.isTypeOnly()) continue
      apply(local, reg, target, n.getName(), n.getAliasNode()?.getText() ?? n.getName())
    }
    // `import client from './http'` against `export default ...`. Omitting this made every
    // consumer of a default-exported client report zero call sites, silently.
    const def = d.getDefaultImport()
    if (def) apply(local, reg, target, 'default', def.getText())
  }

  // CJS: `const { api } = require('./http')`. Without this, resolveClients only ever looked at
  // `getImportDeclarations()`, which is empty for a CommonJS file, so a cross-module client
  // exported via `module.exports.api = axios.create(...)` and consumed via `require` produced
  // zero call sites for every file that imported it this way.
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = v.getInitializer()
    if (!init) continue
    const spec = requireSpecifier(init)
    if (!spec?.startsWith('.')) continue
    const target = stripExt(resolve(dir, spec))
    const nameNode = v.getNameNode()
    if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) continue
    // importedName, not getPropertyNameNode()?.getText(): for a quoted key
    // (`const { 'api': client } = require('./http')`) getText() returns "'api'" WITH the
    // quotes, which can never match an exported name, so the cross-module binding was lost
    // silently. Same latent bug as the one fixed in detectClients.
    for (const el of (nameNode as ObjectBindingPattern).getElements())
      apply(local, reg, target, importedName(el), el.getName())
  }

  return local
}
