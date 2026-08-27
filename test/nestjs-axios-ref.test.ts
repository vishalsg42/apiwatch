import { describe, expect, it } from 'vitest'
import { siteAt, sitesFor } from './helpers.js'

/**
 * `HttpService.axiosRef` is the axios instance the service wraps, and reaching for it is the
 * documented way to get a promise instead of an Observable. The call head is then
 * `this.httpService.axiosRef`, which matched no binding name, so every call through it was
 * skipped in silence: no call site, no counter, every rule quiet. See #14.
 *
 * ufosc/Jukebox-Server is the reproduction. It injects `HttpService` in four shipped files and
 * makes all of its outbound calls through `axiosRef`, and apiwatch reported a confident zero
 * call sites for the whole repository.
 *
 * The option shapes are axios's own, which is what makes this safe to fold onto the existing
 * binding rather than model separately: `configArgIndex` already returns the same indices for
 * 'axios' and 'nestjs-axios', because `HttpService.get(url, config)` mirrors `axios.get`.
 */
describe('a call through HttpService.axiosRef is the same client', () => {
  it('finds every axiosRef call site in the file', async () => {
    const sites = await sitesFor('nestjs-axios-ref', 'svc.ts')
    expect(sites).toHaveLength(5)
    expect(new Set(sites.map((s) => s.client))).toEqual(new Set(['nestjs-axios']))
  })

  it('reports a bare axiosRef call as having no deadline', async () => {
    const s = await siteAt('nestjs-axios-ref', 'svc.ts', /bare'\)/)
    expect(s.method).toBe('get')
    expect(s.options.timeoutMs).toBeNull()
  })

  it('reads the config argument at axios positions', async () => {
    const get = await siteAt('nestjs-axios-ref', 'svc.ts', /x\.dev\/t'/)
    expect(get.options.timeoutMs).toBe(3000)
    // post(url, data, config): the config sits at index 2, not 1.
    const post = await siteAt('nestjs-axios-ref', 'svc.ts', /x\.dev\/p'/)
    expect(post.method).toBe('post')
    expect(post.options.timeoutMs).toBe(1000)
  })

  it('reads request(config) the same way a plain axios.request is read', async () => {
    const s = await siteAt('nestjs-axios-ref', 'svc.ts', /axiosRef\.request\(/)
    // The verb is the method that was CALLED, not the `method` key inside the config:
    // `configMethod` only fills in when the call names no method at all (callsites.ts:418), so
    // plain `axios.request({ method: 'post' })` reports 'request' too. Folding axiosRef onto the
    // existing binding keeps that identical rather than inventing a second convention.
    expect(s.method).toBe('request')
    expect(s.options.timeoutMs).toBe(2000)
  })

  it('follows a chain broken across lines', async () => {
    const sites = await sitesFor('nestjs-axios-ref', 'svc.ts')
    const s = sites.find((x) => JSON.stringify(x.url).includes('chained'))
    expect(s, 'the multiline axiosRef chain produced no call site').toBeDefined()
    expect(s?.client).toBe('nestjs-axios')
  })

  it('does not let any other client inherit a client through .axiosRef', async () => {
    // The gate. `.axiosRef` means something only on HttpService; on anything else it is an
    // ordinary property, and a property is a different value that must not inherit the binding.
    expect(await sitesFor('nestjs-axios-ref', 'not-nest.ts')).toHaveLength(0)
  })
})
