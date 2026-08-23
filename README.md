# apiwatch

[![CI](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/vishalsg42/apiwatch)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/apiwatch.svg)](https://www.npmjs.com/package/apiwatch)

A zero-config CLI that statically audits outbound third-party HTTP calls in your Node/TypeScript repo: no timeout, no retry, no response validation, parses each file once with no type resolution, and never runs your code.

```
npx apiwatch audit
```

No install needed for that. To add it to a project instead:

```
npm i -D apiwatch
```

## Before

An outbound call with no timeout has **no deadline of its own**. It does not necessarily hang
forever, and this README is careful not to claim that: measured on Node 24, a native `fetch`
against a server that accepts the connection and never responds rejects after **301.3 seconds**
with `UND_ERR_HEADERS_TIMEOUT`, because undici applies a ~300s header timeout underneath.

That is the *good* case. axios sets no application timeout at all (its default is `0`), so what
bounds an axios call is the socket and the vendor, not your code. Either way the call outlives
any request a user is waiting on: your gateway returns a 504 long before, while the outbound
socket stays open and keeps its resources.

```js
// src/proxy/vendor.js
const res = await fetch(`${VENDOR_BASE}/score/${id}`)
const data = await res.json()
```

Nothing here is wrong syntactically. It ships, it works in staging, and it takes down a request thread in production the first time the vendor stalls.

## After

Real output against [Outline](https://github.com/outline/outline) (v1.9.1, commit `d77dcdf`), a
self-hosted knowledge base. Nothing here is anonymised, so you can check every line yourself:

```
git clone --depth 1 https://github.com/outline/outline
npx apiwatch audit --root outline
```

```
  analysed 2144 of 2144 files · 8 outbound call sites
  skipped 15 files in example/benchmark/doc dirs (--include-non-shipping to audit them)

  ✖ no-timeout                6
  ⚠ no-retry                  6
  ⚠ deprecated-client         1
  ⚠ unvalidated-response      2

  app/components/Lightbox.tsx:663  fetch call sets no timeout, so it has no deadline of its own
  plugins/notion/server/notion.ts:199  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/lib/FileHelper.ts:56  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/lib/FileHelper.ts:385  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/nodes/Image.tsx:90  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/plugins/UploadPlugin.ts:112  fetch call sets no timeout, so it has no deadline of its own
  app/components/Lightbox.tsx:663  no retry or backoff: one transient failure becomes an error
```

**Eight call sites in a 2144-file codebase is the interesting number.** Outline routes its
server-side HTTP through one wrapper, `server/utils/fetch.ts`, which adds SSRF filtering, proxy
support and an optional timeout. Eleven files import it. apiwatch reports none of those calls,
because a call into a local wrapper is not a call it can judge: the wrapper takes a `timeout`
option, so whether a given caller is protected is not visible at the call site.

That silence is the point. An earlier version read that wrapper as native `fetch` and reported
32 call sites with 24 `no-timeout` findings against code it had no business flagging. Three
quarters were wrong. A tool that cannot tell a wrapper from the global is not conservative, it
is loud.

What survives is genuinely unwrapped: mostly browser-side (`Lightbox`, `Image`, `FileHelper`),
where a missing timeout matters less than on a server, plus one server-side call in the Notion
plugin. Read that as a well-run codebase with little to fix, not as a demonstration of carnage.

## Measuring a corpus

`scripts/scan-corpus.ts` runs the audit across many repositories and reports aggregates only,
keeping no per-repo identity. An earlier 100-repo run is not quoted here: it was measured before
apiwatch could tell a local `fetch` wrapper from the global, so its totals counted wrapped calls
as unprotected. The rerun is outstanding, and no ecosystem-wide claim belongs in this README
until it is done.

## Development

To work on apiwatch itself (not to use it as a dependency, see the install line above for that), this repo uses [pnpm](https://pnpm.io):

```
pnpm install
pnpm test
pnpm build
```

(Running `npm install` against this repo's own lockfile is not supported; the lockfile and `node_modules` layout here are managed by pnpm. This has no bearing on installing the published package, which works fine with `npm i -D apiwatch`.)

## Usage

```
npx apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
```

- `--root <dir>`: audit a directory other than the current one.
- `--json`: emit the machine-readable report (`schemaVersion`, `findings[]`, per-rule counts) instead of the terminal report.
- `--fail-on error|warn`: exit non-zero when findings of that severity or above exist, for wiring into CI.
- `--fail-on error|warn` / `--root` / `--json` are validated: an unknown flag, a missing flag value, a bad `--fail-on`, or a root that does not exist or is not a directory exits `2` rather than reporting a clean audit.
- `--write-report`: write `.apiwatch/audit.md`. Without it the audit only reads, leaving the audited repo untouched.
- `--include-non-shipping`: also audit `example/`, `benchmark/`, `docs/` and similar directories. They are skipped by default because a missing timeout in sample code cannot page anyone; see Limitations for what that heuristic does and does not catch.

apiwatch never executes your code. It parses source with the TypeScript compiler API, resolves HTTP client bindings (including ones imported across modules, including barrel index files, and instances built with `axios.create()`), and reports based on what's statically knowable at each call site.

Try it against a small, realistic example service (some calls unprotected, one correctly protected and silent) with:

```
npx apiwatch audit --root examples/vulnerable-service
```

See [`examples/vulnerable-service`](./examples/vulnerable-service) for what it demonstrates and the real output.

## Rules

| rule | severity | flags |
|---|---|---|
| `no-timeout` | error | call has no `timeout` option, no `AbortSignal.timeout()`, and no instance-level default; stays silent when the options object isn't statically readable (an options object passed as a variable, a spread, a conditional, ...), since that's neither proof of a timeout nor proof of its absence |
| `no-retry` | warn | idempotent call (`get`/`head`/`options`/`put`/`delete`) has no library-backed retry; also flags a call whose method can't be statically determined at all, on the assumption that an unreadable method is safer to warn on than to silently skip; a property-access `.options()` call is never tracked as a call site in the first place, so it can only ever be flagged via an explicit `method: 'options'` in a bare call's config object. Like `no-timeout`, it stays silent when the options object itself isn't statically readable |
| `unvalidated-response` | warn | response body is used without reaching a schema validator (zod/Joi/yup/ajv/class-validator) |
| `deprecated-client` | warn | file imports the unmaintained `request` or `request-promise` packages, or `node-fetch@2` |
| `hardcoded-host` | warn | a literal, non-loopback host string is embedded in source |

## Limitations

Every one of these is a real, measured gap, not a hedge.

- **Static only.** In the measured corpus, roughly 76% of real call sites build their URL at runtime (92 variable, 21 env, 35 literal out of 148), so most hosts report as unresolved. That's expected, not a failure: apiwatch never runs your code, so a value assembled from a runtime config object or template string is opaque to it.
- **`no-timeout` and `no-retry` stay silent when the options object isn't statically readable.** apiwatch only reads an options/config argument that is a literal `{ ... }` at the call site. An options object built elsewhere and passed in as a variable (`axios(config)`), a spread, a conditional expression, or anything else that isn't an object literal, is neither proof of a timeout/retry nor proof of its absence, so both rules abstain rather than guess. This is the common case in real code, not an edge case: reproduced against twilio-node's `axios(config)` at `src/base/RequestClient.ts:73`, where `config` is an identifier that DOES set a timeout and sits inside a retry function, but the pre-0.1.1 release read it as having neither and reported both `no-timeout` (error) and `no-retry` (warn) on correctly-protected code. If you're auditing your own repo and see fewer findings than before, this is likely why: those sites were never actually protected OR unprotected as far as apiwatch could tell, they were unreadable.
- **Framework-level timeouts are invisible.** A timeout configured at the framework level, rather than at the call or client instance, is not seen. `HttpModule.register({ timeout })` in NestJS is the known case: every call routed through that module is reported `no-timeout` even though it's protected.
- **Hand-rolled retry loops make `no-retry` abstain, they do not count as retry.** Library-backed retry (`axios-retry`, `p-retry`, `got`'s built-in retry, an explicit `retry`/`retries` option) is proof of retry. A hand-rolled loop is not, but it is proof that absence of retry cannot be shown, so the rule goes quiet rather than warning. A loop qualifies only when all three hold: the call's nearest loop is a counting `for`/`while`/`do`, the call is inside a `try`, and that `try` contains a `continue` owned by that same loop. Pagination advances on the success path and either needs no `continue` or `break`s out on failure, so it keeps being reported. An earlier heuristic asked only "is there a loop ancestor" and read 22 of 93 sites in one repo as retry, silently suppressing every genuine finding; this one was validated against both shapes, abstaining on 47 of 68 sites in a backend that hand-rolls retry in every provider and on 0 of 93 in the pagination-heavy repo that killed its predecessor. The remaining known gap is a retry loop that re-enters without a `continue` (for example one that only sets a flag), which is still reported.
- **`signal: controller.signal` is treated as protected.** A bare `AbortController` with no timeout ever attached to it is statically indistinguishable from one wired to `setTimeout(() => controller.abort(), ms)` elsewhere in the file, so `no-timeout` can stay silent on a fetch that's only manually cancellable, never time-bounded.
- **Clients built by a factory function, or injected via DI other than `@nestjs/axios`, may be missed entirely**, a false negative, not a false positive.
- **`unvalidated-response` stays silent when it can't follow the value.** Absence of a finding is not proof a response is validated. In the measured corpus, 132 of 148 sites were provably unvalidated and 16 were unknown-and-silent.
- **Any `.parse()`/`.validate()`-named call in the enclosing function counts as validation**, as long as the file imports a validator library: apiwatch checks the call's own name and receiver, not that the value it's called on is actually the response. A response handed to some other `.parse()`-named call in the same function (not `JSON.parse`/`Date.parse`, which are explicitly excluded) can read as validated when it isn't.
- **A client shared across CommonJS modules, or required lazily inside a function body, is resolved**, but a client passed around through less direct means (a factory function's return value, a namespace object's property, DI other than `@nestjs/axios`) may still be invisible, the same false-negative gap that already existed for ESM.
- **Sample code, benchmarks and docs are skipped, by directory name only.** Measured across six public repos, 10% of all findings sat outside shipped code (`examples/` 2.7%, `benchmark/` 1.8%, `docs/` 0.9%, `scripts/` 4.6%), and in libraries it reached 60% (tinyhttp) and 39% (got) versus 0% for an application like Outline. apiwatch now excludes `example`, `sample`, `demo`, `playground`, `benchmark`, `bench`, `perf`, `fixture`, `mocks`, `cypress` and `doc`/`docs` directories, and reports how many files it left out rather than dropping them silently. Two deliberate gaps: `scripts/`, `tools/` and `bin/` stay in scope, because a release script that fetches with no timeout really does hang CI and enough projects put runtime code there that excluding it would trade a visible false positive for an invisible false negative. And because this matches directory names exactly, it misses sample code stored under another name: Uptime Kuma keeps its examples in `extra/push-examples/`, which no exact-segment rule catches, so its five sample-code findings are still reported.
- **`no-timeout` means no deadline of its own, not a guaranteed hang.** Measured on Node 24, a native `fetch` against a server that accepts and never responds rejects after 301.3s with `UND_ERR_HEADERS_TIMEOUT`, because undici applies a ~300s header timeout underneath. axios sets no application timeout at all (its default is `0`). And axios's `timeout` is a socket INACTIVITY timeout, not a wall-clock deadline: a vendor trickling one byte every 300ms kept a `timeout: 1000` call alive past 23s in testing. A finding means your code sets no deadline, which is worth fixing, but do not read it as proof the call runs forever.

## Roadmap

v0.1 is static analysis only: it never runs your code. Two things are explicitly out of scope for this release and planned for v0.2:

- **Runtime recording**: attaching to `fetch`/`http` at runtime to observe real timeouts, retries and response shapes, resolving the hosts static analysis can't.
- **Drift detection**, planned for v0.2: comparing today's audit against a stored baseline so a new unprotected call site fails CI, even when the rest of the repo is already accepted.

## License

MIT
