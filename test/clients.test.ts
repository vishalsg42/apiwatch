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
})
