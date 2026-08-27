import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * A NestJS timeout is configured where the module is wired, not where the call is written:
 *
 *   @Module({ imports: [HttpModule.register({ timeout: 5000 })], providers: [CatsService] })
 *
 * Every call `CatsService` makes through its injected `HttpService` carries that deadline, so
 * reporting `no-timeout` against it is an error-severity false positive on correctly protected
 * code. See #8.
 *
 * The join has to be module-scoped rather than repository-wide. `@nestjs/core` builds a dynamic
 * module's token from a hash of its own metadata (DeepHashedModuleOpaqueKeyFactory.createForDynamic
 * hashes `{ id, module, dynamic }`), while a static import is keyed by `${moduleId}_${moduleName}`
 * alone. So `HttpModule.register({ timeout })` and a bare `HttpModule` are different tokens, hence
 * different instances, and a bare import really does get an unconfigured client. Silencing every
 * NestJS call site the moment one module registers a timeout would suppress that true finding.
 */
const timeoutOf = async (file: string, fixture = 'nestjs-module-timeout') => {
  const sites = await sitesFor(fixture, file)
  expect(sites, `expected exactly one call site in ${file}`).toHaveLength(1)
  return sites[0].options.timeoutMs
}

describe('a timeout registered on the module reaches the calls it configures', () => {
  it('silences a provider of a module that registers a timeout', async () => {
    expect(await timeoutOf('cats.service.ts')).toBe('instance-default')
  })

  it('still fires for a provider of a module that imports HttpModule bare', async () => {
    // The discriminating case. A bare import is a different module token, so it resolves to an
    // unconfigured HttpService even when a sibling module registers a timeout.
    expect(await timeoutOf('dogs.service.ts')).toBeNull()
  })

  it('treats registerAsync as unreadable rather than absent', async () => {
    // The options come from a factory, so the value cannot be read. Not proof of absence.
    expect(await timeoutOf('birds.service.ts')).toBe('unknown')
  })

  it('reads timeout: 0 as axios does, meaning no timeout at all', async () => {
    expect(await timeoutOf('fish.service.ts')).toBeNull()
  })

  it('follows a wrapper module that registers and re-exports HttpModule', async () => {
    // The shape ultimate-nest ships: NestHttpModule registers, exports HttpModule, and
    // SharedModule imports NestHttpModule.
    expect(await timeoutOf('shared.service.ts')).toBe('instance-default')
  })

  it('covers controllers, which are instantiated in the module context too', async () => {
    expect(await timeoutOf('owls.controller.ts')).toBe('instance-default')
  })

  it('leaves a file no module claims alone when no configured module is opaque', async () => {
    // NoisyModule sits in this fixture with an unreadable `imports` AND an unreadable
    // `providers`. Because it never names HttpModule it cannot be a registration, so it must not
    // set the repository-wide abstain. Reading any unreadable imports array as a possible
    // registration silenced 7 true findings in novu before this was gated.
    expect(await timeoutOf('stray.service.ts')).toBeNull()
  })

  it('still reports through a module whose arrays are unreadable but names no HttpModule', async () => {
    // The same guard from the other side: dogs is genuinely unprotected and stays reported even
    // though an opaque module sits in the same workspace.
    expect(await timeoutOf('dogs.service.ts')).toBeNull()
  })
})

describe('a @Global() module reaches modules that never import it', () => {
  // sf-nest-admin's shape, and the case that made this necessary: a @Global() SharedModule
  // registers `timeout: 5000` and re-exports HttpModule, and NetDiskOverviewService receives it
  // through a module (NetDiskModule) whose imports never mention HttpModule at all. Without
  // this, four no-timeout findings fired at error severity against protected code.
  it('silences a provider of a module with no HttpModule edge of its own', async () => {
    expect(await timeoutOf('reader.service.ts', 'nestjs-global-module')).toBe('instance-default')
  })

  it('still fires where a module imports HttpModule bare for itself', async () => {
    // An explicit import resolves in that module's own context, so it is that module's own
    // unconfigured instance and beats what the global module exports.
    expect(await timeoutOf('own.service.ts', 'nestjs-global-module')).toBeNull()
  })
})

describe('a configured module whose providers cannot be read', () => {
  it('cannot prove absence for a file it might provide', async () => {
    // `providers: [...USE_CASES]` spreads an imported constant, so membership is unreadable and a
    // timeout IS registered. Firing here would be a guess in the one direction that breaks CI.
    expect(await timeoutOf('mice.service.ts', 'nestjs-module-opaque')).toBe('unknown')
  })
})
