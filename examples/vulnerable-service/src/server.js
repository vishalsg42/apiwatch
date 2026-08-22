const express = require('express')
const { getInventory } = require('./services/inventory')
const { chargeCardLegacy } = require('./services/legacy-billing')
const { notifyUser } = require('./services/notifications')
const { createCharge } = require('./services/payments')

const app = express()
app.use(express.json())

app.get('/inventory/:sku', async (req, res) => {
  const item = await getInventory(req.params.sku)
  res.json(item)
})

// Old code path, kept around for a partner that still posts to it. Nobody wants to touch it.
app.post('/charges/legacy', (req, res) => {
  chargeCardLegacy(req.body, (err, body) => {
    if (err) return res.status(502).json({ error: 'upstream failure' })
    res.json(body)
  })
})

// New charge path, added when the legacy one caused an incident.
app.post('/charges', async (req, res) => {
  const charge = await createCharge(req.body)
  res.json(charge)
})

app.post('/notify', async (req, res) => {
  const deliveryId = await notifyUser(req.body.userId, req.body.message)
  res.json({ deliveryId })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`vulnerable-service listening on ${port}`))
