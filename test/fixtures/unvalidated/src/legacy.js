const request = require('request')
module.exports = (cb) =>
  request({ url: 'https://x.dev/z' }, (e, res, body) => cb(JSON.parse(body)))
