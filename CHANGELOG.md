# Changelog

Notable changes per release. Dates are release dates. Full notes for each version are on the
[releases page](https://github.com/vishalsg42/apiwatch/releases).

apiwatch is pre-1.0, so minor versions may change behaviour. Each entry says whether to expect
more findings or fewer after upgrading, because a change in finding count is otherwise
indistinguishable from a regression.

## 0.3.3 (2026-08-23)

**Expect more findings on CommonJS codebases.** Three import shapes were silently invisible.

**If you have a committed baseline and your code uses CommonJS, this release will fail your
build.** Previously invisible call sites become findings, so the baseline does not cover them.
That is the fix working. Run `apiwatch baseline accept` to take them on, after reviewing what it
prints. The README's workflow now pins an exact version so this cannot happen on a bump you did
not make.

- **Destructured `require` bound no client at all.** `VariableDeclaration.getName()` returns the
  pattern source text for a destructuring binding (`"{ request }"`), which can never match a call
  site, so `const { request } = require('node:http')`, `const { got } = require('got')` and
  `const { default: axios } = require('axios')` all resolved to zero call sites. The last is the
  standard CJS interop idiom for an ESM default. Measured on one real backend: 93 call sites
  became 110, none lost.
- **`const fetch = require('node-fetch')` resolved to zero call sites**, because the per-call
  shadow walk ran before the resolved client was consulted and treated the declaration as
  shadowing the global.
- **`@nestjs/axios` detection was ESM-only.** Narrower in practice than it sounds, since compiled
  output is skipped and carries no type annotations.
- **A new client-by-import-shape test matrix** (14 fixtures) now enforces what CONTRIBUTING only
  documented. It found the `node-fetch` bug above.
- **The Markdown report hid baseline suppression.** `audit --baseline --write-report` wrote a
  committed file with an empty summary and empty findings table and no hint that anything had
  been suppressed, indistinguishable from a clean repo.
- **Six documentation claims corrected**, including a README output block that declared 15
  findings while showing 7. Both documented output blocks are now pinned by tests.

## 0.3.2 (2026-08-23)

Documentation only, no behaviour change.

- Records a verified monorepo limitation: dependency versions are merged across every package in
  filesystem walk order, last one wins, so `deprecated-client` and `legacy-client` can miss real
  findings or report them against the wrong package. Workaround: audit one package at a time.

## 0.3.1 (2026-08-23)

Three gaps, all in the direction that loses safety silently.

- `audit --baseline` now refuses a partial run (exit 2). Previously only baseline *generation*
  was gated, so a file that failed to analyse contributed no findings, was matched against
  nothing, and CI went green on a repo nobody fully looked at.
- Unreadable directories are counted rather than silently swallowed. Their files were never
  discovered, so nothing could tell "no findings there" from "could not look".
- An unreadable directory no longer crashes the run with a raw `EACCES` stack trace.
  `addSourceFilesAtPaths` was treating its argument as a glob and re-walking the tree that
  `discoverWorkspace` had already produced.

## 0.3.0 (2026-08-23)

**The CI guard.** Record what exists today, fail only on what is new.

- `apiwatch baseline`, `baseline prune`, `baseline accept`
- `apiwatch audit --baseline <file>` reports only findings absent from the baseline
- Fixing a finding never fails the build; its entry is reported as resolved, not enforced
- A missing `--baseline` path is an error (exit 2), never an empty baseline
- Baseline generation fails closed on a partial run unless `--allow-partial`

## 0.2.0 (2026-08-23)

**Expect no change in findings.** Adds identity; nothing consumes it yet.

- Adds `Finding.fingerprint`, a position-independent identity that survives line insertions,
  reformatting, quote-style flips and reordering. `CallSite.id` is unchanged.
- `schemaVersion` 1 to 2, because a field was added
- Fixes the severity comparator, which was not antisymmetric once `info` existed and printed
  `info` above `warn` in real reports

## 0.1.4 (2026-08-23)

**Expect a quieter default gate.**

- A mistyped `--root` no longer passes as a clean audit. Invalid roots, missing flag values,
  unknown flags and a bad `--fail-on` all exit 2. This was the worst failure a CI guard can
  have: the build passed precisely because nothing was examined.
- `no-timeout` becomes the only rule that can fail a default gate. `hardcoded-host` and
  `unvalidated-response` move to a new `info` severity that never fails CI
- `node-fetch@2` splits out of `deprecated-client` into `legacy-client` (info). `request` was
  formally deprecated in 2020; `node-fetch@2` never was
- `no-retry` asks rather than asserts: failing fast is often correct
- `http.get({ timeout })`, `timeout: null` and `timeout: undefined` are now read correctly
- Removes the unused `citty` dependency; `ts-morph` is the only runtime dependency

## 0.1.3 (2026-08-23)

**Expect more findings.** The ones that appear were being wrongly suppressed.

- `axios.create({ timeout: 0 })` and `got(..., { retry: { limit: 0 } })` no longer read as
  protected. `0` disables the option, but only its presence was being checked
- `.apiwatch/audit.md` is no longer written on every run; it needs `--write-report`
- Corrects the claim that calls "hang indefinitely". Measured on Node 24, a native `fetch`
  against a server that never responds rejects after 301.3s with `UND_ERR_HEADERS_TIMEOUT`

## 0.1.2 (2026-08-23)

**Expect fewer findings.** The ones that disappear were mostly not real.

- A locally imported `fetch` is no longer read as native fetch. Wrapping fetch in a module is a
  common house pattern; measured on Outline, 32 call sites and 24 findings became 8 and 6
- Hand-rolled retry loops make `no-retry` abstain instead of warning. On one backend that
  hand-rolls retry in every provider, 68% of `no-retry` findings were wrong

## 0.1.1 (2026-08-22)

- Fixes a false positive where a config passed as a variable was read as having no timeout
- Introduces the `unknown` verdict, so a rule stays silent when it cannot prove a finding

## 0.1.0

First release. Static audit of outbound HTTP calls for missing timeouts, retry and response
validation across axios, native fetch, node-fetch, request, request-promise, got, `@nestjs/axios`
and `node:http`.
