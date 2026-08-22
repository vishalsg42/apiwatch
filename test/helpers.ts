import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SourceFile } from 'ts-morph'
import type { CallSite, Workspace } from '../src/model.js'
import { createProjects } from '../src/static/project.js'
import { buildRegistry, resolveClients } from '../src/static/registry.js'
import { discoverWorkspace } from '../src/workspace/discover.js'

export const repoRoot = resolve(import.meta.dirname, '..')
export const fx = (name: string) => resolve(import.meta.dirname, 'fixtures', name)
export const tmpDir = () => mkdtempSync(join(tmpdir(), 'apiwatch-'))
export const tmpCopyOf = (fixture: string) => {
  const d = tmpDir()
  cpSync(fx(fixture), d, { recursive: true })
  return d
}

export const ws: Workspace = {
  root: '/repo',
  sourceFiles: [],
  packageDirs: ['/repo'],
  dependencies: {},
}

export async function projectsFor(fixture: string) {
  const w = await discoverWorkspace(fx(fixture))
  return { w, projects: createProjects(w) }
}
export async function clientsFor(fixture: string, file: string) {
  const { projects } = await projectsFor(fixture)
  const registry = buildRegistry(projects)
  const sf = projects
    .flatMap((p) => p.project.getSourceFiles())
    .find((s) => s.getFilePath().endsWith(file)) as SourceFile
  return resolveClients(sf, registry)
}

export const site = (over: Partial<CallSite> = {}): CallSite => ({
  id: 'a1',
  file: 'src/x.ts',
  line: 10,
  column: 2,
  client: 'axios',
  method: 'get',
  url: { kind: 'config', expr: "config.get('a')" },
  options: { timeoutMs: null, retry: 'none', validated: 'unknown' },
  fileImports: ['axios'],
  ...over,
})
