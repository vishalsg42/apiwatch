import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

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
})
