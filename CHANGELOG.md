# Changelog

Notable changes per release. Dates are release dates. Full notes for each version are on the
[releases page](https://github.com/vishalsg42/apiwatch/releases).

apiwatch is pre-1.0, so minor versions may change behaviour. Each entry says whether to expect
more findings or fewer after upgrading, because a change in finding count is otherwise
indistinguishable from a regression.

## 0.5.0 (2026-08-27)

**This release INVALIDATES every baseline, and it changes finding counts in BOTH directions.**
`fingerprintVersion` goes from 2 to 3, so `accept` cannot carry a 0.4.x baseline across. `audit`,
`accept` and `prune` all stop with instructions rather than comparing incomparable keys. Review
before regenerating, because regenerating accepts everything currently visible:

```bash
apiwatch audit --fail-on error                     # no --baseline: see everything, new included
apiwatch baseline --out .apiwatch-baseline.json    # regenerates over the stale file
```

What actually moved the fingerprint is small: a route label or a config `method` written with
backticks now keys on its value, as a quoted one always did. Measured on 464 call sites carrying
1,414 backtick route labels, **no fingerprint moved**, so most repositories will regenerate to the
same set they had. The whole hash is versioned anyway, because the alternative is a baseline that
silently loses exactly its backtick entries.

Six issues, five of them false negatives or false positives in NestJS and CommonJS code, plus a
conformance check that pins the option model against the clients' own type declarations.

### What changed

- **A timeout registered on a NestJS module is followed to the calls it configures** (#8).
  `HttpModule.register({ timeout })` protects every call its module's providers and controllers
  make, and every one of them used to report `no-timeout` at `error` severity, the one rule
  `--fail-on error` gates on. The join is module-scoped, not repository-wide: `@nestjs/core` hashes
  a dynamic module's metadata into its token, so a bare `imports: [HttpModule]` is a different
  instance with axios's own no-timeout default and keeps reporting. A `@Global()` module's exports
  are followed too, since they reach every module with no `imports` edge.
- **A call through `HttpService.axiosRef` is no longer invisible** (#14). It is the axios instance
  the service wraps and the documented way to get a promise instead of an Observable, but the call
  head matched no binding, so the call was skipped in silence: no call site, no counter, every rule
  quiet. One repository reported a confident zero for its entire HTTP layer.
- **A client reached through an expression is resolved when every branch agrees** (#6), and a run
  that finds nothing anywhere now names the files that imported a client, so a zero is no longer
  left unexplained.
- **`const { get } = require('axios')` binds the verb it was imported as** (#7), on the CommonJS
  path only, so a destructured POST is no longer treated as idempotent.
- **A dependency version resolves against the package that owns the file** (#9), instead of a
  merged map where the last package walked won.
- **A type-only import binds no client**, and a trailing slash on `--root` can no longer reach the
  path logic that keys findings.

### Measured against 0.4.0

Fifteen public repositories, both binaries installed from packed tarballs so a rebuild could not
change what was being compared: **833 findings before, 851 after. One removed, nineteen added.**

| repo | change |
|---|---|
| ufosc/Jukebox-Server | **0 to 8**: `axiosRef` made its whole HTTP layer visible, 3 `no-timeout` |
| hackycy/sf-nest-admin | **0 to 5**: same cause, 0 `no-timeout` because a `@Global()` module registers one |
| tugascript/nestjs-oauth | **removes 1** `no-timeout` at `error` against a module that registers 5000ms |
| stripe/stripe-node | adds 1 `unvalidated-response`, from the expression-resolved client |
| novuhq/novu | adds 5, from the expression-resolved client and the type-only import fix |
| Ghost, documenso, uptime-kuma, nocodb, outline, amplication, ghostfolio, OxMarco, hyperledger, ultimate-nest | none |

The two repositories that go from zero are the interesting ones, and both were checked by hand.
ufosc's three `no-timeout` are genuine: its spotify module imports `HttpModule` bare and the calls
pass a config carrying only headers. sf-nest-admin has none, because its `@Global()` SharedModule
registers `timeout: 5000` and re-exports `HttpModule`; before that was modelled, those same four
calls reported `no-timeout` at `error` severity against protected code.

### Honest limits

The NestJS corpus is nine repositories, most of them small, which is thinner than the six-repository
corpus behind the other rules. `registerAsync` suppresses rather than confirms, because a factory's
return value cannot be read. When a module reaches a configured `HttpModule` but lists its members
through a value that cannot be read (`providers: [...USE_CASES]`), every NestJS call site in that
repository that no module claims abstains. And `no-retry`'s recall is still unmeasured: around 80%
of the calls it stays silent on turn out to have no retry either.

## 0.4.0 (2026-08-25)

**This release ADDS findings.** `fingerprintVersion` stays at 2, so no baseline needs
regenerating, but calls that were previously invisible or wrongly abstained on now report, and
`--fail-on error` can newly fail on code you have not changed. Review before upgrading:

```bash
apiwatch audit --fail-on error                     # no --baseline: see everything, new included
apiwatch baseline accept                           # take the ones you are accepting
```

Sixteen defects, found by three rounds of external review and by sweeping for each defect's
siblings rather than patching the reported line. Seven were `error`-severity false positives:
findings against code that was correctly protected, which is the failure that fails builds and the
one this project treats as most serious.

### Measured against 0.3.8

Nine public repositories, both binaries installed from packed tarballs so a rebuild could not
change what was being compared: **939 findings before, 950 after. Nothing removed, eleven added.**

| repo | added | severity |
|---|---|---|
| Ghost | 5 `unvalidated-response` | `info`, cannot fail a build |
| nocodb | 3 `no-timeout`, 3 `no-retry` | **`error` and `warn`** |
| payload, strapi, medusa, tinacms, documenso, uptime-kuma, outline | none | |

Every addition was checked by hand. The nocodb ones are `axios(url, {...})` calls whose config was
previously located by a guessed index and read as unreadable; the flagged file sets no timeout
anywhere. The Ghost ones are calls inside a classic `function () {}` that previously found no
enclosing scope at all and abstained rather than reporting.

Unresolved-host counts fall in five of the nine, which is the relative-path fix making that number
mean what its message says.

### The structural change

The config reader used to skip any property it did not recognise, then treat a missing `timeout`
as PROOF of absence. Every syntactic form nobody had anticipated therefore became an
error-severity false positive: a quoted key, a computed key, a getter. Nine of this project's
defects lived in that one behaviour, and each had been fixed by teaching the reader one more
shape, which cannot terminate.

The reader now classifies **every** property, with no silent skip and no shrugging default. A
property kind it cannot name makes the object opaque, exactly as an unreadable spread already did,
and opaque means abstain. The gaps are still unbounded and always will be. What changed is the
direction they fail in: an unreadable shape now produces silence, which is the documented
contract, rather than failing somebody's build.

### Fixed: findings that should never have fired

- A **quoted config key** was invisible, so `{ "timeout": 5000 }` reported `no-timeout` on a
  protected call. Property names are compared with quotes stripped now, which is also what makes
  hyphenated keys reachable.
- A **locally destructured `fetch`** did not count as shadowing, in any of its forms:
  `const { fetch } = ctx`, `const [fetch] = list`, `const { fetch } = require('./wrapper')`, and a
  nested or renamed parameter such as `({ deps: { fetch } }) =>`. A wrapper that set
  `AbortSignal.timeout(5000)` was reported as an unprotected native `fetch`.
- **A signal behind a falsy timeout.** `{ timeout: 0, signal: AbortSignal.timeout(5000) }` is a
  real pattern: switch off the client's own timeout and let the signal govern. The signal was only
  read when no `timeout` key existed at all. `timeout: 0` alone still fires, because that genuinely
  is no deadline.
- **`axiosRetry(this.api, …)`** attached to nothing, because a class property is registered under
  its bare name while every reference inside the class reads `this.api`. Call sites already stripped
  that prefix; the three lookups that register clients did not. One shared helper serves all of
  them now.
- A **computed key or getter** (`{ [KEY]: 5000 }`, `{ get timeout() {…} }`) was skipped and the
  timeout read as proven absent. Covered by the structural change above.

### Fixed: calls that were silently invisible

- **`export default` clients.** A client shared by `export default axios.create({…})` or
  `export default client` resolved to nothing in every consumer: zero call sites, no diagnostic, no
  counter. That is the most common way to share a configured client.
- **A backtick `require`.** Two readers matched source text with a regex assuming quotes and no
  whitespace, so `require(`./http`)` was missed. In one that meant a validated response reported as
  unvalidated; in the other a cross-module client vanished and its whole consumer file produced no
  call sites. Both read the AST now.
- **A `retry` key on a client that has no such option.** `axios.get(url, { retry: 3 })` is inert,
  because `AxiosRequestConfig` declares no `retry` key, and reading it as proof suppressed a real
  finding. The option names are per client now, with axios mapped to `axios-retry`'s actual
  per-request key.
- **`axios.request(url, config)`**, documented axios API alongside `axios.request(config)`, had its
  config located by a fixed index and read as unreadable. Both ambiguous axios shapes use the same
  shape probe the request family already used.
- **A call inside a classic `function (req, res) {}`** found no enclosing scope, so validation
  abstained even with the validator beside it. The arrow spelling of identical code worked.

### Fixed: what the report says

- A **no-substitution template literal** kept only its origin, so `` `https://api.host/v3/users` ``
  lost its path. It is read whole now; the prefix-only path is for templates that interpolate.
- A **relative literal** such as `'/api/v1/checkout'` was classified as a runtime-built url, which
  made the report claim static analysis could not see a string sitting at the call site. It has its
  own kind now, and is excluded from the unresolved-host count so that line stays true.
- **`--root=value`**, the GNU attached form that CI scripts produce, was rejected as an unknown
  flag. Normalised once at the CLI entry.
- **`--out` into a directory that does not exist** reported an ENOENT naming a temp file the user
  never asked for. The directory is created.

### Checked and deliberately not changed

Three reported defects did not survive verification, and acting on any of them would have made
apiwatch worse:

- `NO_COLOR` handling was called non-compliant. [no-color.org](https://no-color.org/) requires
  "present and not an empty string", and the current code agrees on every case including
  `NO_COLOR="0"`, where the string is truthy in JavaScript and colour is correctly disabled. The
  proposed rewrite would have broken the empty-string case.
- The `legacy-client` version parser was said to skip pnpm `catalog:` and `workspace:` specifiers.
  The proposed replacement returns identical values on all nine specifiers tested, including
  `workspace:^2.0.0`. A bare `catalog:` yields no version either way, which is right: it is defined
  in another file and firing would be a guess.
- A missing `BindingElement` in one shadow check does not reproduce; a file-scope
  `const { fetch } = ctx` is already caught by the call-site ancestor walk.

## 0.3.8 (2026-08-24)

**No findings change and no baseline needs regenerating.** `fingerprintVersion` stays at 2.

### Fixed

- The `fingerprintVersion` mismatch message now echoes the baseline path you typed rather than the
  absolute one the CLI resolved it to. 0.3.7 added a numbered recovery to that error, but step 2
  printed a fully-qualified path, so the command it told you to run was not the command you could
  paste back. A numbered list you cannot copy is decoration.

## 0.3.7 (2026-08-24)

**No findings change and no baseline needs regenerating.** `fingerprintVersion` stays at 2.
Verified across six repositories: 668 findings, none added, none removed, every per-rule count
identical.

### Fixed

- The `fingerprintVersion` mismatch error now names the whole recovery, in order: review without
  `--baseline` first, then regenerate, then commit. It previously named only `apiwatch baseline`,
  which accepts every finding currently visible and reports just a count, so anyone following it
  literally never saw what they had accepted. The message also now says to pin an exact version in
  CI. A workflow on `apiwatch@0.3` went red the moment 0.3.6 published, because a floating range
  upgraded it across the 0.3.5 fingerprint bump with no change on the user's side.
- The README's CI recipe told you to run `apiwatch baseline accept` after an upgrade. That works
  for a release that adds findings and cannot work for one that changes finding identity. The two
  cases are now distinguished.

### Changed

- The build moved from `tsup`, which is no longer maintained upstream, to `tsdown`. Build-time
  only; nothing in the dependency tree a user installs changed. The published bundle grows 24%
  because tsdown preserves source comments, and its actual code is smaller than before.

## 0.3.6 (2026-08-24)

**No findings change and no baseline needs regenerating.** `fingerprintVersion` stays at 2. This
release corrects what apiwatch *says* about calls it already judged correctly, fixes three
reporting defects, and publishes the first precision measurement of `no-retry`.

### Fixed

- `AbortSignal.timeout(10_000)` now reads as `10000` rather than as unreadable. The pattern allowed
  digits only, and JavaScript numeric separators are legal and common in timeout literals. No
  finding moves, because `no-timeout` fires only on a proven absence and both values keep it silent.
  What was wrong is the reported model: a call that is genuinely protected was described as
  unreadable.
- When findings exceed the 50-item detail cap, the terminal output now says `use --json to see all
  findings`. It used to point at `.apiwatch/audit.md`, which is wrong twice over: that file is
  written only under `--write-report`, and even when written it applies the same cap and says the
  rest are not shown. `--json` is the only uncapped output.
- The analysed file count can no longer print as a negative number on a run where whole directories
  could not be listed. Display only: the underlying count still gates the guards that refuse to
  write or compare a baseline from a partial run.
- `N file(s) could not be analysed` is now `path(s)`, because the count includes directories.

### Measured

`no-retry` precision is **39 of 40**, 97.5%, with a 95% lower bound of 87.1%, judged blind on six
public repositories at pinned commits. Two reviewers on different models agreed on 98.1% of cases
(Cohen kappa 0.899) and independently named the same false positive. Previously only `no-timeout`
had been measured, so no precision figure could be quoted without naming that one rule.

The scoring rules and sample were fixed before any reviewer ran. Method, raw verdicts and caveats
are in `docs/audits/no-retry-precision/`. The most important caveat: 63% of `no-retry` findings are
on calls with no readable method, so the figure is substantially about bare `fetch(url)`.

### Documented

- A client selected by an expression, such as `(insecure ? http : https).request(...)`, is skipped
  with no diagnostic and reaches no counter. This is stripe-node's shape, and it is why that
  repository reports zero call sites. Now in Limitations, and pinned by a test so the claim breaks
  if the gap is ever closed.
- A new Supply chain section explains what automated scanners flag on this package and what each
  alert actually is. The published bundle contains no `http://` or `https://` string and imports no
  networking module, which is now enforced by a test over the packed tarball rather than asserted.

### Known, not fixed here

A `retry` key on a plain axios call is treated as proof of retry, but `AxiosRequestConfig` has no
such option, so the key is inert and a genuine finding is silently suppressed
([#5](https://github.com/vishalsg42/apiwatch/issues/5)). Fixing it adds findings, which would turn a
pinned consumer's CI red on upgrade, so it is deliberately held back from this release rather than
bundled into one that promises no findings change.

## 0.3.5 (2026-08-23)

**Findings move in both directions, and every baseline must be regenerated.** Four independent
defects in how a call's config object is located and read. Three produced `error`-severity false
positives, which fail builds on correct code; one collapsed distinct calls into a single baseline
identity.

### Regenerating your baseline

`fingerprintVersion` moves from 1 to 2, so `audit`, `accept` and `prune` all stop with a clear
message until the baseline is regenerated. Review first, because regenerating accepts everything
currently visible:

```bash
apiwatch audit --fail-on error                     # no --baseline: see everything, new included
apiwatch baseline --out .apiwatch-baseline.json    # regenerates over the stale file
```

The second command now reports how many `error`-severity findings it absorbed. Previously it
refused to run at all, which made the upgrade path a closed loop: `audit` said to regenerate with
`apiwatch baseline`, `baseline` refused and pointed at `accept`/`prune`, and both of those
re-threw the version mismatch. Nothing mentioned deleting the file. That is fixed here.

### Fixed

- **A spread in a config object was read as proof of absence.** `axios.get(url, { ...cfg })`
  reported `no-timeout` at `error` severity while `axios.get(url, cfg)` correctly abstained, and
  that asymmetry is what marked it as an oversight. A spread now makes absence and disablement
  unprovable. Spreads whose keys are statically visible, including through `&&`, `||` and
  ternaries, are still read: `...(body && { data })` hides nothing, so a genuinely missing timeout
  next to one is still reported.
- **The options argument is located by argument shape** for `request`, `request-promise` and
  `node:http`, whose overloads are ambiguous. Choosing an index from client and method was wrong
  in both directions: `rp.get({ uri, timeout: 5000 })` looked at index 1, found nothing and
  reported a false `no-timeout`; `https.get(url, cb)` looked at index 0, found the url string and
  stayed silent on a call that genuinely has no timeout.
- **`https.get(url, callback)` is reported.** Callbacks are recognised as callbacks, so the most
  common `node:http` shape is no longer mistaken for an unreadable config.
- **A named or destructured method import keeps its verb.** `const { post } = require('request-promise')`
  had no method at all, so `no-retry` fired on a POST (`undefined` counts as idempotent by design)
  and evidence printed `request-promise()` with the verb missing. Preserved through renames, and
  `del` normalises to `delete`.
- **An options object's `host` is its target, and a callback never is.** With neither `url` nor
  `uri` present, `pickUrlArg` fell through to the first non-object argument, which for
  `http.request({ host, path }, cb)` is the callback. Since the url feeds the fingerprint, two
  calls to different hosts collapsed into one identity: two findings, one fingerprint, stored as a
  single baseline entry with count 2, so fixing one and adding another left the audit green.

### Testing

A `client x import shape x call shape x polarity` matrix replaces presence-only coverage.
`client-matrix` asserted `toHaveLength(1)` and nothing else, which is how these shipped. Rows
assert `timeoutMs` as `null` (proven absent) versus `'unknown'` (abstain), because every false
positive fixed here could equally be silenced by making the rule abstain. Verified against the
0.3.4 tree: 26 of 31 rows fail there. `node:https` had no coverage at all before this.

### Known limitations, unchanged or newly documented

A verb destructured from an existing binding (`const { get } = rp`) is still invisible, as is
`const { get } = require('axios')`. apiwatch can exhaust the default Node heap on a very large
monorepo; audit one package at a time with `--root packages/<name>` or raise the heap.

## 0.3.4 (2026-08-23)

**Expect fewer findings, and possibly some reclassified.** 0.3.3 fixed three CommonJS blind
spots and created a false-positive class in the same commit: to make
`const { request } = require('node:http')` resolve, every named export of a supported module was
bound as an HTTP client. `createServer` is a server, the opposite of an outbound call, and it was
reported as `no-timeout` at `error` severity, which fails builds.

**Upgrading with a committed baseline: do not simply prune.** This release removes findings and
can also reclassify them, so a baseline can hold both stale entries and a re-keyed equivalent of
the same call. The safe sequence is:

1. Change the pin to `apiwatch@0.3.4` (the README workflow is not rewritten by publishing).
2. Run `apiwatch audit --baseline .apiwatch-baseline.json` and read both the new and the
   resolved keys. Reclassification produces one of each for the same underlying call.
3. Only then run `apiwatch baseline prune`.

`fingerprintVersion` is unchanged, so existing baselines stay readable. The allowlist only
removes bindings; it never re-keys a finding that survives.

### Fixed

- **Named exports are no longer automatically clients.** `createServer` (ESM and CJS),
  `isAxiosError`, `Agent`, `Headers` and `request-promise`'s `defaults` no longer produce call
  sites. A named import counts only when that export is itself a callable request function;
  default and namespace imports are unaffected. A test asserting `defaults()` was a call site
  had been defending the bug.
- **Factories are bound, not silenced.** `create` (axios, got), `extend` (got) and `defaults`
  (request) are real exports, so excluding them would have turned one misplaced finding into
  zero. They now bind an instance that `create({...})` derives from, and the bare factory call
  itself no longer reports.
- **`require(spec).name` is parsed structurally.** A prefix-only regex matched
  `require('node:http')` inside `require('node:http').createServer` and bound the whole module.
- **Quoted destructuring keys resolve.** `const { 'api': client } = require('./http')` produced
  nothing, because the key reads back as `"'api'"` with the quotes attached. The cross-module
  registry had the same latent bug, so the call vanished silently rather than loudly.
- **`baseline accept` and `baseline prune` compare counts, not just keys.** With two structurally
  identical calls, a repo could reach a state with no way back to green: the second call was
  correctly reported as new, and `accept` answered "nothing new to accept". accept now raises a
  count to the current run's and prune lowers it. Neither crosses the other: accept cannot turn a
  green audit red, prune cannot turn a red audit green.
- **`readBaseline` validates counts.** They are arithmetic now, not a display field, so a
  hand-edited `0`, `-1` or `"2"` is rejected rather than computed with.

### Known limitations, unchanged

Bindings are file-wide and name-keyed, so a genuine `request` in one scope and a `createServer`
aliased to `request` in another still collide. Scope-aware resolution is a refactor, not a patch
release. And baseline counts carry no occurrence identity: removing one accepted duplicate while
adding a structurally identical call in the same scope still reads as no change.

Verified against 0.3.3 on five real repositories (Outline, Documenso and three private backends,
518 findings in total): zero findings removed, zero added. The false positives this fixes did not
appear in that sample, so the corpus statistics are unaffected by it.

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
