const { request } = require('node:http')
module.exports = () => request({ host: 'v.dev' }, () => {})
