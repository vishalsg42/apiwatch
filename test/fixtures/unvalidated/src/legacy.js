const request = require('request')
// This file DOES import a validator lib (zod), unlike the original version of this fixture;
// without that, hasValidatorLib was always false and the JSON.parse-exclusion branch below was
// never reached at all, so the "does NOT count JSON.parse as validation" test passed for the
// wrong reason. `z` itself is never called; it only needs to be imported to exercise the branch.
const { z } = require('zod')

module.exports = (cb) =>
  request({ url: 'https://x.dev/z' }, (e, res, body) => cb(JSON.parse(body), Date.parse(body)))
