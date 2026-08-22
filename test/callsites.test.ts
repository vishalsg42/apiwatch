import type { SourceFile } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { findCallSites } from '../src/static/callsites.js'
import { buildRegistry, resolveClients } from '../src/static/registry.js'
import { projectsFor, sitesFor } from './helpers.js'

describe('findCallSites', () => {
  it('finds every axios call shape', async () => {
    const s = await sitesFor('axios-variants', 'svc.ts')
    expect(s.map((x) => x.method)).toEqual(['get', 'post', 'put', undefined])
  })
  it('emits repo-relative posix paths', async () =>
    expect((await sitesFor('axios-variants', 'svc.ts'))[0].file).toBe('src/svc.ts'))
  it('gives two calls on the same line distinct ids', async () => {
    const s = await sitesFor('same-line', 'svc.ts')
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length)
  })
  it('finds calls on a derived instance', async () =>
    expect(await sitesFor('axios-instance', 'svc.ts')).toHaveLength(1))
  it('finds calls on a cross-module client', async () =>
    expect(await sitesFor('shared-client', 'payments.ts')).toHaveLength(1))
  it('finds legacy request(opts, cb) calls', async () => {
    const s = await sitesFor('legacy-request', 'proxy.js')
    expect(s).toHaveLength(1)
    expect(s[0].client).toBe('request')
  })
  it('records the file import list for pure rules', async () =>
    expect((await sitesFor('legacy-request', 'proxy.js'))[0].fileImports).toContain('request'))
  it('ignores axios.create as a call site', async () =>
    expect((await sitesFor('axios-instance', 'svc.ts')).every((s) => s.method !== 'create')).toBe(
      true,
    ))

  it('finds a real fetch call while skipping one shadowed elsewhere in the same file', async () => {
    const s = await sitesFor('mixed-fetch', 'svc.ts')
    expect(s).toHaveLength(1)
    expect(s[0].client).toBe('fetch')
    expect(s[0].line).toBe(5) // the `real()` call, not the injected-param one in `makeClient`
  })

  it('recognises a destructured `{ fetch }` parameter as a local shadow', async () => {
    const s = await sitesFor('fetch-destructured', 'svc.ts')
    expect(s).toHaveLength(1)
    expect(s[0].client).toBe('fetch')
    expect(s[0].line).toBe(5) // the `real()` call, not the destructured one in `inject`
  })

  it('recognises a catch clause binding named fetch as a local shadow', async () => {
    const s = await sitesFor('fetch-catch', 'svc.ts')
    expect(s).toHaveLength(1)
    expect(s[0].client).toBe('fetch')
    expect(s[0].line).toBe(5) // the `real()` call, not the one inside `catch (fetch)`
  })

  it('recognises a function declared named fetch as shadowing the whole file', async () =>
    expect(await sitesFor('fetch-named-fn', 'svc.ts')).toHaveLength(0))

  it('keeps CallSite.file repo-relative even when ws.root carries a trailing slash', async () => {
    const { w, projects } = await projectsFor('axios-variants')
    const registry = buildRegistry(projects)
    const sf = projects
      .flatMap((p) => p.project.getSourceFiles())
      .find((s) => s.getFilePath().endsWith('svc.ts')) as SourceFile
    const s = findCallSites(sf, resolveClients(sf, registry), { ...w, root: `${w.root}/` })
    expect(s[0].file).toBe('src/svc.ts')
    expect(s[0].file.startsWith('/')).toBe(false)
  })
})
