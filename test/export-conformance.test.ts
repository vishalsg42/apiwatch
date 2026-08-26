import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CJS_ONLY_PROPERTIES } from '../src/static/clients.js'
import { conformanceProject } from './conformance-project.js'
import { repoRoot } from './helpers.js'

/**
 * Does a name apiwatch treats as a client export actually exist, and is it reachable the way
 * apiwatch claims it is reached?
 *
 * #7 was `const { get } = require('axios')` binding nothing. The fix widens an allowlist, and
 * widening that allowlist is what caused the 0.3.3 regression, so the widening rests on a claim
 * about axios that is worth checking rather than believing: its verbs are properties of the
 * DEFAULT export, which is a callable carrying bound methods, and they are not named exports at
 * all. That is why the CJS spelling works, the ESM spelling does not, and only the CJS path is
 * widened.
 *
 * If axios ever adds named verb exports, `import { get } from 'axios'` becomes legitimate and
 * apiwatch should stop ignoring it. This file is what says so.
 */
const project = conformanceProject()
const probe = project.createSourceFile(
  resolve(repoRoot, '.export-conformance-probe.ts'),
  `
import * as AxiosNS from 'axios'
import axiosDefault from 'axios'
import * as NodeHttpNS from 'node:http'

export type AxiosNamed = typeof AxiosNS
export type AxiosDefault = typeof axiosDefault
export type NodeHttpNamed = typeof NodeHttpNS
`,
  { overwrite: true },
)

const unresolved = probe
  .getPreEmitDiagnostics()
  .map((d) => {
    const m = d.getMessageText()
    return typeof m === 'string' ? m : m.getMessageText()
  })
  .filter((m) => /Cannot find module|Cannot find name/.test(m))

const namesOf = (alias: string): ReadonlySet<string> => {
  const names = probe
    .getTypeAliasOrThrow(alias)
    .getType()
    .getNonNullableType()
    .getProperties()
    .map((s) => s.getName())
  // An unresolved type reports nothing, which would make every "is absent" assertion below pass
  // for the wrong reason.
  expect(names.length, `${alias} resolved to no properties`).toBeGreaterThan(5)
  return new Set(names)
}

describe('the check itself is wired up', () => {
  it('every module in the probe resolves', () => expect(unresolved).toEqual([]))
})

describe("axios's verbs are on the default export and are not named exports", () => {
  const verbs = [...(CJS_ONLY_PROPERTIES.axios ?? [])]

  it('the table is not empty, so the assertions below are about something', () =>
    expect(verbs.length).toBeGreaterThan(0))

  for (const verb of verbs) {
    it(`\`${verb}\` is a property of the default export, so the CJS spelling works`, () =>
      expect(namesOf('AxiosDefault').has(verb)).toBe(true))

    it(`\`${verb}\` is NOT a named export, which is why the ESM spelling stays unbound`, () =>
      expect(
        namesOf('AxiosNamed').has(verb),
        `axios now exports '${verb}' by name, so the ESM path should bind it too`,
      ).toBe(false))
  }

  /**
   * The factories go the other way and are already on the ESM path: `import { create } from
   * 'axios'` is real, which is what CLIENT_FACTORIES relies on.
   */
  it('create and defaults ARE named exports, unlike the verbs', () => {
    const named = namesOf('AxiosNamed')
    expect(named.has('create')).toBe(true)
    expect(named.has('defaults')).toBe(true)
  })
})

describe('node:http exports servers as well as clients', () => {
  /**
   * The reason node:http's allowlist can never become "any property". These names are real, so
   * leaving them out is a judgement about what an outbound call is, not an oversight. The 0.3.3
   * regression added `createServer` and reported server construction as outbound traffic; the
   * negative matrix in cjs-destructured-verbs.test.ts asserts the behaviour, and this asserts the
   * fact underneath it.
   */
  it('createServer and Server exist, so excluding them is a choice', () => {
    const named = namesOf('NodeHttpNamed')
    expect(named.has('createServer')).toBe(true)
    expect(named.has('Server')).toBe(true)
    // and the two that ARE clients are real as well
    expect(named.has('request')).toBe(true)
    expect(named.has('get')).toBe(true)
  })
})
