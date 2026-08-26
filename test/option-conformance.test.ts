import { resolve } from 'node:path'
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import type { ClientKind } from '../src/model.js'
import { CLIENT_OPTIONS } from '../src/static/options.js'
import { repoRoot } from './helpers.js'

/**
 * Conformance: does every option key apiwatch treats as meaningful actually exist on the client
 * it is handed to?
 *
 * This is the check that #5 should have had. There, `{ retry: 3 }` was read as proof that an
 * axios call re-attempts, though `AxiosRequestConfig` declares no `retry` key, so the option is
 * inert and the call is never retried. apiwatch stayed silent on a real finding. Nothing in the
 * suite could catch it, because every test asserted apiwatch's own idea of the option model
 * against apiwatch's own idea of the option model. The libraries were never consulted.
 *
 * So consult them. Each client's option type is read from the declaration file it actually ships,
 * with a real type-resolving Project (apiwatch's own runs `noResolve`/`noLib`, which is right for
 * auditing a stranger's repo and useless here). Two directions are checked, and both matter:
 *
 *   A. Every key the table treats as PROOF must exist. A key that does not is inert, and reading
 *      it as proof silently suppresses a finding. That is #5.
 *   B. Every key the table treats as INERT must be absent. A key that has quietly appeared makes
 *      apiwatch fire on a call that is genuinely protected, which is an error-severity false
 *      positive.
 *
 * Running it against the table as it stood found three more instances of #5, in the direction
 * nothing was looking: `timeout` counted for the standard fetch, which has no such option, and
 * `signal` counted for `request`, which predates AbortSignal entirely.
 *
 * The client libraries are devDependencies, present only for this file. apiwatch ships one
 * runtime dependency and none of these are it.
 */

/** A real type-resolving project. Nothing like the one apiwatch audits with. */
const project = new Project({
  compilerOptions: {
    target: ScriptTarget.ESNext,
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: ['node'],
    lib: ['lib.esnext.full.d.ts'],
  },
})

/**
 * Every options type, by the name this file refers to it by. The probe lives inside the repo so
 * `node_modules` resolves from it; `import 'axios-retry'` is a side-effect import because that is
 * how the plugin's module augmentation reaches `AxiosRequestConfig`, and it is also exactly when
 * the `axios-retry` key starts doing anything.
 *
 * node-fetch appears twice on purpose. v2 and v3 disagree about `timeout`, and the disagreement
 * is the point: see the dedicated test below.
 */
const probe = project.createSourceFile(
  resolve(repoRoot, '.option-conformance-probe.ts'),
  `
import type { AxiosRequestConfig } from 'axios'
import type { OptionsInit } from 'got'
import type { RequestInit as NodeFetch3 } from 'node-fetch'
import type { RequestInit as NodeFetch2 } from './node_modules/@types/node-fetch/index.js'
import type { CoreOptions } from 'request'
import type { RequestPromiseOptions } from 'request-promise'
import type { RequestOptions } from 'node:http'
import type { AxiosInstance } from 'axios'
import type { HttpService } from '@nestjs/axios'
import nodeFetchFn from 'node-fetch'
import gotFn from 'got'
import 'axios-retry'

export type axios = AxiosRequestConfig
export type got = OptionsInit
export type fetch = RequestInit
export type nodeFetch3 = NodeFetch3
export type nodeFetch2 = NodeFetch2
export type request = CoreOptions
export type requestPromise = RequestPromiseOptions
export type nodeHttp = RequestOptions

// The argument at each index CLIENT_ARG_INDEX claims, named so the matrix below can read it.
export type axios_request_0 = Parameters<AxiosInstance['request']>[0]
export type axios_get_1 = Parameters<AxiosInstance['get']>[1]
export type axios_get_0 = Parameters<AxiosInstance['get']>[0]
export type axios_delete_1 = Parameters<AxiosInstance['delete']>[1]
export type axios_delete_0 = Parameters<AxiosInstance['delete']>[0]
export type axios_head_1 = Parameters<AxiosInstance['head']>[1]
export type axios_head_0 = Parameters<AxiosInstance['head']>[0]
export type axios_post_2 = Parameters<AxiosInstance['post']>[2]
export type axios_post_1 = Parameters<AxiosInstance['post']>[1]
export type axios_put_2 = Parameters<AxiosInstance['put']>[2]
export type axios_put_1 = Parameters<AxiosInstance['put']>[1]
export type axios_patch_2 = Parameters<AxiosInstance['patch']>[2]
export type axios_patch_1 = Parameters<AxiosInstance['patch']>[1]
export type fetch_1 = Parameters<typeof fetch>[1]
export type fetch_0 = Parameters<typeof fetch>[0]
export type nodeFetch_1 = Parameters<typeof nodeFetchFn>[1]
export type nodeFetch_0 = Parameters<typeof nodeFetchFn>[0]

// The two mappings SOURCE takes for granted, resolved rather than asserted in a comment.
export type nestGetConfig = Parameters<HttpService['get']>[1]
export type nestPostConfig = Parameters<HttpService['post']>[2]
export type gotCallable = typeof gotFn
`,
  { overwrite: true },
)

