import { describe, expect, it } from 'vitest'
import { validatedFor } from './helpers.js'

describe('isResponseValidated', () => {
  it('true when the response passes a zod schema', async () =>
    expect(await validatedFor('validated-zod', 'svc.ts')).toBe(true))
  it('true for a free-function validator such as class-validator', async () =>
    expect(await validatedFor('validated-free-fn', 'svc.ts')).toBe(true))
  it('false when .data is returned directly', async () =>
    expect(await validatedFor('unvalidated', 'svc.ts')).toBe(false))
  it('does NOT count JSON.parse as validation', async () =>
    expect(await validatedFor('unvalidated', 'legacy.js')).toBe(false))
  it('unknown when the value escapes into an imported function', async () =>
    expect(await validatedFor('ambiguous', 'svc.ts')).toBe('unknown'))
  it('true for a CommonJS file validating via require("joi")', async () =>
    expect(await validatedFor('validated-cjs', 'svc.js')).toBe(true))
})
