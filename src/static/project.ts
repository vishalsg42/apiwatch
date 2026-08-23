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
    // Add each known path directly rather than through addSourceFilesAtPaths, which treats its
    // argument as a GLOB and walks the directory tree again. discoverWorkspace already produced
    // the exact file list, so that second walk is pure waste, and it crashed the whole run with
    // a raw EACCES stack trace when any directory under the root was unreadable. A file that
    // cannot be read is counted, not fatal, so an audit still reports what it could see.
    let unreadable = 0
    for (const f of files) {
      try {
        project.addSourceFileAtPath(f)
      } catch {
        unreadable++
      }
    }
    return { dir, project, unreadable }
  })
}
