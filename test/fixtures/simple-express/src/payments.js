const axios = require('axios')
exports.getCharge = async (id) => (await axios.get(`https://api.stripe.com/v1/charges/${id}`)).data
