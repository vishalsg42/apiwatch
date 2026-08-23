const { request: httpReq } = require('node:http')
module.exports = () => httpReq({ host: 'v.dev', timeout: 5000 }, () => {})
