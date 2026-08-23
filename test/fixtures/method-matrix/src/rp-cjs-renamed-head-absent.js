const { head: probe } = require('request-promise')
module.exports = () => probe({ uri: 'https://v.dev/a' })
