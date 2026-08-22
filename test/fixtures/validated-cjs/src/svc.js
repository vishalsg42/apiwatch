const axios = require('axios')
const Joi = require('joi')

module.exports.f = async () => {
  const res = await axios.get('https://x.dev/a')
  return Joi.object({ id: Joi.string() }).validate(res.data)
}
