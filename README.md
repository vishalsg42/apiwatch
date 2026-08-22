# apiwatch

[![CI](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/vishalsg42/apiwatch)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/apiwatch.svg)](https://www.npmjs.com/package/apiwatch)

A zero-config CLI that statically audits outbound third-party HTTP calls in your Node/TypeScript repo: no timeout, no retry, no response validation, one AST pass, no code runs.

```
npx apiwatch audit
```

No install needed for that. To add it to a project instead:

```
npm i -D apiwatch
```

## Before

Node's `fetch` and the `request` library both default to **no timeout**. An unprotected call to a vendor endpoint hangs until that vendor responds, which, if the vendor is down, can be never.

```js
// src/proxy/vendor.js
const res = await fetch(`${VENDOR_BASE}/score/${id}`)
const data = await res.json()
```

Nothing here is wrong syntactically. It ships, it works in staging, and it takes down a request thread in production the first time the vendor stalls.

## After

Real output from `apiwatch audit` against a production Node backend, paths anonymised:

```
  analysed 46 of 46 files · 10 outbound call sites

  ✖ no-timeout               10
  ⚠ no-retry                 10
  ⚠ unvalidated-response     10
  ⚠ deprecated-client         5

  src/proxy/vendor.js:77       request call has no timeout and can hang indefinitely
  src/services/notify.js:32    request-promise call has no timeout and can hang indefinitely
  src/proxy/client.js:108      `request` is unmaintained since 2020
```

Across five production services, the tool measured **148 outbound call sites: 13 with a timeout (8.8%), 0 with retry (0.0%), 0 validating the response.** That is not a cherry-picked repo; it is the default state of hand-rolled HTTP calls in real backends.

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
- **Hand-rolled retry loops are not detected.** Only library-backed retry counts: `axios-retry`, `p-retry`, `got`'s built-in retry, or an explicit `retry`/`retries` option. A manual `for`/`while` retry loop is reported `no-retry`. This is deliberate: an earlier heuristic that treated any loop ancestor as retry misclassified pagination loops as retry on 22 of 93 sites in one real repo, silently suppressing genuine findings. A false warning on a manual retry loop is the safer failure mode than a false negative on a real gap.
- **`signal: controller.signal` is treated as protected.** A bare `AbortController` with no timeout ever attached to it is statically indistinguishable from one wired to `setTimeout(() => controller.abort(), ms)` elsewhere in the file, so `no-timeout` can stay silent on a fetch that's only manually cancellable, never time-bounded.
- **Clients built by a factory function, or injected via DI other than `@nestjs/axios`, may be missed entirely**, a false negative, not a false positive.
- **`unvalidated-response` stays silent when it can't follow the value.** Absence of a finding is not proof a response is validated. In the measured corpus, 132 of 148 sites were provably unvalidated and 16 were unknown-and-silent.
- **Any `.parse()`/`.validate()`-named call in the enclosing function counts as validation**, as long as the file imports a validator library: apiwatch checks the call's own name and receiver, not that the value it's called on is actually the response. A response handed to some other `.parse()`-named call in the same function (not `JSON.parse`/`Date.parse`, which are explicitly excluded) can read as validated when it isn't.
- **A client shared across CommonJS modules, or required lazily inside a function body, is resolved**, but a client passed around through less direct means (a factory function's return value, a namespace object's property, DI other than `@nestjs/axios`) may still be invisible, the same false-negative gap that already existed for ESM.
- **`apiwatch audit` writes `.apiwatch/audit.md` into the audited repo root** as a side effect of every non-JSON run. This is undocumented elsewhere and not configurable in v0.1; the CLI degrades to a warning (instead of crashing) if the root is read-only.

## Roadmap

v0.1 is static analysis only: it never runs your code. Two things are explicitly out of scope for this release and planned for v0.2:

- **Runtime recording**: attaching to `fetch`/`http` at runtime to observe real timeouts, retries and response shapes, resolving the hosts static analysis can't.
- **Drift detection**, planned for v0.2: comparing today's audit against a stored baseline so a new unprotected call site fails CI, even when the rest of the repo is already accepted.

## License

MIT
