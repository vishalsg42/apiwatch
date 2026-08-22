import { dirname, resolve } from 'node:path'
import type { Project, SourceFile } from 'ts-morph'
import type { ClientBinding } from '../model.js'
import { detectClients } from './clients.js'

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

export function resolveClients(sf: SourceFile, reg: Map<string, ClientBinding>) {
  const local = detectClients(sf)
  for (const d of sf.getImportDeclarations()) {
    const spec = d.getModuleSpecifierValue()
    if (!spec.startsWith('.')) continue
    const target = stripExt(resolve(dirname(sf.getFilePath()), spec))
    for (const n of d.getNamedImports()) {
      const hit = reg.get(key(target, n.getName()))
      if (hit) local.set(n.getAliasNode()?.getText() ?? n.getName(), hit)
    }
  }
  return local
}
