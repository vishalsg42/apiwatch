import { describe, expect, it } from 'vitest'
import { validatedFor } from './helpers.js'

describe('isResponseValidated', () => {
  it('true when the response passes a zod schema', async () =>
    expect(await validatedFor('validated-zod', 'svc.ts')).toBe(true))
  it('true for a free-function validator such as class-validator', async () =>
    expect(await validatedFor('validated-free-fn', 'svc.ts')).toBe(true))
  it('false when .data is returned directly', async () =>
    expect(await validatedFor('unvalidated', 'svc.ts')).toBe(false))
  // Regression: `JSON.parse`/`Date.parse` share the member name `parse` with zod's `.parse()`,
  // and the comment above this test used to be aspirational rather than true: the fixture
  // imported no validator lib, so `hasValidatorLib` was false and the member-name check was
  // never reached at all; the test passed for the wrong reason. The fixture now imports zod so
  // this actually exercises the JSON.parse/Date.parse exclusion.
  it('does NOT count JSON.parse as validation', async () =>
    expect(await validatedFor('unvalidated', 'legacy.js')).toBe(false))
  it('unknown when the value escapes into an imported function', async () =>
    expect(await validatedFor('ambiguous', 'svc.ts')).toBe('unknown'))
  it('true for a CommonJS file validating via require("joi")', async () =>
    expect(await validatedFor('validated-cjs', 'svc.js')).toBe(true))
  // Regression: the escape-to-imported-function check used getImportDeclarations() (ESM only)
  // while the hasValidatorLib check in the same function correctly used collectFileImports,
  // so the CJS twin of `ambiguous` (require destructuring instead of an ESM named import)
  // returned a false `false` and fired unvalidated-response instead of staying 'unknown'.
  it('unknown when the value escapes into a CJS-required function', async () =>
    expect(await validatedFor('ambiguous-cjs', 'svc.js')).toBe('unknown'))
})
