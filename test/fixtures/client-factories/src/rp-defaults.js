const { defaults } = require('request-promise')
const client = defaults({ json: true })
module.exports = (id) => client({ uri: `https://vendor.example.com/u/${id}` })
