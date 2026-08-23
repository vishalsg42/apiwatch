const axios = require('axios')
module.exports.api = axios.create({ timeout: 3000 })
