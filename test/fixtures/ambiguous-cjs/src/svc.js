const axios = require('axios')
const { handle } = require('./other.js')

// The CJS twin of the `ambiguous` fixture: the response escapes to a function required from
// elsewhere, so the verdict must be 'unknown', not a false `false`.
module.exports.f = async () => handle(await axios.get('https://x.dev/a'))
