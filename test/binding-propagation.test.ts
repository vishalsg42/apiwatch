import { describe, expect, it } from 'vitest'
import { sitesFor } from './helpers.js'

/**
 * Bindings feed several downstream stages, so wrongly rejecting one does not merely lose a direct
 * call, it cascades: deriveFromCreate needs the base binding, exported instances reach the
 * cross-module registry only if derivation succeeded, class properties depend on it, and
 * axios-retry mutates only an already-present instance. The client matrix exercises direct calls,
 * not these chains, so an allowlist could break them silently.
 */
describe('binding propagation survives the export allowlist', () => {
  it('class property instance still resolves, with its timeout', async () => {
    const s = await sitesFor('binding-propagation', 'class-property.ts')
    expect(s).toHaveLength(1)
    expect(s[0].options.timeoutMs).toBe('instance-default')
  })

  it('axios-retry still binds to the instance it configures', async () => {
    const s = await sitesFor('binding-propagation', 'with-retry.ts')
    expect(s).toHaveLength(1)
    expect(s[0].options.retry).toBe('library')
  })

  it('an exported instance is still resolved across modules', async () => {
    const s = await sitesFor('binding-propagation', 'consumer.ts')
    expect(s).toHaveLength(1)
    expect(s[0].options.timeoutMs).toBe('instance-default')
  })

  // Sharp edge: if this binding were wrongly rejected, importBindsFetch still disables the
  // native-fetch fallback, so the call would vanish silently rather than fall back.
  it('a renamed named fetch import still resolves', async () => {
    const s = await sitesFor('binding-propagation', 'named-fetch.ts')
    expect(s).toHaveLength(1)
    expect(s[0].client).toBe('node-fetch')
  })
})

/**
 * The cross-module registry had the identical latent bug detectClients did: a quoted
 * destructuring key reads back through getText() as "'api'", quotes included, so it matched no
 * exported name and the binding vanished without a word.
 */
describe('quoted destructuring keys in a CommonJS re-export', () => {
  it('resolves a client imported under a string-literal key', async () => {
    const s = await sitesFor('quoted-reexport', 'consumer.js')
    expect(s).toHaveLength(1)
    expect(s[0].options.timeoutMs).toBe('instance-default')
  })
})
