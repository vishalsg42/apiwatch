const https = require('node:https')
module.exports = () => https.request({ host: 'v.dev', timeout: 5000 }, () => {})
