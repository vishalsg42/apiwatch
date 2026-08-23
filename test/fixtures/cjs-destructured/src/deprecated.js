const { get } = require('request-promise')
module.exports = () => get({ uri: 'https://x.dev/d' })
