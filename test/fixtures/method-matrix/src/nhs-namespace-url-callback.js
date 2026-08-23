const https = require('node:https')
module.exports = () => https.get('https://v.dev/a', () => {})
