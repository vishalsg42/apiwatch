const { defaults } = require('request-promise')
module.exports = () => defaults({ json: true })