/**
 * Every module in the probe must resolve. This check is worth exactly as much as its type
 * resolution: a specifier TypeScript cannot find yields a type with no properties, every
 * "this key is absent" assertion then passes vacuously, and the file reports success while
 * checking nothing. One run during development did degrade this way, so it is asserted rather
 * than assumed, once, before any other assertion can be misread.
 */
const unresolved = probe
  .getPreEmitDiagnostics()
  .map((d) => {
    const m = d.getMessageText()
    return typeof m === 'string' ? m : m.getMessageText()
  })
  .filter((m) => /Cannot find module|Cannot find name/.test(m))

const keysOf = (alias: string): ReadonlySet<string> => {
  const decl = probe.getTypeAliasOrThrow(alias)
  // Non-nullable first: an optional parameter's type is `T | undefined`, and a union reports only
  // the properties its members share, which for anything unioned with undefined is none.
  const names = decl
    .getType()
    .getNonNullableType()
    .getProperties()
    .map((s) => s.getName())
  // A type that failed to resolve reports zero properties rather than throwing, which would make
  // every absence assertion below pass vacuously. None of these types is empty.
  expect(
    names.length,
    `${alias} resolved to no properties, so its declarations were not found`,
  ).toBeGreaterThan(5)
  return new Set(names)
}

/**
 * The declared options type for each client kind apiwatch knows about.
 *
 * `nestjs-axios` maps to axios because `HttpService`'s methods forward an `AxiosRequestConfig`
 * verbatim; `request-promise` maps to `request` because it is request's own options object with a
 * promise wrapper around the callback. Both mappings are asserted separately below rather than
 * taken on trust, which is the whole point of this file.
 *
 * node-fetch is checked against v2, the major whose `timeout` the table relies on. v3 gets its
 * own test.
 */
const SOURCE: Record<ClientKind, string> = {
  axios: 'axios',
  'nestjs-axios': 'axios',
  got: 'got',
  fetch: 'fetch',
  'node-fetch': 'nodeFetch2',
  request: 'request',
  'request-promise': 'request',
  'node:http': 'nodeHttp',
}

/**
 * Where the table knowingly disagrees with the current declarations, and why.
 *
 * Each entry is itself asserted: the test fails if the divergence stops being real. That keeps a
 * comment from outliving the reason it was written. If got ever restores `retries`, this entry
 * fails and must be deleted rather than quietly becoming false.
 */
const DIVERGENCES = [
  {
    client: 'got' as const,
    key: 'retries',
    why: "got v9's spelling of `retry`, removed in v11. Kept as proof because dropping it would fire no-retry on a v9 call that really does re-attempt; a stale accepted key costs nothing here, since no other client uses the name.",
  },
]
const diverges = (client: ClientKind, key: string) =>
  DIVERGENCES.some((d) => d.client === client && d.key === key)

describe('the check itself is wired up', () => {
  it('every client declaration file resolves', () => {
    expect(
      unresolved,
      'the probe could not resolve these, so absences below prove nothing',
    ).toEqual([])
  })
})

