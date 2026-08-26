import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'
import { clientsFor } from './helpers.js'

/**
 * A type-only import erases at compile time and binds nothing at runtime.
 *
 * The named-import branch always checked this; the default and namespace branches did not, so
 * `import type http from 'node:http'` registered a callable client. That matters because apiwatch
 * matches call sites by NAME and never by type: a file that imports the type and separately holds
 * a local of the same name had that local's calls attributed to a client it never touched, which
 * is a fabricated call site and any finding on it is a false positive.
 *
 * Found while measuring a file-level diagnostic for #6, where four of outline's six flagged files
 * turned out to be `import type http from "node:http"` used purely in annotations.
 */
const write = (src: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-type-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"t","dependencies":{"axios":"^1.7.0"}}')
  writeFileSync(join(dir, 'src', 'a.ts'), src)
  return dir
}

describe('a type-only import binds no client', () => {
  it('binds nothing for default, namespace or named type-only imports', async () => {
    const bindings = await clientsFor('type-only-imports', 'a.ts')
    // the implicit global fetch is always present and is not what this asserts
    expect([...bindings.keys()].filter((k) => k !== 'fetch')).toEqual([])
  })

  /**
   * The reason it matters, rather than being merely untidy. Without the fix the type-only `http`
   * binding matched this local, and a wrapper's `.get` became a node:http call site.
   */
  it('does not attribute a same-named local to the imported type', async () => {
    const { sites } = await runAudit({
      root: write(
        [
          "import type http from 'node:http'",
          'export type Server = typeof http',
          'type Wrapper = { get: (u: string) => Promise<unknown> }',
          'export const f = (http: Wrapper) => http.get("https://v.dev/a")',
        ].join('\n'),
      ),
      json: true,
    })
    expect(sites).toEqual([])
  })

  /** The other half: a real value import of the same module must still bind. */
  it('a value import of the same module still binds', async () => {
    const { sites } = await runAudit({
      root: write(
        ["import axios from 'axios'", 'export const f = () => axios.get("https://v.dev/a")'].join(
          '\n',
        ),
      ),
      json: true,
    })
    expect(sites.map((s) => ({ client: s.client, method: s.method }))).toEqual([
      { client: 'axios', method: 'get' },
    ])
  })
})
