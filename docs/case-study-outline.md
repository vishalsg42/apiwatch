# Case study: Outline

Real output against [Outline](https://github.com/outline/outline) v1.9.1, a 2144-file self-hosted
knowledge base, and the reasoning behind the call sites apiwatch reports as well as the ones it
deliberately stays silent on. Nothing is anonymised, so every line is checkable:

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

