const request = require('request')
module.exports = (cb) => request({ method: 'GET', url: 'https://x.dev/z' }, cb)
