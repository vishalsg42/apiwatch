import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

describe('node:http option overloads', () => {
  // http.get(options, cb) carries its options at index 0, exactly like http.request. Reading
  // only `request` reported a valid `http.get({ timeout: 5000 })` as having no timeout.
  it('reads a timeout from http.get(options, cb)', async () => {
    const sites = await sitesFor('node-http', 'svc.ts')
    expect(sites[0].options.timeoutMs).toBe(5000)
  })

  it('still reports http.get with no timeout in its options', async () => {
    const sites = await sitesFor('node-http', 'svc.ts')
    expect(sites[1].options.timeoutMs).toBeNull()
  })
})
