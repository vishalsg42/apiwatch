import { resolve, join } from 'node:path'
import { mkdtempSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { CallSite, Workspace } from '../src/model.js'

export const repoRoot = resolve(import.meta.dirname, '..')
export const fx = (name: string) => resolve(import.meta.dirname, 'fixtures', name)
export const tmpDir = () => mkdtempSync(join(tmpdir(), 'apiwatch-'))
export const tmpCopyOf = (fixture: string) => {
  const d = tmpDir(); cpSync(fx(fixture), d, { recursive: true }); return d
}

export const ws: Workspace = {
  root: '/repo', sourceFiles: [], packageDirs: ['/repo'], dependencies: {},
}

export const site = (over: Partial<CallSite> = {}): CallSite => ({
  id: 'a1', file: 'src/x.ts', line: 10, column: 2, client: 'axios', method: 'get',
  url: { kind: 'config', expr: "config.get('a')" },
  options: { timeoutMs: null, retry: 'none', validated: 'unknown' },
  fileImports: ['axios'], ...over,
})
