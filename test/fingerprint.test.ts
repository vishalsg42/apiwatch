import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/** A throwaway repo with one source file, so each case controls exactly what is analysed. */
const repo = (source: string, name = 'svc.ts') => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-fp-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', dependencies: { axios: '^1.7.0' } }),
  )
  writeFileSync(join(dir, name), source)
  return dir
}

const keysOf = async (dir: string) =>
  (await runAudit({ root: dir, json: true })).model.findings
    .map((f) => `${f.rule}:${f.fingerprint}`)
    .sort()

/** Rewrite the file in place and re-audit, so only the edit differs. */
const editThen = async (dir: string, edit: (s: string) => string, name = 'svc.ts') => {
  const p = join(dir, name)
  writeFileSync(p, edit(readFileSync(p, 'utf8')))
  return keysOf(dir)
}

const BASE = `import axios from 'axios'
export const load = async () => axios.get('https://api.vendor.dev/thing')
`

describe('fingerprint stability', () => {
  it('survives lines inserted above the call', async () => {
    const dir = repo(BASE)
    const before = await keysOf(dir)
    expect(before.length).toBeGreaterThan(0)
    const after = await editThen(dir, (s) => `// a\n// b\n\n\n${s}`)
    expect(after).toEqual(before)
  })

  it('survives a quote-style flip', async () => {
    const dir = repo(BASE)
    const before = await keysOf(dir)
    const after = await editThen(dir, (s) => s.replace(/'https:\/\/([^']+)'/, '"https://$1"'))
    expect(after).toEqual(before)
  })

  it('survives wrapping the call in a local variable', async () => {
    const dir = repo(BASE)
    const before = await keysOf(dir)
    const after = await editThen(
      dir,
      () => `import axios from 'axios'
export const load = async () => {
  const response = await axios.get('https://api.vendor.dev/thing')
  return response
}
`,
    )
    expect(after).toEqual(before)
  })

  it('leaves an existing call untouched when a different call is inserted before it', async () => {
    const dir = repo(`import axios from 'axios'
export const load = async () => {
  await axios.get('https://api.vendor.dev/accepted')
}
`)
    const before = await keysOf(dir)
    const after = await editThen(
      dir,
      () => `import axios from 'axios'
export const load = async () => {
  await axios.get('https://api.vendor.dev/new-risk')
  await axios.get('https://api.vendor.dev/accepted')
}
`,
    )
    // Every original key must survive; the insertion only adds.
    for (const k of before) expect(after).toContain(k)
    expect(after.length).toBeGreaterThan(before.length)
  })

  it('re-keys when the url changes', async () => {
    const dir = repo(BASE)
    const before = await keysOf(dir)
    const after = await editThen(dir, (s) => s.replace('/thing', '/charge-customer'))
    expect(after).not.toEqual(before)
  })

  it('re-keys when the enclosing function is renamed', async () => {
    const dir = repo(BASE)
    const before = await keysOf(dir)
    const after = await editThen(dir, (s) => s.replace('load', 'fetchThing'))
    expect(after).not.toEqual(before)
  })
})

describe('fingerprint discrimination', () => {
  const fingerprintsOf = async (source: string) => {
    const dir = repo(source)
    const f = (await runAudit({ root: dir, json: true })).model.findings
    return f.filter((x) => x.rule === 'no-timeout').map((x) => x.fingerprint)
  }

  it('separates calls owned by different object-literal variables', async () => {
    const fps = await fingerprintsOf(`import axios from 'axios'
const URL = 'https://api.vendor.dev/x'
export const userService = { load: () => axios.get(URL) }
export const orderService = { load: () => axios.get(URL) }
`)
    expect(fps).toHaveLength(2)
    expect(new Set(fps).size).toBe(2)
  })

  it('separates HOF-wrapped handlers in one file', async () => {
    const fps = await fingerprintsOf(`import axios from 'axios'
declare const wrap: (f: unknown) => never
const URL = 'https://api.vendor.dev/x'
export const createUser = wrap(async () => axios.get(URL))
export const deleteUser = wrap(async () => axios.get(URL))
`)
    expect(fps).toHaveLength(2)
    expect(new Set(fps).size).toBe(2)
  })

  it('separates same-named methods on different classes', async () => {
    const fps = await fingerprintsOf(`import axios from 'axios'
const URL = 'https://api.vendor.dev/x'
export class A { load() { return axios.get(URL) } }
export class B { load() { return axios.get(URL) } }
`)
    expect(fps).toHaveLength(2)
    expect(new Set(fps).size).toBe(2)
  })

  it('separates a getter from a setter of the same name', async () => {
    const fps = await fingerprintsOf(`import axios from 'axios'
const URL = 'https://api.vendor.dev/x'
export class C {
  get token() { return axios.get(URL) }
  set token(v: unknown) { axios.get(URL) }
}
`)
    expect(fps).toHaveLength(2)
    expect(new Set(fps).size).toBe(2)
  })

  it('separates a url that differs only past character 60', async () => {
    const long = 'https://api.vendor.com/v1/very/long/common/prefix/aaaaaaaaaa/'
    const fps = await fingerprintsOf(`import axios from 'axios'
export const a = () => axios.get('${long}health')
export const b = () => axios.get('${long}charge-customer')
`)
    expect(new Set(fps).size).toBe(2)
  })
})
