import { dirname, resolve } from 'node:path'
import {
  type ArrayLiteralExpression,
  type Expression,
  type Node,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'
import { hasEnabledProp, TIMEOUT_PROPS } from './clients.js'

/**
 * `configured` a timeout was read off an `HttpModule.register({ ... })` in this module's imports
 * `unknown`    an HttpModule IS wired here but its options cannot be read (registerAsync, a
 *              variable, a spread). Not proof of a timeout, and not proof of absence either.
 */
export type ModuleTimeout = 'configured' | 'unknown'

export type NestModules = {
  /**
   * Ext-stripped absolute file path -> the verdict of a module that lists it as a member.
   * `bare` records an explicit unconfigured HttpModule import, which beats a global module.
   */
  byFile: Map<string, ModuleTimeout | 'bare'>
  /**
   * A `@Global()` module that exports a configured HttpModule. Its exports reach every module in
   * the application with no `imports` edge, so it is the fallback for any file no module claims.
   */
  globalConfigured: ModuleTimeout | null
  /**
   * Some module reached a configured HttpModule but its own member list could not be read, so
   * any file could be one of its providers. Without this, a repository that writes
   * `providers: [...USE_CASES]` (novu's shape) keeps the very false positive this exists to fix.
   */
  opaqueConfigured: boolean
}

export const EMPTY_NEST_MODULES: NestModules = {
  byFile: new Map(),
  globalConfigured: null,
  opaqueConfigured: false,
}

const stripExt = (p: string) => p.replace(/\.(m|c)?[jt]sx?$/, '')
const keyOf = (file: string, name: string) => `${file}#${name}`

/** `configured` outranks `unknown`: a read timeout is stronger evidence than an unread one. */
const stronger = (a: ModuleTimeout | null, b: ModuleTimeout | null): ModuleTimeout | null =>
  a === 'configured' || b === 'configured' ? 'configured' : (a ?? b)

type ModuleRecord = {
  /** A timeout wired into this module's OWN imports, before following any other module. */
  own: ModuleTimeout | null
  /** This module imports HttpModule itself but unconfigured, which beats a global export. */
  ownBare: boolean
  /** `@Global()`: this module's exports reach every module without an imports edge. */
  isGlobal: boolean
  /** `exports: [HttpModule]` hands this module's HttpService to whoever imports it. */
  reexportsHttp: boolean
  /** Keys of modules named in `imports`, which may re-export a configured HttpModule. */
  importedModules: string[]
  /** Keys of modules named in `exports`, which pass a re-export along one more level. */
  exportedModules: string[]
  /** Ext-stripped paths of the files declaring this module's providers and controllers. */
  memberFiles: string[]
  /** Whether every entry of `providers` and `controllers` was resolved to a file. */
  membersComplete: boolean
}

/**
 * The file an identifier used inside a `@Module({ ... })` refers to, resolved the same way
 * static/registry.ts resolves a client across modules: local relative specifiers only, no type
 * checker. A name this file declares itself resolves to this file.
 */
function targetOf(sf: SourceFile, name: string): string | undefined {
  for (const d of sf.getImportDeclarations()) {
    if (d.isTypeOnly()) continue
    const spec = d.getModuleSpecifierValue()
    if (!spec.startsWith('.')) continue
    const target = stripExt(resolve(dirname(sf.getFilePath()), spec))
    for (const n of d.getNamedImports()) {
      if (n.isTypeOnly()) continue
      if ((n.getAliasNode()?.getText() ?? n.getName()) === name) return target
    }
    if (d.getDefaultImport()?.getText() === name) return target
  }
  const self = stripExt(sf.getFilePath())
  if (sf.getClass(name) || sf.getVariableDeclaration(name)) return self
  return undefined
}

/** The array literal behind `name`, when `name` is a const in this same file. */
function localArray(sf: SourceFile, name: string): ArrayLiteralExpression | undefined {
  const init = sf.getVariableDeclaration(name)?.getInitializer()
  return init?.getKind() === SyntaxKind.ArrayLiteralExpression
    ? (init as ArrayLiteralExpression)
    : undefined
}

/**
 * The entries of `obj.<key>`, flattening a spread of a local const array (`imports: [...MODULES]`,
 * which is how novu writes it). `complete` is false when any entry could not be read, which is
 * the difference between "this module has no timeout" and "this module might have one".
 */
function arrayProp(
  sf: SourceFile,
  obj: ObjectLiteralExpression,
  key: string,
): { items: Expression[]; complete: boolean } {
  const pa = obj.getProperty(key)
  if (!pa) return { items: [], complete: true }
  if (pa.getKind() !== SyntaxKind.PropertyAssignment) return { items: [], complete: false }

  const init = pa.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  let arr: ArrayLiteralExpression | undefined
  if (init?.getKind() === SyntaxKind.ArrayLiteralExpression) arr = init as ArrayLiteralExpression
  else if (init?.getKind() === SyntaxKind.Identifier) arr = localArray(sf, init.getText())
  if (!arr) return { items: [], complete: false }

  const items: Expression[] = []
  let complete = true
  for (const el of arr.getElements()) {
    if (el.getKind() !== SyntaxKind.SpreadElement) {
      items.push(el)
      continue
    }
    const inner = el.asKindOrThrow(SyntaxKind.SpreadElement).getExpression()
    const spread = inner.getKind() === SyntaxKind.Identifier && localArray(sf, inner.getText())
    if (!spread) {
      complete = false
      continue
    }
    for (const e of spread.getElements())
      if (e.getKind() === SyntaxKind.SpreadElement) complete = false
      else items.push(e)
  }
  return { items, complete }
}

/**
 * Whether this file binds `HttpModule` from `@nestjs/axios` at all. Purely syntactic, and the
 * gate that keeps an unreadable `imports` array from being read as a possible registration.
 */
function importsHttpModule(sf: SourceFile): boolean {
  return sf
    .getImportDeclarations()
    .some(
      (d) =>
        d.getModuleSpecifierValue() === '@nestjs/axios' &&
        !d.isTypeOnly() &&
        d.getNamedImports().some((n) => !n.isTypeOnly() && n.getName() === 'HttpModule'),
    )
}

/** `HttpModule`, `HttpModule.register(...)`, or neither. */
function httpVerdict(item: Node): ModuleTimeout | null | 'not-http' {
  if (item.getKind() === SyntaxKind.Identifier)
    // A bare `imports: [HttpModule]` is a STATIC module token, so it resolves to an HttpService
    // with axios's own defaults, and axios defaults to no timeout. Proven absent, not unknown.
    return item.getText() === 'HttpModule' ? null : 'not-http'

  if (item.getKind() !== SyntaxKind.CallExpression) return 'not-http'
  const call = item.asKindOrThrow(SyntaxKind.CallExpression)
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return 'not-http'
  const pae = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
  if (pae.getExpression().getText() !== 'HttpModule') return 'not-http'

  const method = pae.getName()
  // registerAsync builds its options in a factory, a class, or an existing provider, none of
  // which is readable here. A timeout may well be set, so absence is not proven.
  if (method !== 'register') return 'unknown'

  const arg = call.getArguments()[0]
  // `register()` with no options is the same unconfigured instance as a bare import.
  if (!arg) return null
  if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return 'unknown'
  // hasEnabledProp, not mere presence: `register({ timeout: 0 })` is axios's "no timeout".
  return hasEnabledProp(arg as ObjectLiteralExpression, TIMEOUT_PROPS) ? 'configured' : null
}

/** Every `@Module({ ... })` class in the workspace, keyed by declaring file and class name. */
function collectModules(projects: { project: Project }[]): Map<string, ModuleRecord> {
  const out = new Map<string, ModuleRecord>()
  for (const { project } of projects)
    for (const sf of project.getSourceFiles()) {
      const self = stripExt(sf.getFilePath())
      for (const cls of sf.getClasses()) {
        const dec = cls.getDecorator('Module')
        const arg = dec?.getArguments()[0]
        if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue
        const obj = arg as ObjectLiteralExpression
        const name = cls.getName()
        if (!name) continue

        const imports = arrayProp(sf, obj, 'imports')
        let own: ModuleTimeout | null = null
        let ownBare = false
        const importedModules: string[] = []
        for (const item of imports.items) {
          const v = httpVerdict(item)
          if (v !== 'not-http') {
            if (v === null) ownBare = true
            own = stronger(own, v)
            continue
          }
          // `SomeModule` or `SomeModule.forRoot()`: a module reference either way.
          const head =
            item.getKind() === SyntaxKind.CallExpression
              ? item.asKindOrThrow(SyntaxKind.CallExpression).getExpression()
              : item
          const ref =
            head.getKind() === SyntaxKind.PropertyAccessExpression
              ? head.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression().getText()
              : head.getText()
          const t = /^[A-Za-z_$][\w$]*$/.test(ref) ? targetOf(sf, ref) : undefined
          if (t) importedModules.push(keyOf(t, ref))
        }
        // An unreadable entry in `imports` could itself be a configured HttpModule, but only if
        // this file can name one at all. Without that gate every module whose imports are
        // assembled elsewhere (`imports: [...IMPORTS]`, novu's shared module) counted as maybe
        // configured, and because an unreadable member list then sets opaqueConfigured for the
        // whole repository, one such module silenced 7 true findings in a backend measured here.
        // A file that never imports HttpModule cannot register one; it can only import a module
        // that re-exports one, which is followed above whenever that reference is readable.
        if (!imports.complete && own === null && importsHttpModule(sf)) own = 'unknown'

        const exports = arrayProp(sf, obj, 'exports')
        let reexportsHttp = false
        const exportedModules: string[] = []
        for (const item of exports.items) {
          if (item.getKind() !== SyntaxKind.Identifier) continue
          const n = item.getText()
          if (n === 'HttpModule') {
            reexportsHttp = true
            continue
          }
          const t = targetOf(sf, n)
          if (t) exportedModules.push(keyOf(t, n))
        }

        const memberFiles: string[] = []
        let membersComplete = true
        for (const k of ['providers', 'controllers'] as const) {
          const got = arrayProp(sf, obj, k)
          if (!got.complete) membersComplete = false
          for (const item of got.items) {
            if (item.getKind() !== SyntaxKind.Identifier) {
              // `{ provide: X, useClass: Y }` and friends: a member we cannot place.
              membersComplete = false
              continue
            }
            const t = targetOf(sf, item.getText())
            if (t) memberFiles.push(t)
            else membersComplete = false
          }
        }

        out.set(keyOf(self, name), {
          own,
          ownBare,
          isGlobal: !!cls.getDecorator('Global'),
          reexportsHttp,
          importedModules,
          exportedModules,
          memberFiles,
          membersComplete,
        })
      }
    }
  return out
}

/**
 * Maps every file whose NestJS providers reach a configured HttpModule.
 *
 * Two passes, mirroring static/registry.ts: collect what each `@Module` declares, then resolve
 * across modules. `configured(M)` follows M's own imports and then any module it imports that
 * re-exports HttpModule, which is the wrapper shape ultimate-nest ships.
 */
export function buildNestModules(projects: { project: Project }[]): NestModules {
  const mods = collectModules(projects)
  // A barrel (`./services` -> `./services/index`) resolves the same way registry.apply does.
  const record = (k: string) => {
    const hit = mods.get(k)
    if (hit) return hit
    const [file, name] = k.split('#')
    return mods.get(keyOf(`${file}/index`, name))
  }

  const configuredMemo = new Map<string, ModuleTimeout | null>()
  const providesMemo = new Map<string, ModuleTimeout | null>()

  /** What M makes visible to a module that imports it. */
  const provides = (k: string, seen: Set<string>): ModuleTimeout | null => {
    if (providesMemo.has(k)) return providesMemo.get(k) ?? null
    if (seen.has(k)) return null
    seen.add(k)
    const m = record(k)
    if (!m) return null
    let v: ModuleTimeout | null = m.reexportsHttp ? configured(k, seen) : null
    for (const e of m.exportedModules) v = stronger(v, provides(e, seen))
    providesMemo.set(k, v)
    return v
  }

  /** What M's own providers and controllers receive. */
  const configured = (k: string, seen: Set<string>): ModuleTimeout | null => {
    if (configuredMemo.has(k)) return configuredMemo.get(k) ?? null
    const m = record(k)
    if (!m) return null
    let v = m.own
    for (const i of m.importedModules) v = stronger(v, provides(i, new Set(seen)))
    configuredMemo.set(k, v)
    return v
  }

  const byFile = new Map<string, ModuleTimeout | 'bare'>()
  let opaqueConfigured = false
  let globalConfigured: ModuleTimeout | null = null
  for (const [k, m] of mods) {
    // A `@Global()` module's EXPORTS reach every module with no imports edge, so what it provides
    // is the fallback for any file no module claims. sf-nest-admin's SharedModule is `@Global()`,
    // registers timeout 5000 and re-exports HttpModule, and the modules that consume it never
    // mention HttpModule at all, so without this four calls reported no-timeout at error
    // severity against protected code.
    if (m.isGlobal) globalConfigured = stronger(globalConfigured, provides(k, new Set()))

    const v = configured(k, new Set())
    if (v) {
      if (!m.membersComplete) opaqueConfigured = true
      for (const f of m.memberFiles) {
        const prev = byFile.get(f)
        byFile.set(f, stronger(prev === 'bare' ? null : (prev ?? null), v) as ModuleTimeout)
      }
      continue
    }
    // No configured HttpModule reached this module, but it imports one itself. That is its own
    // unconfigured instance, and it beats whatever a global module exports.
    if (m.ownBare) for (const f of m.memberFiles) if (!byFile.has(f)) byFile.set(f, 'bare')
  }
  return { byFile, globalConfigured, opaqueConfigured }
}

/**
 * The verdict for a file that injects `HttpService`, or undefined to leave it alone.
 *
 * Precedence follows how Nest resolves the provider: the module that declares the file wins, then
 * a `@Global()` module's exports, then `opaqueConfigured`, which is silent only when some
 * configured module's membership was unreadable and this file might be one of its providers.
 */
export function moduleTimeoutFor(nest: NestModules, filePath: string): ModuleTimeout | undefined {
  const own = nest.byFile.get(stripExt(filePath))
  // An explicit HttpModule import resolves in that module's own context, so an unconfigured one
  // stays unconfigured even when a global module exports a configured HttpService.
  if (own === 'bare') return undefined
  return own ?? nest.globalConfigured ?? (nest.opaqueConfigured ? 'unknown' : undefined)
}
