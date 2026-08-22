// The original billing integration, from before the team standardized on axios. Still live
// because one partner integration was never migrated off the /charges/legacy route.
const request = require('request')

function chargeCardLegacy(payload, cb) {
  request.post(
    'https://api.payments.example/v1/legacy-charges',
    { json: payload },
    (err, res, body) => {
      cb(err, body)
    },
  )
}

module.exports = { chargeCardLegacy }
