const rp = require('request-promise')
module.exports = () => rp.del({ uri: 'https://v.dev/a', timeout: 5000 })
