const { post } = require('request-promise')
module.exports = () => post({ uri: 'https://v.dev/a', json: { a: 1 } })
