import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { discoverWorkspace } from '../src/workspace/discover.js'
import { fx } from './helpers.js'

// created at test time; a committed node_modules/ would be swallowed by .gitignore
beforeAll(() => {
  mkdirSync(join(fx('simple-express'), 'node_modules/axios'), { recursive: true })
  writeFileSync(join(fx('simple-express'), 'node_modules/axios/index.js'), 'module.exports={}')
  mkdirSync(join(fx('simple-express'), 'dist'), { recursive: true })
  writeFileSync(join(fx('simple-express'), 'dist/index.js'), '// built')
})

describe('discoverWorkspace', () => {
  it('finds sources and ignores node_modules, dist and tests', async () => {
    const w = await discoverWorkspace(fx('simple-express'))
    const rel = w.sourceFiles.map((f) => f.slice(fx('simple-express').length + 1)).sort()
    expect(rel).toEqual(['src/index.js', 'src/payments.js'])
  })
  it('records one package dir', async () =>
    expect((await discoverWorkspace(fx('simple-express'))).packageDirs).toHaveLength(1))
  it('includes jsx and tsx sources', async () =>
    expect(
      (await discoverWorkspace(fx('jsx-repo'))).sourceFiles.some((f) => f.endsWith('.tsx')),
    ).toBe(true))
  it('collects dependencies per package, for pure rules to resolve against a file', async () => {
    const w = await discoverWorkspace(fx('simple-express'))
    expect(w.dependenciesByDir[w.root]?.axios).toBe('^1.7.0')
  })
})
