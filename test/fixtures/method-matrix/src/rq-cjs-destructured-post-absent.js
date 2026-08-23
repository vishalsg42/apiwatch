const { post } = require('request')
module.exports = () => post({ uri: 'https://v.dev/a', json: { a: 1 } }, () => {})
