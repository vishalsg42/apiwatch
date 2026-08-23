# Contributing to apiwatch

Please also read the [code of conduct](CODE_OF_CONDUCT.md). Security reports go through
[private advisories](https://github.com/vishalsg42/apiwatch/security/advisories/new), not the
public tracker; see [SECURITY.md](SECURITY.md).

## Reporting a problem

The most valuable reports are about rules being wrong, in either direction:

- **False positive**: a finding on code that is actually protected
- **False negative**: silence on a call that really is unprotected

Both have issue templates. Bring the smallest code shape that reproduces it and the JSON output
from `npx apiwatch audit --root . --json`. A reproduction settles an argument that assertions
cannot, and several rules in this project were narrowed because someone provided one.

Check the README's Limitations section first. Some silences are deliberate, and it says which.

## Dev setup

```
pnpm install
pnpm test
pnpm build
pnpm exec biome check --write .
```

`pnpm test` runs the vitest suite. `pnpm build` runs tsup and produces `dist/cli.js`; some tests
(`test/cli.test.ts`, `test/pack-install.test.ts`) skip themselves when `dist/` is absent, so run
`pnpm build` at least once before you rely on a fully green test run. `pnpm exec tsc --noEmit`
type-checks the project; `pnpm exec biome check .` lints and format-checks it (add `--write` to
auto-fix).

## Adding a rule

This is the highest-value way to contribute. `src/rules/` is the project's contribution surface,
deliberately kept separate from the analysis machinery in `src/static/`.

A rule is a pure function:

```ts
export type Rule = {
  name: string
  severity: 'error' | 'warn' | 'info'
  check(sites: CallSite[], ws: Workspace): Finding[]
}
```

It receives the fully analysed model, an array of `CallSite`s (each already carrying its
client kind, resolved URL, timeout/retry/validation verdicts, and the file's import list) and
the `Workspace` (dependency map, file list). It returns `Finding[]`. That's the whole contract.

A rule must be **pure**: no filesystem access, no ts-morph, no AST traversal, no network calls.
Everything a rule could plausibly need has already been extracted onto `CallSite` or
`CallOptions` by an earlier analysis phase (`src/static/callsites.ts`, `options.ts`, `urls.ts`,
`validation.ts`). If your rule needs a new signal that isn't on `CallSite` yet, that's a sign the
signal belongs in the static analysis layer, not stuffed into the rule itself. Add the field to
`CallOptions`/`CallSite` in `src/model.ts`, populate it during the relevant analysis pass, then
read it from your pure rule. This split is what keeps rules trivially testable: a rule test builds
a plain `CallSite` object and calls `check()` directly, no parsing involved.

To add a rule:

1. Write it in `src/rules/index.ts` (or split into its own file and re-export, if it's substantial),
   following the shape above. Use the `F(...)` helper to build `Finding`s consistently. It takes a sixth `fingerprint`
argument that defaults to the call site's. A rule that fires once per FILE rather than once per
call must pass `fileFingerprint(rule, file)` instead, or its baseline entry re-keys whenever
calls in that file are reordered. `deprecatedClient` and `legacyClient` both do this.
2. Register it in the `rules` array near the bottom of that file, so `runRules` picks it up.
3. Add a fixture under `test/fixtures/<your-fixture-name>/` (a tiny standalone package with its
   own `package.json` and `src/`), demonstrating the exact call shape your rule should flag or
   stay silent on. Keep fixtures minimal and single-purpose; look at existing fixtures for the
   pattern.
4. Add a test in `test/rules.test.ts` (or a new `test/<rule>.test.ts` for anything with a lot of
   surface area, e.g. how `test/options.test.ts` and `test/validation.test.ts` are split out)
   exercising the rule against both a case that should fire and a case that should stay silent.

## Two hard project conventions

Both of these were learned the expensive way, by shipping the wrong thing first and then fixing
it. Please don't reintroduce either.

### 1. No type-checker APIs

Never call `getType()`, `getSymbol()`, `findReferences()`, `getTypeChecker()`, or anything else
that forces TypeScript to resolve types. Projects in this codebase are built with `noResolve: true`
and `noLib: true` specifically so that a type-checker call fails loudly instead of quietly working
but being slow.

This isn't a style preference, it's measured. On a real 316-file repo, forcing type resolution
across 120 files cost 3,540ms and 492MB, versus 646ms and 288MB for the equivalent pure-syntax
walk: 5.5x slower and +204MB, for analysis that apiwatch's rules don't actually need. Every signal
this tool reports (timeout presence, retry config, response validation, hardcoded hosts) is
readable from syntax alone. If you find yourself reaching for the type checker, look for the
syntactic shape instead; it's almost always there.

### 2. Never detect structure with a regex over a node's or file's source text

A regex over `node.getText()` or a whole file's text will match a comment, a string literal, or a
nested/unrelated property with the same name, and report a false positive or a false negative
that's very hard to notice because the code "looks right" at a glance. This exact bug class (a
regex matching a coincidental substring instead of the real syntactic structure) was found and
fixed four separate times during initial development: a `retry` mention inside a comment being
read as a retry option, a nested `proxy: { url: '...' }` being read as the call's own URL, a
`TODO: add timeout` comment being read as a timeout, and a type name substring-matching an
unrelated variable name. Walk the AST (`ts-morph` nodes, `SyntaxKind`, `getProperty()`,
`getDescendantsOfKind()`) to find the real property or expression, and only read text off the
specific node you've already proven is the right one.

## Prefer silence to a wrong finding

When a signal can't be determined statically, the correct verdict is "unknown" or "no finding",
not a guess. A wrong finding erodes trust in every other finding the tool produces.

But the inverse deserves equal weight: silently *suppressing* a finding that should have fired is
just as much a defect, and it's much harder to notice, because nothing appears in the output to
prompt a second look. An earlier heuristic treated any `for`/`while` loop ancestor around a call as
evidence of a hand-rolled retry loop, and suppressed the `no-retry` warning on that basis. Measured
against a real repo, this misclassified ordinary pagination loops as retry logic and silently
suppressed 22 of 93 genuine `no-retry` findings. It was removed for exactly that reason; a rule
that only ever adds a `'unknown'` escape hatch and never subtracts a real finding is much easier
to reason about than one that can silently swallow a real result. If you're tempted to add a new
"this pattern means it's actually fine" exception to an existing rule, ask whether it could instead
be masking a real gap, and look for a measured false-positive rate before adding it.

## Never assume ESM

A large share of real-world code that touches HTTP is CommonJS, and `sf.getImportDeclarations()`
returns `[]` for a CommonJS file; it only sees ESM `import` statements. Much real-world code that
touches HTTP is plain JavaScript, a large share of it CJS. Any analysis
that needs "what does this file import" (to detect a validator library, a deprecated client, a
cross-module binding) must go through `collectFileImports` in `src/static/imports.ts`, which
covers both ESM `import` specifiers and CommonJS `require(...)` calls. Reaching for
`sf.getImportDeclarations()` directly is a common way to introduce a silent CJS blind spot, and it
has caused two shipped bugs: `@nestjs/axios` was ESM-only, and a destructured
`const { request } = require('node:http')` bound nothing at all because
`VariableDeclaration.getName()` returns the pattern source text for a destructuring binding.
Several of the fixtures under `test/fixtures/` (the `cjs-*` and `ambiguous-cjs` ones) exist to
catch this regression.

## Fixtures are excluded from lint and typecheck on purpose

`test/fixtures/**` is excluded from both `biome check` (see `biome.json`'s `files.includes`) and
`tsc --noEmit` (see `tsconfig.json`'s `exclude`). This is deliberate, not an oversight: fixtures
are analysis *input*, not shipped code. Several fixtures (`broken-syntax`, for example) are
intentionally malformed, to prove apiwatch degrades gracefully on source it can't fully parse.
Don't "fix" a fixture to satisfy the linter; if biome or tsc complains about something under
`test/fixtures/`, that's expected.

## Releasing

Publishing is automated. To cut a release:

1. Bump `version` in `package.json` and commit it to `main`.
2. Create a GitHub Release tagged `v<version>` (for example `v0.1.1`).

The `Release` workflow then typechecks, lints, builds, runs the full suite, packs
the tarball and verifies the installed binary runs through its `node_modules/.bin`
symlink, refuses to republish an existing version, and finally publishes to npm
with provenance.

It needs one repository secret, `NPM_TOKEN`: a granular access token scoped to
this package with read and write permission. Scope it to `apiwatch` only and set
an expiry rather than using an unscoped permanent token.
