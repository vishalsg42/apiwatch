import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Project, type SourceFile } from 'ts-morph'
import type { CallSite, Workspace } from '../src/model.js'
import { findCallSites } from '../src/static/callsites.js'
import { createProjects } from '../src/static/project.js'
import { buildRegistry, resolveClients } from '../src/static/registry.js'
import { classifyUrl } from '../src/static/urls.js'
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

export async function sitesFor(fixture: string, file: string) {
  const { w, projects } = await projectsFor(fixture)
  const registry = buildRegistry(projects)
  const sf = projects
    .flatMap((p) => p.project.getSourceFiles())
    .find((s) => s.getFilePath().endsWith(file)) as SourceFile
  return findCallSites(sf, resolveClients(sf, registry), w)
}

export async function siteAt(fixture: string, file: string, match: RegExp) {
  const sites = await sitesFor(fixture, file)
  const src = readFileSync(`${fx(fixture)}/src/${file}`, 'utf8').split('\n')
  const hit = sites.find((s) => match.test(src[s.line - 1] ?? ''))
  if (!hit) throw new Error(`no call site matching ${match} in ${fixture}/${file}`)
  return hit
}

export async function validatedFor(fixture: string, file: string) {
  return (await sitesFor(fixture, file))[0].options.validated
}

export function classify(exprText: string | undefined) {
  if (exprText === undefined) return classifyUrl(undefined)
  const p = new Project({ useInMemoryFileSystem: true })
  const sf = p.createSourceFile('t.ts', `const x = ${exprText}`)
  return classifyUrl(sf.getVariableDeclarationOrThrow('x').getInitializer())
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
