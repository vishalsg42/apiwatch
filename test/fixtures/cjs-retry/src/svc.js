const axios = require('axios')
const axiosRetry = require('axios-retry')
module.exports.f = () => axios.get('https://x.dev/a')
