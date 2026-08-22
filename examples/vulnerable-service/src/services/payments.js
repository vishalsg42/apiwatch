// The current payments integration, built after an incident caused by legacy-billing.js hanging
// under vendor load. A dedicated client with a timeout, retry, and a validated response shape.
const axios = require('axios')
const axiosRetry = require('axios-retry')
const { z } = require('zod')

const paymentsClient = axios.create({
  baseURL: 'https://api.payments.example/v1',
  timeout: 5000,
})

axiosRetry(paymentsClient, { retries: 3 })

const ChargeSchema = z.object({
  id: z.string(),
  status: z.enum(['succeeded', 'pending', 'failed']),
})

async function createCharge(payload) {
  const res = await paymentsClient.post('/charges', payload)
  return ChargeSchema.parse(res.data)
}

module.exports = { createCharge }
