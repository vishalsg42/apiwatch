const request = require('request')
module.exports = () => request.get({ uri: 'https://v.dev/a', timeout: 5000 }, () => {})
