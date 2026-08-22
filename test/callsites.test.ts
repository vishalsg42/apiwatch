import type { SourceFile } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { findCallSites } from '../src/static/callsites.js'
import { buildRegistry, resolveClients } from '../src/static/registry.js'
import { projectsFor, sitesFor } from './helpers.js'

describe('findCallSites', () => {
  it('finds every axios call shape', async () => {
    const s = await sitesFor('axios-variants', 'svc.ts')
    // The 4th call is a bare `axios({ method: 'get', url: ... })` — method now comes from the
    // config object read in `configMethod`, not just a property-access call's own name, so it
    // reads 'get' instead of the previously-pinned `undefined`. See the no-retry idempotency
    // regression tests in test/rules.test.ts for why this matters: before this fix, an
    // unreadable method defaulted to "treat as idempotent", so a bare call with an actual
    // non-idempotent method (e.g. `method: 'post'`) was wrongly included in no-retry.
    expect(s.map((x) => x.method)).toEqual(['get', 'post', 'put', 'get'])
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

  // Regression: pickUrlArg used to regex over the whole options object's text and match the
  // FIRST `url:` anywhere, including one nested inside another property (e.g. a proxy config),
  // fabricating a fake node in the process. It must read the OWN top-level url/uri property via
  // the AST and hand classifyUrl the real initializer node.
  it('does not mistake a nested proxy url for the call url', async () => {
    const s = await sitesFor('request-nested-url-proxy', 'proxy.js')
    expect(s).toHaveLength(1)
    expect(s[0].url).toMatchObject({ kind: 'variable', expr: 'target' })
  })
  it('reads the url from the canonical `uri:` key too', async () => {
    const s = await sitesFor('request-uri-key', 'proxy.js')
    expect(s).toHaveLength(1)
    expect(s[0].url).toMatchObject({ kind: 'literal', host: 'x.dev' })
  })

  // Regression: resolveClients only walked ESM getImportDeclarations(), so a client exported
  // via `module.exports.api = axios.create(...)` and consumed via `const { api } = require(...)`
  // — an ordinary CJS pattern — produced zero call sites.
  it('finds calls on a CJS cross-module client exported via module.exports', async () =>
    expect(await sitesFor('cjs-shared-client', 'payments.js')).toHaveLength(1))

  // Regression: detectClients only walked top-level getVariableDeclarations(), so a lazy
  // `const axios = require('axios')` inside a function body was invisible.
  it('finds a call on a client required lazily inside a function body', async () =>
    expect(await sitesFor('cjs-lazy-require', 'svc.js')).toHaveLength(1))

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
