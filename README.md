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

An outbound call with no timeout has **no deadline of its own**.

```js
const res = await fetch(`${VENDOR_BASE}/score/${id}`)
const data = await res.json()
```

Nothing there is syntactically wrong. It ships, it passes staging, and it ties up a request the
first time the vendor stalls. Measured on Node 24: a native `fetch` against a server that accepts
and never responds rejects after **301 seconds**, because undici applies a header timeout
underneath. axios sets no application timeout at all, so what bounds an axios call is the socket
and the vendor, not your code.

## After

```
npx apiwatch audit
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
  …
```

**Eight call sites in a 2144-file codebase is the interesting number.** That repository routes its
server-side HTTP through one wrapper, and apiwatch reports none of the eleven files calling it: a
call into a local wrapper is not one it can judge, because whether the caller passes a timeout is
invisible at the call site. An earlier version read that wrapper as native `fetch` and reported 32
sites, three quarters of them wrong.

That silence is the design. [Read the full case study](./docs/case-study-outline.md).

## Usage

```
apiwatch audit    [--root <dir>] [--json] [--fail-on error|warn] [--baseline <file>]
apiwatch baseline [--out <file>] [--allow-partial]
apiwatch baseline accept | prune
```

| flag | what it does |
|---|---|
| `--root <dir>` | audit a directory other than the current one |
| `--fail-on error\|warn` | exit non-zero at that severity or above, for CI |
| `--baseline <file>` | report only findings absent from the baseline |
| `--json` | machine-readable report: `schemaVersion`, `findings[]`, per-rule counts |
| `--write-report` | write `.apiwatch/audit.md`; without it the audit only reads |
| `--include-non-shipping` | also audit `example/`, `benchmark/`, `docs/` and similar |
| `--allow-partial` | write a baseline even when some paths could not be read |

Both `--flag value` and `--flag=value` work. Exit codes: `0` clean, `1` findings at or above
`--fail-on`, `2` a usage or configuration error. An unknown flag, a missing value, a bad
`--fail-on`, or a root that does not exist all exit `2` rather than reporting a clean audit.

apiwatch never executes your code. It parses source with the TypeScript compiler API, with no type
resolution, and reports what is statically knowable at each call site.

## Rules

| rule | severity | flags |
|---|---|---|
| `no-timeout` | error | no `timeout` option, no `AbortSignal.timeout()`, no instance-level default |
| `no-retry` | warn | idempotent call (`get`/`head`/`options`/`put`/`delete`) with no library-backed retry |
| `unvalidated-response` | info | no zod/Joi/yup/ajv/class-validator call was seen for this response |
| `deprecated-client` | warn | file imports the unmaintained `request` or `request-promise` |
| `legacy-client` | info | file imports `node-fetch@2`, superseded by the global `fetch` in Node >= 18 |
| `hardcoded-host` | info | a literal, non-loopback host string is embedded in source |

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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      # Pinned to an EXACT version on purpose: apiwatch@0.4.0, never apiwatch@0.4. A range
      # upgrades you the moment a release publishes, so CI can go red with no change on your
      # side. apiwatch is pre-1.0, and a patch release can legitimately add findings (0.3.3
      # made three CommonJS import shapes visible) or change finding identity (0.3.5 bumped
      # fingerprintVersion, which invalidates every baseline entry).
      # If new findings appear, `apiwatch baseline accept` takes them. If the identity changed,
      # accept CANNOT work; see Upgrading below for the review-then-regenerate sequence.
      - run: npx apiwatch@0.4.0 audit --baseline .apiwatch-baseline.json --fail-on error
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

apiwatch fires only on a **proven** negative and abstains when a call is not statically readable.
That is a deliberate trade: it misses things rather than inventing them. The headline cases:

- **Static only.** Most real URLs are built at runtime, so most hosts report as unresolved.
- **A config object that is not a literal at the call site.** `axios(config)`, a spread of an
  unknown value, a computed key, a getter: none proves a timeout is absent, so the rules abstain.
- **Clients reached indirectly.** A factory or a DI container other than `@nestjs/axios` may be
  missed entirely. An expression is followed when every branch resolves to the same client, so
  `(insecure ? http : https).request(...)` is found, but `clients[name].get(...)` is not: which
  client a map returns is a runtime fact. A run that finds nothing anywhere names the files that
  imported a client, so a zero is not left unexplained.
- **Framework-level timeouts.** `HttpModule.register({ timeout })` in NestJS is invisible, so calls
  through it report `no-timeout` despite being protected.
- **Hand-rolled retry loops make `no-retry` abstain**, but they do not count as retry.

Each of these is measured, with the reproduction and the cost. [Read the full list](./docs/limitations.md).

## Supply chain

apiwatch reads your source and writes a report. It makes no network calls, and that is enforced
rather than asserted: a test unpacks the published tarball and fails the build if the bundle
imports `http`, `https`, `net`, `tls`, `dgram`, `dns`, `child_process` or `worker_threads`. Its one
runtime dependency is `ts-morph`.

Every release is published from CI with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements), so the registry carries
a signed attestation naming the commit and workflow that built the tarball. `npm audit signatures`
verifies it.

Automated scanners flag a few things on this package, none of them real.
[What each alert actually is](./docs/supply-chain.md).

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
