import { Project, ts } from 'ts-morph'
import type { Workspace } from '../model.js'

export function createProjects(ws: Workspace) {
  const dirs = [...ws.packageDirs].sort((a, b) => b.length - a.length) // deepest wins
  const owner = (f: string) => dirs.find((d) => f.startsWith(`${d}/`)) ?? ws.root
  const byDir = new Map<string, string[]>()
  for (const f of ws.sourceFiles) {
    const d = owner(f)
    const arr = byDir.get(d)
    if (arr) arr.push(f)
    else byDir.set(d, [f])
  }

  return [...byDir].map(([dir, files]) => {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.Preserve,
        noResolve: true,
        noLib: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2023,
      },
    })
    project.addSourceFilesAtPaths(files)
    return { dir, project }
  })
}
