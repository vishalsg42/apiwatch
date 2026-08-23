const http = require('node:http')
module.exports = () => http.request({ host: 'alpha.vendor.dev', path: '/a' }, () => {})