describe('every option apiwatch reads as proof exists on the client it is handed to', () => {
  for (const kind of Object.keys(CLIENT_OPTIONS) as ClientKind[]) {
    const support = CLIENT_OPTIONS[kind]

    it(`${kind}: timeout support matches the declarations`, () => {
      const keys = keysOf(SOURCE[kind])
      // Direction A when true (a claimed key must exist), direction B when false (an unclaimed
      // key must be absent, or apiwatch is firing on protected calls).
      expect(keys.has('timeout'), `CLIENT_OPTIONS['${kind}'].timeout is ${support.timeout}`).toBe(
        support.timeout,
      )
    })

    it(`${kind}: signal support matches the declarations`, () => {
      const keys = keysOf(SOURCE[kind])
      expect(keys.has('signal'), `CLIENT_OPTIONS['${kind}'].signal is ${support.signal}`).toBe(
        support.signal,
      )
    })

    it(`${kind}: every retry key it accepts as proof is a real option`, () => {
      const keys = keysOf(SOURCE[kind])
      for (const name of support.retry) {
        if (diverges(kind, name)) continue
        expect(
          keys.has(name),
          `${kind} is told '${name}' proves retry, but it declares no such option`,
        ).toBe(true)
      }
    })

    it(`${kind}: no retry option has appeared unnoticed`, () => {
      // Direction B for retry. A client that gains a retry option while its table entry stays
      // empty makes apiwatch report no-retry on calls that do retry: a silent wrong answer in the
      // other direction, and one nothing else here would catch.
      const keys = keysOf(SOURCE[kind])
      for (const name of ['retry', 'retries', 'axios-retry']) {
        if (support.retry.includes(name) || !keys.has(name)) continue
        expect.fail(
          `${kind} declares a '${name}' option that CLIENT_OPTIONS does not accept as proof of retry`,
        )
      }
    })
  }
})

describe('the divergences are real', () => {
  for (const d of DIVERGENCES) {
    it(`${d.client}: '${d.key}' is genuinely absent from the current declarations`, () => {
      expect(
        keysOf(SOURCE[d.client]).has(d.key),
        `the divergence recorded for ${d.client}.${d.key} no longer holds, so delete it: ${d.why}`,
      ).toBe(false)
    })
  }
})

describe('the two facts the table cannot express', () => {
  /**
   * node-fetch is the one row that depends on which major is installed, and `resolveOptions` has
   * no workspace to ask. The table takes v2's answer, so both halves are pinned here: if v3 ever
   * restores `timeout` the ambiguity is gone and the comment on that row should go with it.
   */
  it('node-fetch v2 implements timeout and v3 does not', () => {
    expect(keysOf('nodeFetch2').has('timeout')).toBe(true)
    expect(keysOf('nodeFetch3').has('timeout')).toBe(false)
    // The half that is NOT ambiguous: both majors take a signal, so that row needs no caveat.
    expect(keysOf('nodeFetch2').has('signal')).toBe(true)
    expect(keysOf('nodeFetch3').has('signal')).toBe(true)
  })

  /**
   * The standard fetch is the defect this file found. Asserted directly as well as through the
   * table, so the fact survives a table refactor.
   */
  it('the standard fetch has no timeout option, only a signal', () => {
    const keys = keysOf('fetch')
    expect(keys.has('timeout')).toBe(false)
    expect(keys.has('signal')).toBe(true)
  })
})

/**
 * The other half of the option model: not WHICH keys a client reads, but WHERE apiwatch expects
 * to find them. `configArgIndex` claims a fixed argument position per client and method, and a
 * wrong one is the same class of defect read from the other end: at index 2 for `axios.post` it
 * finds the config, at index 1 it finds the request BODY and reads a domain field named `timeout`
 * out of it.
 *
 * Each claim is checked against the real signature, and so is the position BEFORE it, because an
 * off-by-one is the way this goes wrong. `timeout` is the discriminator rather than the property
 * count: `Parameters<AxiosInstance['get']>[0]` is a string, which has 52 properties of its own.
 *
 * request, request-promise and node:http are absent because they claim no index. Their overloads
 * put options first or second depending on the call, which is why they are resolved by shape (see
 * SHAPE_PROBED); there is no index here to be wrong.
 */
