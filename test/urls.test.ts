import { describe, expect, it } from 'vitest'
import { classify, sitesFor } from './helpers.js'

describe('classifyUrl', () => {
  it('extracts the host from a string literal', () =>
    expect(classify(`'https://api.stripe.com/v1/charges'`)).toEqual({
      kind: 'literal',
      url: 'https://api.stripe.com/v1/charges',
      host: 'api.stripe.com',
    }))
  it('classifies config.get() as config', () =>
    expect(classify(`config.get('vendor.baseUrl')`).kind).toBe('config'))
  it('classifies configService.get() as config', () =>
    expect(classify(`this.configService.get('X')`).kind).toBe('config'))
  it('classifies process.env as env', () =>
    expect(classify('process.env.CRM_URL').kind).toBe('env'))
  it('reads the host from a template literal prefix', () =>
    expect(classify(`\`https://api.x.dev/v1/\${id}\``)).toMatchObject({
      kind: 'literal',
      host: 'api.x.dev',
    }))
  it('classifies a bare identifier as variable', () =>
    expect(classify('url').kind).toBe('variable'))
  it('returns unknown for a missing argument', () =>
    expect(classify(undefined).kind).toBe('unknown'))
  it('is wired into findCallSites', async () =>
    expect((await sitesFor('axios-variants', 'svc.ts'))[0].url).toMatchObject({
      kind: 'literal',
      host: 'x.dev',
    }))
})
