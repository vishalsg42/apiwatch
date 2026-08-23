const isErr = require('axios').isAxiosError
module.exports = (e) => isErr(e)