const INDEX_CLAIMS = [
  { label: 'axios.request(config)', at: 'axios_request_0', before: undefined },
  { label: 'axios.get(url, config)', at: 'axios_get_1', before: 'axios_get_0' },
  { label: 'axios.delete(url, config)', at: 'axios_delete_1', before: 'axios_delete_0' },
  { label: 'axios.head(url, config)', at: 'axios_head_1', before: 'axios_head_0' },
  { label: 'axios.post(url, data, config)', at: 'axios_post_2', before: 'axios_post_1' },
  { label: 'axios.put(url, data, config)', at: 'axios_put_2', before: 'axios_put_1' },
  { label: 'axios.patch(url, data, config)', at: 'axios_patch_2', before: 'axios_patch_1' },
  { label: 'fetch(url, init)', at: 'fetch_1', before: 'fetch_0' },
  { label: 'nodeFetch(url, init)', at: 'nodeFetch_1', before: 'nodeFetch_0' },
] as const

/** A config object is recognised by carrying a `signal`, which every client here declares. */
const looksLikeConfig = (alias: string) =>
  probe
    .getTypeAliasOrThrow(alias)
    .getType()
    .getNonNullableType()
    .getProperties()
    .some((sym) => sym.getName() === 'signal')

describe('the argument index apiwatch reads config from is the one the client declares', () => {
  for (const claim of INDEX_CLAIMS) {
    it(`${claim.label}: config is at the claimed position`, () => {
      expect(looksLikeConfig(claim.at), `${claim.label} has no config at that index`).toBe(true)
      if (claim.before)
        expect(
          looksLikeConfig(claim.before),
          `${claim.label} would read the same object one index earlier, so this proves nothing`,
        ).toBe(false)
    })
  }
})

describe('the two type mappings SOURCE takes for granted', () => {
  /**
   * `nestjs-axios` is checked against axios's own config type. That is only sound because
   * HttpService forwards an AxiosRequestConfig verbatim, which is asserted here rather than
   * described in a comment. If Nest ever wraps it, every nestjs-axios row above becomes a claim
   * about the wrong type, and this is what says so.
   */
  it("NestJS HttpService takes axios's own config, at the same indices", () => {
    const axiosKeys = keysOf('axios')
    for (const alias of ['nestGetConfig', 'nestPostConfig']) {
      const keys = keysOf(alias)
      expect([...keys].sort(), `${alias} is not AxiosRequestConfig`).toEqual([...axiosKeys].sort())
    }
  })

  /** `request-promise` is request's options with a promise wrapper, so the keys must be a superset. */
  it("request-promise carries request's own options", () => {
    const rp = keysOf('requestPromise')
    for (const key of ['timeout']) expect(rp.has(key), `request-promise lost '${key}'`).toBe(true)
    expect(rp.has('signal'), 'request-promise gained a signal that request does not have').toBe(
      false,
    )
  })

  /**
   * got resists `Parameters<>`: its callable has 27 overloads and the last one wins, which is
   * `(url: undefined, options: undefined, defaults)`. So the claim that options sit at index 1 is
   * checked by finding the overload that takes a url and asserting what follows it.
   */
  it('got puts options at index 1, in the overload that takes a url', () => {
    const signatures = probe.getTypeAliasOrThrow('gotCallable').getType().getCallSignatures()
    expect(signatures.length, 'got resolved to no call signatures').toBeGreaterThan(0)
    const urlThenOptions = signatures.filter((sig) => {
      const params = sig.getParameters()
      if (params.length < 2) return false
      const first = params[0].getTypeAtLocation(probe).getText()
      return /string|URL/.test(first)
    })
    expect(urlThenOptions.length, 'got declares no (url, options) overload').toBeGreaterThan(0)
    for (const sig of urlThenOptions) {
      const second = sig.getParameters()[1].getTypeAtLocation(probe).getNonNullableType()
      expect(
        second.getProperties().some((sym) => sym.getName() === 'timeout'),
        "got's second argument after a url is not its options object",
      ).toBe(true)
    }
  })
})
