const { request } = require('node:http')
module.exports = () => request({ host: 'api.vendor.dev', path: '/a' }, () => {})
