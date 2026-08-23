const { 'api': client } = require('./http')
exports.load = () => client.get('https://x.dev/a')
