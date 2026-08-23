import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * One fixture per client per import shape. CONTRIBUTING claims the `cjs-*` fixtures "exist
 * specifically to catch" the CommonJS blind spot, but they only ever covered axios-shaped flows,
 * which is how two bugs shipped: `@nestjs/axios` was ESM-only, and a destructured
 * `const { request } = require('node:http')` bound nothing at all.
 *
 * This grid is the enforcement the convention never had. Every entry must resolve to exactly one
 * call site; a zero here means a client is invisible in that shape.
 */
const SHAPES: [string, string][] = [
  ['axios', 'axios-esm-default.ts'],
  ['axios', 'axios-cjs-default.js'],
  ['axios', 'axios-cjs-destructured.js'],
  ['got', 'got-esm-default.ts'],
  ['got', 'got-cjs-default.js'],
  ['got', 'got-cjs-destructured.js'],
  ['node:http', 'nodehttp-esm-named.ts'],
  ['node:http', 'nodehttp-cjs-default.js'],
  ['node:http', 'nodehttp-cjs-destructured.js'],
  ['node-fetch', 'nodefetch-esm-default.ts'],
  ['node-fetch', 'nodefetch-cjs-default.js'],
  ['request-promise', 'rp-esm-default.ts'],
  ['request-promise', 'rp-cjs-default.js'],
  ['request-promise', 'rp-cjs-destructured.js'],
]

describe('client x import shape matrix', () => {
  for (const [client, file] of SHAPES) {
    it(`${client}: ${file}`, async () => {
      const sites = await sitesFor('client-matrix', file)
      expect(sites).toHaveLength(1)
    })
  }
})
