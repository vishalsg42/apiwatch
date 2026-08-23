const { get } = require('request-promise')
module.exports = () => get('https://v.dev/a', { timeout: 5000 })
