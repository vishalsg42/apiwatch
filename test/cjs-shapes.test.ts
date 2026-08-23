import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

// CONTRIBUTING calls a direct sf.getImportDeclarations() "a common way to introduce a silent CJS
// blind spot" and claims the cjs-* fixtures exist to catch it. They only covered axios-shaped
// flows, so two real blind spots shipped. These pin the shapes that were invisible.
describe('CommonJS destructured require', () => {
  it('resolves a destructured node:http request', async () =>
    expect(await sitesFor('cjs-destructured', 'node-http.js')).toHaveLength(1))

  it('resolves a destructured got', async () =>
    expect(await sitesFor('cjs-destructured', 'got.js')).toHaveLength(1))

  // The bound local name is what a call site uses, not the property name.
  it('resolves a destructured require with a rename', async () =>
    expect(await sitesFor('cjs-destructured', 'renamed.js')).toHaveLength(1))
})

describe('@nestjs/axios via require', () => {
  it('detects HttpService when the module is required rather than imported', async () =>
    expect(await sitesFor('nestjs-cjs', 'svc.ts')).toHaveLength(1))
})
