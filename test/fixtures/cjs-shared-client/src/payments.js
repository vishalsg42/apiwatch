const { api } = require('./http')

module.exports.charge = () => api.get('https://x.dev/charge')
