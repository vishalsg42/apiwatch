const request = require('request')
const target = 'https://x.dev/real'

// A nested `url:` inside `proxy:` must never be picked up as the call's own url; only the
// options object's OWN top-level `url` property counts, and here that property's value is a
// variable, not a literal.
module.exports = (cb) =>
  request(
    { proxy: { url: 'https://proxy.internal.test:8080' }, url: target, timeout: 1000 },
    cb,
  )
