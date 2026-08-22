// Sends a push/email notification through the vendor's messaging API. This one at least has a
// timeout, unlike inventory.js, but the response is still trusted blindly.
const axios = require('axios')

async function notifyUser(userId, message) {
  const res = await axios.post(
    'https://api.notifications.example/v1/send',
    { userId, message },
    { timeout: 2000 },
  )
  return res.data.deliveryId
}

module.exports = { notifyUser }
