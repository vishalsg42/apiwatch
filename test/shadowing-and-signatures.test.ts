import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * Five defects found by an external review and reproduced here before being fixed.
 *
 * The first two are the serious ones and share a root cause: a destructured binding is not a
 * plain name. `const { fetch } = x` has a VariableDeclaration whose getName() returns the whole
 * pattern text `"{ fetch }"`, and whose inner `fetch` identifier has a BindingElement parent, not
 * a VariableDeclaration one. Both shadow checks tested for a plain name, so neither saw it, and
 * apiwatch then asserted the call was native fetch. That is an error-severity false positive on
 * protected code, which is the worst outcome this tool can produce.
 */
const audit = async (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-shadow-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(
    join(dir, 'package.json'),
    '{"name":"s","dependencies":{"axios":"^1.7.0","zod":"^3"}}',
  )
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'src', name), body)
  const { sites, model } = await runAudit({ root: dir, json: true })
  return { sites, findings: model.findings }
}

describe('a locally destructured fetch is not the global', () => {
  it('object destructuring inside a function shadows it', async () => {
    const r = await audit({
      'a.ts': [
        'declare const ctx: { fetch: (u: string) => Promise<unknown> }',
        "export const f = () => { const { fetch } = ctx; return fetch('https://v.dev/a') }",
      ].join('\n'),
    })
    expect(r.findings.filter((f) => f.rule === 'no-timeout')).toEqual([])
  })

  it('array destructuring shadows it too', async () => {
    const r = await audit({
      'a.ts': [
        'declare const list: ((u: string) => Promise<unknown>)[]',
        "export const f = () => { const [fetch] = list; return fetch('https://v.dev/a') }",
      ].join('\n'),
    })
    expect(r.findings.filter((f) => f.rule === 'no-timeout')).toEqual([])
  })

  it('a CommonJS destructured require from a local wrapper shadows it', async () => {
    const r = await audit({
      'a.js': [
        "const { fetch } = require('./wrapper')",
        "module.exports.f = () => fetch('https://v.dev/a')",
      ].join('\n'),
      'wrapper.js':
        'module.exports.fetch = (u) => globalThis.fetch(u, { signal: AbortSignal.timeout(5000) })',
    })
    expect(r.findings.filter((f) => f.rule === 'no-timeout' && f.file.endsWith('a.js'))).toEqual([])
  })

  // The control. Narrowing must not blind apiwatch to real native fetch, or the fix trades an
  // error-severity false positive for a silent false negative, which this project treats as
  // equally serious.
  it('still sees a genuine bare global fetch', async () => {
    const r = await audit({ 'a.ts': "export const f = () => fetch('https://v.dev/a')" })
    expect(r.findings.filter((f) => f.rule === 'no-timeout')).toHaveLength(1)
  })
})

describe('a call inside a classic function expression', () => {
  const body = (kw: string) =>
    [
      "import axios from 'axios'",
      "import { z } from 'zod'",
      'const S = z.object({ a: z.string() })',
      `export const f = ${kw}`,
      "  const r = axios.get('https://v.dev/a', { timeout: 100 })",
      '  return r.then((x) => S.parse(x.data))',
      '}',
    ].join('\n')

  it('finds its validator, exactly as an arrow does', async () => {
    const fnExpr = await audit({ 'a.ts': body('function (u: string) {') })
    const arrow = await audit({ 'a.ts': body('(u: string) => {') })
    expect(arrow.sites[0]?.options.validated).toBe(true) // control: the arrow already worked
    expect(fnExpr.sites[0]?.options.validated).toBe(true)
  })
})

describe('axios.request overloads', () => {
  it('reads the config when the url comes first', async () => {
    const r = await audit({
      'a.ts': [
        "import axios from 'axios'",
        "export const f = () => axios.request('https://v.dev/a', { timeout: 5000 })",
      ].join('\n'),
    })
    expect(r.sites[0]?.options.timeoutMs).toBe(5000)
  })

  it('still reads the config-only form', async () => {
    const r = await audit({
      'a.ts': [
        "import axios from 'axios'",
        "export const f = () => axios.request({ url: 'https://v.dev/a', timeout: 5000 })",
      ].join('\n'),
    })
    expect(r.sites[0]?.options.timeoutMs).toBe(5000)
  })
})

describe('url classification', () => {
  it('keeps the path of a template literal with no substitutions', async () => {
    const r = await audit({
      'a.ts': [
        "import axios from 'axios'",
        'export const f = () => axios.get(`https://api.v.dev/v3/users`, { timeout: 100 })',
      ].join('\n'),
    })
    expect(r.sites[0]?.url).toEqual({
      kind: 'literal',
      url: 'https://api.v.dev/v3/users',
      host: 'api.v.dev',
    })
  })

  // A relative path is not a runtime-built url. Calling it 'variable' made the report say "urls
  // are built at runtime, so static analysis cannot see them", which is plainly untrue of a
  // literal sitting at the call site. It has no host, which is a different fact.
  it('does not call a relative path literal a runtime-built url', async () => {
    const r = await audit({
      'a.ts': [
        "import axios from 'axios'",
        "export const f = () => axios.get('/api/v1/checkout', { timeout: 100 })",
      ].join('\n'),
    })
    expect(r.sites[0]?.url.kind).not.toBe('variable')
  })
})
