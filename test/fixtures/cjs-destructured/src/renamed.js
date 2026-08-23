const { request: httpRequest } = require('node:http')
module.exports = () => httpRequest({ host: 'api.vendor.dev', path: '/c' }, () => {})
