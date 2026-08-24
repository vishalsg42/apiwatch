# Limitations, in full

Every entry is a real, measured gap rather than a hedge, and each says what it costs you: a missed
finding, a wrong finding, or a surprising baseline. The README carries a summary; this is the
detail behind it.

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

