import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Workspace } from '../model.js'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  '.aws-sam',
  'vendor',
  'test',
  'tests',
  '__tests__',
  'e2e',
])
const EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/
const SKIP_FILE = /(\.d\.ts$|\.min\.js$|\.test\.|\.spec\.)/
const posix = (p: string) => p.split(sep).join('/')

export async function discoverWorkspace(root: string): Promise<Workspace> {
  const sourceFiles: string[] = [],
    packageDirs: string[] = []
  const dependencies: Record<string, string> = {}

  async function walk(dir: string) {
    let entries: Dirent[] | undefined
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p)
      } else if (e.name === 'package.json') {
        packageDirs.push(posix(dir))
        try {
          const pkg = JSON.parse(await readFile(p, 'utf8'))
          Object.assign(dependencies, pkg.devDependencies ?? {}, pkg.dependencies ?? {})
        } catch {
          /* an unreadable package.json is not fatal */
        }
      } else if (EXT.test(e.name) && !SKIP_FILE.test(e.name)) sourceFiles.push(posix(p))
    }
  }
  await walk(root)
  return { root: posix(root), sourceFiles: sourceFiles.sort(), packageDirs, dependencies }
}
