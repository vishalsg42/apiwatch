import { describe, expect, it } from 'vitest'
import { clientsFor } from './helpers.js'

describe('client bindings', () => {
  it('maps a default import to its client kind', async () =>
    expect((await clientsFor('simple-express', 'payments.js')).get('axios')?.kind).toBe('axios'))
  it('honours renamed imports', async () => {
    const m = await clientsFor('renamed-import', 'svc.ts')
    expect(m.get('http')?.kind).toBe('axios')
    expect(m.has('axios')).toBe(false)
  })
  it('does NOT treat supertest request() as an http client', async () =>
    expect((await clientsFor('nest-supertest', 'app-e2e.ts')).has('request')).toBe(false))
  it('detects native fetch with no import', async () =>
    expect((await clientsFor('native-fetch', 'svc.ts')).get('fetch')?.kind).toBe('fetch'))
  it('does NOT treat a shadowed fetch as native fetch', async () =>
    expect((await clientsFor('shadowed-fetch', 'svc.ts')).has('fetch')).toBe(false))
  it('registers a binding derived from axios.create()', async () => {
    const b = (await clientsFor('axios-instance', 'svc.ts')).get('api')
    expect(b?.origin).toBe('derived')
    expect(b?.instanceTimeout).toBe(true)
  })
  it('resolves a client imported from another module', async () => {
    const b = (await clientsFor('shared-client', 'payments.ts')).get('api')
    expect(b?.kind).toBe('axios')
    expect(b?.instanceTimeout).toBe(true)
  })
  it('detects the NestJS HttpService', async () =>
    expect((await clientsFor('nestjs', 'svc.ts')).get('httpService')?.kind).toBe('nestjs-axios'))
  it('does NOT treat a nested timeout (e.g. on httpsAgent) as the instance timeout', async () => {
    const b = (await clientsFor('axios-nested-timeout', 'svc.ts')).get('api')
    expect(b?.instanceTimeout).toBe(false)
  })
  it('treats shorthand { timeout } as setting the instance timeout', async () => {
    const b = (await clientsFor('axios-shorthand-timeout', 'svc.ts')).get('api')
    expect(b?.instanceTimeout).toBe(true)
  })
  it('registers a binding derived from a class field', async () => {
    const b = (await clientsFor('axios-class-field', 'svc.ts')).get('api')
    expect(b?.kind).toBe('axios')
    expect(b?.instanceTimeout).toBe(true)
  })
  it('registers a binding derived from a this.x assignment', async () => {
    const b = (await clientsFor('axios-this-assign', 'svc.ts')).get('api')
    expect(b?.kind).toBe('axios')
    expect(b?.instanceTimeout).toBe(true)
  })
  it('resolves a client imported from a barrel (index) module', async () => {
    const b = (await clientsFor('shared-client-index', 'payments.ts')).get('api')
    expect(b?.kind).toBe('axios')
    expect(b?.instanceTimeout).toBe(true)
  })
  // Regression: instanceRetry used to scan the ENTIRE create() call's source text, comments
  // included, so a `// TODO: add retry handling here` comment sitting inside the call
  // suppressed no-retry for every call on that instance. It must only see own top-level
  // properties, the same way instanceTimeout already does.
  it('does NOT treat a "retry" comment inside create() as an instance retry', async () => {
    const b = (await clientsFor('axios-create-comment-retry', 'svc.ts')).get('api')
    expect(b?.instanceRetry).toBe(false)
  })
})

describe('a local fetch wrapper is not native fetch', () => {
  // Regression: `import fetch from "@server/utils/fetch"` was read as native fetch, so four
  // calls in Outline were reported as having no timeout when they route through a wrapper
  // that accepts one. An import binding the name `fetch` shadows the global.
  it('ignores a fetch imported from a local module', async () =>
    expect((await clientsFor('wrapper-fetch', 'wrapped.ts')).has('fetch')).toBe(false))

  it('still detects native fetch in a file that does not import it', async () =>
    expect((await clientsFor('wrapper-fetch', 'native.ts')).get('fetch')?.kind).toBe('fetch'))

  it('still detects node-fetch, which binds the same name from a known module', async () =>
    expect((await clientsFor('wrapper-fetch', 'nodefetch.ts')).get('fetch')?.kind).toBe(
      'node-fetch',
    ))
})
