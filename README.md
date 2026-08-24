# apiwatch

[![CI](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/vishalsg42/apiwatch/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/vishalsg42/apiwatch)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/apiwatch.svg)](https://www.npmjs.com/package/apiwatch)

A zero-config CLI that statically audits outbound HTTP calls in your Node/TypeScript repo: no timeout, no retry, no response validation, parses each file once with no type resolution, and never runs your code.

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

Real output against [Outline](https://github.com/outline/outline) v1.9.1, a self-hosted knowledge
base. Nothing is anonymised, so every line is checkable:

```
git clone --depth 1 --branch v1.9.1 https://github.com/outline/outline
npx apiwatch audit --root outline | cat
```

```
  analysed 2144 of 2144 files · 8 outbound call sites
  skipped 15 files in example/benchmark/doc dirs (--include-non-shipping to audit them)

  ✖ no-timeout                6
  ⚠ no-retry                  6
  ℹ legacy-client             1
  ℹ unvalidated-response      2

  app/components/Lightbox.tsx:663  fetch call sets no timeout, so it has no deadline of its own
  plugins/notion/server/notion.ts:199  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/lib/FileHelper.ts:56  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/lib/FileHelper.ts:385  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/nodes/Image.tsx:90  fetch call sets no timeout, so it has no deadline of its own
  shared/editor/plugins/UploadPlugin.ts:112  fetch call sets no timeout, so it has no deadline of its own
  app/components/Lightbox.tsx:663  no retry policy detected: confirm that failing fast is intentional here
  server/utils/fetch.ts:167  no retry policy detected: confirm that failing fast is intentional here
  shared/editor/lib/FileHelper.ts:56  no retry policy detected: confirm that failing fast is intentional here
  shared/editor/lib/FileHelper.ts:385  no retry policy detected: confirm that failing fast is intentional here
  shared/editor/nodes/Image.tsx:90  no retry policy detected: confirm that failing fast is intentional here
  shared/editor/plugins/UploadPlugin.ts:112  no retry policy detected: confirm that failing fast is intentional here
  server/utils/fetch.ts:167  `node-fetch@2` is superseded by the global fetch in Node >= 18
  shared/editor/lib/FileHelper.ts:56  no schema validation seen for this response
  shared/editor/lib/FileHelper.ts:385  no schema validation seen for this response

  hosts unresolved for 8 call sites (urls are built at runtime, so static analysis cannot see them)
```

**Eight call sites in a 2144-file codebase is the interesting number.** Outline routes its
server-side HTTP through one wrapper, `server/utils/fetch.ts`, which adds SSRF filtering, proxy
support and an optional timeout. Eleven files import it, and apiwatch reports none of those
eleven callers: a call into a local wrapper is not a call it can judge, because whether any given
caller passes a timeout is not visible at the call site.

That silence is the point. An earlier version read that wrapper as native `fetch` and reported 32
call sites with 24 `no-timeout` findings against code it had no business flagging. Three quarters
were wrong. A tool that cannot tell a wrapper from the global is not conservative, it is loud.

What it does report is the wrapper's own internals (`server/utils/fetch.ts:167`, which uses
`node-fetch@2` and sets no retry) and the calls that genuinely bypass it. Most of those are
browser-side (`Lightbox`, `Image`, `FileHelper`, `UploadPlugin`), where a missing deadline
matters less than on a server, plus one server-side call in the Notion plugin. Read that as a
well-run codebase with little to fix, not as a demonstration of carnage.

Note every host is unresolved: Outline builds its URLs at runtime, which is the normal case and
why `hardcoded-host` reports nothing here.

## Usage

```
npx apiwatch audit [--root <dir>] [--json] [--fail-on error|warn]
```

- `--root <dir>`: audit a directory other than the current one.
- `--json`: emit the machine-readable report (`schemaVersion`, `findings[]`, per-rule counts) instead of the terminal report.
- `--fail-on error|warn`: exit non-zero when findings of that severity or above exist, for wiring into CI.
- `--baseline <file>`: report only findings absent from the baseline. A path that does not exist is an error (exit 2), never an empty baseline.
- `--write-report`: write `.apiwatch/audit.md`. Without it the audit only reads, leaving the audited repo untouched.
- `--include-non-shipping`: also audit `example/`, `benchmark/`, `docs/` and similar directories. They are skipped by default because a missing timeout in sample code cannot page anyone.

Flags are validated: an unknown flag, a missing flag value, a bad `--fail-on`, or a root that does
not exist or is not a directory exits `2` rather than reporting a clean audit.

apiwatch never executes your code. It parses source with the TypeScript compiler API, resolves
HTTP client bindings (including ones imported across modules, including barrel index files, and
instances built with `axios.create()`), and reports what is statically knowable at each call site.

Try it against a small example service, where some calls are unprotected and one is correctly
protected and stays silent:

```
npx apiwatch audit --root examples/vulnerable-service
```

See [`examples/vulnerable-service`](./examples/vulnerable-service) for what it demonstrates and the real output.

## Rules

| rule | severity | flags |
|---|---|---|
| `no-timeout` | error | no `timeout` option, no `AbortSignal.timeout()`, no instance-level default |
| `no-retry` | warn | idempotent call (`get`/`head`/`options`/`put`/`delete`) with no library-backed retry |
| `unvalidated-response` | info | no zod/Joi/yup/ajv/class-validator call was seen for this response |
| `deprecated-client` | warn | file imports the unmaintained `request` or `request-promise` |
| `legacy-client` | info | file imports `node-fetch@2`, superseded by the global `fetch` in Node >= 18 |
| `hardcoded-host` | info | a literal, non-loopback host string is embedded in source |

`no-timeout` is the only rule at `error`, so it is the only one `--fail-on error` gates on.

### How accurate are they

Two rules have been measured against blind reviewers who were never told apiwatch exists, on six
public repositories at pinned commits:

| rule | confirmed | precision | 95% lower bound |
|---|---|---|---|
| `no-timeout` | 40 of 40 | 100% | 91.2% |
| `no-retry` | 39 of 40 | 97.5% | 87.1% |

Read those with their caveats, which are in
[`docs/audits/no-retry-precision/`](./docs/audits/no-retry-precision/) along with the scoring rules,
the sampling frame and every raw verdict. The short version: 63% of `no-retry`'s findings are on
calls with no readable method, so that number is substantially a statement about bare `fetch(url)`;
the one false positive was a call wrapped in a higher-order retry helper, which is a known and
deliberate blind spot; and around 80% of the calls `no-retry` stays silent on turn out to have no
retry either, which is what this precision costs in recall.

`unvalidated-response`, `hardcoded-host`, `deprecated-client` and `legacy-client` have **not** been
measured this way.


Every rule fires only on a **proven** negative and abstains when the call is not statically
readable. `no-retry` is phrased as a review prompt rather than a defect: failing fast is often
correct, and apiwatch can see that no retry is configured but not whether that was a decision. It
also fires when a call's method cannot be determined at all, on the view that an unreadable method
is safer to ask about than to skip silently.
`unvalidated-response` is `info` because it checks whether a validator-shaped call exists in the
enclosing function, not whether *this* response reached it, so it cannot gate a build until it
follows the value. See [Limitations](#limitations) for where each of those abstentions bites.

## CI guard

The point of apiwatch is not the first report, which nobody retrofits. It is the second one.
Record what exists today, then fail the build only when something new appears:

```bash
npx apiwatch baseline          # writes .apiwatch-baseline.json, commit it
```

```yaml
# .github/workflows/apiwatch.yml
name: apiwatch
on: [pull_request]
jobs:
  outbound-http:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      # Pinned to an EXACT version on purpose: apiwatch@0.3.6, never apiwatch@0.3. A range
      # upgrades you the moment a release publishes, so CI can go red with no change on your
      # side. apiwatch is pre-1.0, and a patch release can legitimately add findings (0.3.3
      # made three CommonJS import shapes visible) or change finding identity (0.3.5 bumped
      # fingerprintVersion, which invalidates every baseline entry).
      # If new findings appear, `apiwatch baseline accept` takes them. If the identity changed,
      # accept CANNOT work; see Upgrading below for the review-then-regenerate sequence.
      - run: npx apiwatch@0.3.8 audit --baseline .apiwatch-baseline.json --fail-on error
```

The baseline survives ordinary work: inserting lines, reformatting, reordering calls, renaming a
local variable. It does not survive editing a call's URL, renaming its enclosing function, or
renaming the file, all of which re-key that finding deliberately.

### Keeping the baseline current

```bash
npx apiwatch baseline prune    # drop entries that no longer match; accepts nothing
npx apiwatch baseline accept   # add findings that are currently new, printing each first
```

They are deliberately separate. A single "update" that did both would be a footgun: the natural
moment to run it is straight after CI fails, which is exactly when accepting everything currently
visible is wrong.

**Fixing a finding never fails the build.** Its baseline entry becomes "resolved" and is reported,
not enforced. A gate that punishes fixing things gets switched off.

### Upgrading

**A release can add findings.** Fixing a blind spot makes previously invisible calls visible, so a
committed baseline will not cover them and CI goes red on a version bump. That is the fix working.
Pin the version, upgrade deliberately, and run `apiwatch baseline accept`. 0.3.3 is one example: it
made three CommonJS import shapes visible, and one real backend went from 93 to 110 call sites.

**A release can also change finding IDENTITY, and then `accept` will not work.** A finding is keyed
by a fingerprint, and a release that changes how fingerprints are derived bumps
`fingerprintVersion` so the mismatch is detected rather than silently comparing incomparable keys.
`audit`, `accept` and `prune` all stop with a clear message, and `apiwatch baseline` regenerates
the file in place. Review before you regenerate, because regenerating accepts everything visible:

```bash
apiwatch audit --fail-on error                     # no --baseline: see everything, new included
apiwatch baseline --out .apiwatch-baseline.json    # regenerates over the stale file
```

The regeneration reports how many `error`-severity findings it absorbed, so a genuine one cannot
slip through as a line in a count. 0.3.5 is the current example.

## Limitations

Every one of these is a real, measured gap, not a hedge. They are grouped by what they cost you: a
missed finding, a wrong finding, or a surprising baseline.

### What it cannot see

- **Static only.** Most real call sites build their URL at runtime, so most hosts report as unresolved. apiwatch never runs your code, so a value assembled from a runtime config object or template string is opaque to it.
- **An options object that is not a literal at the call site.** `axios(config)`, a variable, a conditional: none is proof of a timeout or of its absence, so `no-timeout` and `no-retry` abstain. This is the common case in real code. Reproduced against twilio-node's `axios(config)` (`src/base/RequestClient.ts:73`), where `config` DOES set a timeout and sits inside a retry function, but a pre-0.1.1 release reported both rules against correctly-protected code.
- **What a spread carries.** `{ ...defaults }` makes both rules abstain, because the contributed keys are invisible. A spread written inline (`...(body && { data })`, including through `||` and ternaries) is read as though written inline and suppresses nothing. The cost is real: a call that genuinely sets no timeout beside an opaque spread is not reported.
- **Framework-level timeouts.** A timeout configured on the framework rather than the call or the client instance is invisible. `HttpModule.register({ timeout })` in NestJS is the known case: every call through that module reports `no-timeout` despite being protected.
- **Clients reached indirectly.** A client returned by a factory function, injected via DI other than `@nestjs/axios`, or read off a namespace object may be missed entirely. So is a verb destructured from an existing binding: `const rp = require('request-promise'); const { get } = rp` binds nothing, because only destructuring directly from a `require(...)` is recognised. `const { get } = require('axios')` is missed too; it is valid CommonJS, but the named-export allowlist lists only `default` for axios, and widening that list is how the 0.3.3 `createServer` regression happened.
- **A client selected by an expression rather than named.** A call site's client is resolved by matching the callee's source text against a binding name, so anything that is not a plain name matches nothing and the call is skipped in silence. It reaches no counter: not the call-site count, not the unresolved-host count, not the skipped-file count, and the file still reports as analysed. The measured case is stripe-node's `(isInsecureConnection ? http : https).request({...})`, which is why that repository reports zero call sites; `clients[name].get(url)` and `(await getClient()).post(url)` behave the same way. This is the one limitation here with no visible symptom at all, so treat a surprising zero as a reason to check for it.

### Where it stays silent on purpose

- **Hand-rolled retry loops make `no-retry` abstain; they do not count as retry.** Only library-backed retry (`axios-retry`, `p-retry`, `got`'s built-in, an explicit `retry`/`retries`) is proof. A loop qualifies as "cannot show absence" only when all three hold: the nearest loop is a counting `for`/`while`/`do`, the call is inside a `try`, and that `try` contains a `continue` owned by that loop. Pagination advances on the success path, so it keeps being reported. An earlier heuristic asked only "is there a loop ancestor" and read 22 of 93 sites in one repo as retry, silently suppressing every genuine finding; this one abstains on 47 of 68 sites in a backend that hand-rolls retry everywhere, and on 0 of 93 in the pagination-heavy repo that killed its predecessor. Still reported: a retry loop that re-enters without a `continue`.
- **`signal: controller.signal` counts as protected.** A bare `AbortController` that nothing ever aborts is statically indistinguishable from one wired to `setTimeout(() => controller.abort(), ms)` elsewhere, so `no-timeout` can stay silent on a fetch that is only manually cancellable.
- **`unvalidated-response` cannot follow the value.** Absence of a finding is not proof a response is validated.

### Where it can be wrong

- **Any `.parse()`/`.validate()`-named call in the enclosing function counts as validation**, provided the file imports a validator library. apiwatch checks the call's name and receiver, not that the value is actually the response, so a response handed to some unrelated `.parse()` in the same function reads as validated. `JSON.parse`/`Date.parse` are explicitly excluded.
- **Sample code is skipped by directory name only.** Measured across six public repos, 10% of findings sat outside shipped code (`examples/` 2.7%, `benchmark/` 1.8%, `docs/` 0.9%, `scripts/` 4.6%), reaching 60% in tinyhttp and 39% in got versus 0% in an application like Outline. `example`, `sample`, `demo`, `playground`, `benchmark`, `bench`, `perf`, `fixture`, `mocks`, `cypress` and `doc`/`docs` are excluded and counted rather than dropped silently. Two deliberate gaps: `scripts/`, `tools/` and `bin/` stay in scope, because a release script that fetches with no timeout really does hang CI; and matching is by exact segment, so Uptime Kuma's `extra/push-examples/` is missed and its five sample findings are still reported.
- **In a monorepo, dependency versions are merged across packages, last one walked wins.** `deprecated-client` and `legacy-client` read a `dependencies` map built by merging every `package.json` in filesystem walk order, so `node-fetch@2` in one package and `@3` in another gives a result that is wrong in both directions. Verified on a two-package fixture: moving `@2` from `packages/aaa` to `packages/zzz` changed the result from no findings to two. Walk order is filesystem-dependent, so macOS and Linux CI can disagree, which matters most for a committed baseline. Prefer `--root packages/<name>` in a monorepo that mixes major versions of one client.

### Baseline identity

- **Identity is structural, not positional.** A finding is keyed by its rule plus the file, enclosing scope, client, method and target URL. That is what lets a baseline survive line insertions and reformatting. Deliberately, editing a call's URL, renaming its enclosing function, or renaming the file all re-key the finding, so it reads as new once and needs `apiwatch baseline accept`. A file rename produces both new and resolved entries for everything in it.
- **Byte-identical calls in one scope are counted, not individually identified.** Two calls in the same function with the same client, method and URL expression store a count of two, not two entries. `accept` and `prune` are count-aware (accept raises a count to the current run's, prune lowers it), but counts carry no occurrence identity, so fixing one call while adding an identical one is indistinguishable from no change: the entry stays at two and the audit stays green. Measured across four real repos this affects 0 of 15 findings in Outline, 0 of 72 in one production backend, 0 of 266 in another, and 2 of 84 in documenso.

### Running it

- **apiwatch can exhaust the default Node heap on a very large monorepo.** Observed on a public-corpus scan, which died with `FATAL ERROR: Ineffective mark-compacts near heap limit`. Audit one package at a time with `--root packages/<name>`, or raise the heap with `NODE_OPTIONS=--max-old-space-size=8192`.

### What a `no-timeout` finding actually means

No deadline of its own, **not** a guaranteed hang. Measured on Node 24, a native `fetch` against a
server that accepts and never responds rejects after 301.3s with `UND_ERR_HEADERS_TIMEOUT`, because
undici applies a ~300s header timeout underneath. axios sets no application timeout at all (its
default is `0`), and axios's `timeout` is a socket INACTIVITY timeout rather than a wall-clock
deadline: a vendor trickling one byte every 300ms kept a `timeout: 1000` call alive past 23s in
testing. Worth fixing, but do not read it as proof the call runs forever.

## Supply chain

apiwatch reads your source and writes a report. It makes no network calls, and that is enforced
rather than asserted: `test/no-network.test.ts` unpacks the published tarball and fails the build
if the bundle imports `http`, `https`, `net`, `tls`, `dgram`, `dns`, `child_process` or
`worker_threads`, bare or `node:`-prefixed. It also checks against an allowlist, so a module nobody
thought to forbid still has to be justified. Today the bundle imports `fs`, `fs/promises`, `path`,
`url`, `crypto` and `ts-morph`, and nothing else.

Every release is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
so the registry carries a signed attestation naming the exact commit and workflow run that built
the tarball. `npm audit signatures` verifies it, and npm shows it on the package page.

Automated scanners flag a few things on this package. They are worth understanding rather than
working around:

- **URL strings.** The bundle contains no `http://` or `https://` string at all. What gets matched
  is `audit.md`, part of the local report path `.apiwatch/audit.md`, because `.md` is Moldova's
  country-code domain. `pkg.devDependencies` matches the same way, because `.dev` is a real domain
  too. This is a class of false match, not one token, so chasing individual strings is not a
  strategy, and deliberately breaking up a literal to evade a substring search is exactly what real
  evasion looks like. Renaming the report file was considered and rejected: the path is documented,
  and people gitignore and glob it.
- **Filesystem access.** True, and the point of the tool. It reads the repository you aim it at,
  and writes `.apiwatch/audit.md` only under `--write-report`.
- **Environment variable access.** Two matches. One is real and benign: `NO_COLOR`, so the output
  respects it. The other is the string `'process.env'` in the URL classifier, which is a pattern
  apiwatch searches for in *your* code to recognise a host built from an environment variable.
- **Debug or dynamic code execution.** Not from apiwatch: the bundle contains no `eval` and no
  `new Function`. This comes from ts-morph, the parser.
- **An unmaintained dependency.** `path-browserify@1.0.1`, published in 2020, reached via
  `@ts-morph/common`. It is a browser polyfill for Node's `path` and is not removable without
  dropping the analysis engine. The one runtime dependency apiwatch declares is `ts-morph`.

## Roadmap

apiwatch is static analysis only: it never runs your code. Drift detection shipped in v0.3.0,
see [CI guard](#ci-guard). Still out of scope:

- **SARIF output**, reusing the finding fingerprints as `partialFingerprints` so GitHub can
  deduplicate alerts, plus a published GitHub Action.
- **Response-value tracking** for `unvalidated-response`, which is why that rule is `info` and
  cannot fail a build today.
- **Runtime recording**: attaching to `fetch`/`http` at runtime to observe real timeouts,
  retries and response shapes, resolving the hosts static analysis cannot.

## Contributing

To work on apiwatch itself (to use it as a dependency, see the install line at the top), this repo
uses [pnpm](https://pnpm.io):

```
pnpm install
pnpm test
pnpm build
```

Running `npm install` against this repo's own lockfile is not supported; the lockfile and
`node_modules` layout here are managed by pnpm. That has no bearing on installing the published
package, which works fine with `npm i -D apiwatch`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions, including the ones that exist because
breaking them shipped a bug.

### Measuring a corpus

`scripts/scan-corpus.ts` runs the audit across many repositories and reports aggregates only,
keeping no per-repo identity. No ecosystem-wide claim appears in this README yet: the last complete
run predates several correctness fixes, and a rerun is outstanding.

## License

MIT
