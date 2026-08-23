const rp = require('request-promise')
module.exports = () => rp({ ...require('./o') })
