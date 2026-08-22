const request = require('request')

// request's canonical options key is `uri:`, not `url:` — both must be readable.
module.exports = (cb) => request({ uri: 'https://x.dev/via-uri', timeout: 1000 }, cb)
