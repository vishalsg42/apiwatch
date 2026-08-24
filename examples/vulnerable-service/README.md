# vulnerable-service

A small, realistic Express service used to demonstrate `apiwatch audit` end to end. It is not a
minimal unit-test fixture; it is meant to read like an ordinary backend that grew organically:
one route calls a vendor API with `fetch` and no timeout, another still goes through a `request`
call that nobody has migrated off yet, and a third has a timeout but still trusts the response
body blindly. All hosts are fictional (`*.example`), no real vendor or company is referenced.

It also includes one call that is built correctly, on purpose: `src/services/payments.js` uses
a dedicated `axios.create({ timeout: 5000 })` instance, wires `axios-retry` onto that instance,
and parses the response through a zod schema before returning it. That call is the point of this
example as much as the broken ones are: a tool that flags everything looks the same as a tool
that flags nothing useful. Showing a call apiwatch correctly stays silent on is what demonstrates
it isn't just shouting at every outbound request.

## What's here

| file | what it shows |
|---|---|
| `src/services/inventory.js` | bare `fetch(...)` with no timeout, no retry, no response validation, and a hardcoded vendor host |
| `src/services/legacy-billing.js` | a legacy `request(...)` call (`deprecated-client`), also with no timeout and an unvalidated response |
| `src/services/notifications.js` | an `axios.post(...)` call that does have a timeout, but still consumes the response without validation |
| `src/services/payments.js` | **the protected call**: `axios.create({ timeout: 5000 })` + `axios-retry` + a zod-validated response, flagged by nothing |

## Running the audit

From the repo root, after `pnpm build`:

```
node dist/cli.js audit --root examples/vulnerable-service
```

The published npm package ships only `dist/`, so this example is not in the tarball. To run it,
clone the repo:

```
git clone https://github.com/vishalsg42/apiwatch
cd apiwatch && pnpm install && pnpm build
node dist/cli.js audit --root examples/vulnerable-service
```

## Actual output

This is the output of `node dist/cli.js audit --root examples/vulnerable-service | cat`, in full
against the code in this directory:

```
  analysed 5 of 5 files · 4 outbound call sites

  ✖ no-timeout                2
  ⚠ no-retry                  1
  ⚠ deprecated-client         1
  ℹ unvalidated-response      3
  ℹ hardcoded-host            3

  src/services/inventory.js:4  fetch call sets no timeout, so it has no deadline of its own
  src/services/legacy-billing.js:6  request call sets no timeout, so it has no deadline of its own
  src/services/inventory.js:4  no retry policy detected: confirm that failing fast is intentional here
  src/services/legacy-billing.js:6  `request` is unmaintained since 2020
  src/services/inventory.js:4  no schema validation seen for this response
  src/services/inventory.js:4  host `api.vendor.example` is hardcoded in source
  src/services/legacy-billing.js:6  no schema validation seen for this response
  src/services/legacy-billing.js:6  host `api.payments.example` is hardcoded in source
  src/services/notifications.js:6  no schema validation seen for this response
  src/services/notifications.js:6  host `api.notifications.example` is hardcoded in source
```

Four call sites were analysed: `inventory.js`, `legacy-billing.js`, `notifications.js`, and
`payments.js`. Three of them show up above, each flagged by multiple rules. The fourth, the
`paymentsClient.post('/charges', payload)` call in `payments.js`, does not appear in a single
finding. Its URL is a relative path against the `baseURL` its client instance was created with,
so it has no host of its own to report, which is why `hardcoded-host` passes over it. `no-timeout` stays silent because the client instance was
created with `timeout: 5000`. `no-retry` stays silent because `axios-retry` is wired onto that
same instance. `unvalidated-response` stays silent because the response is parsed through
`ChargeSchema.parse(...)` before it's returned. That is the difference between a call apiwatch
has verified is protected and one it simply hasn't looked at.
